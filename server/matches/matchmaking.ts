import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, SqlExecutor } from '../../packages/persistence/src/database';
import { retryTransaction } from '../../packages/persistence/src/transactions';
import { canonicalJson, freezeSnapshot } from '../../packages/game-core/src/snapshot';
import {
  QueueCommandSchema,
  QueueEntrySchema,
  QueueRatingSchema,
  MatchmakingPolicySchema,
  type QueueEntry,
  type QueueRating,
  type MatchmakingPolicy,
} from '../../packages/contracts/src/matchmaking';
import { RoomCodeSchema } from '../../packages/contracts/src/match-tickets';
import { ACCOUNT_PROTOCOL_VERSION } from '../../shared/protocol';
import type { GameData } from '../../shared/data';
import { MATCHMAKING_POLICY } from '../../config/matchmaking';
import { verifyModeRules } from '../../config/modes';
import type { ModeRules } from '../../packages/contracts/src/modes';
import type { Principal } from '../accounts/access-tokens';
import { requireActivePrincipal } from '../accounts/authorization';
import type { Lineups } from '../accounts/lineups';
import { ApiError } from '../api/http';
import type { AccountMode, OwnedLineupSnapshot } from './tickets';
import { lockMatchmaking } from './matchmaking-authorization';

type Configuration = { format: 1; data: GameData; policy: MatchmakingPolicy; mode: AccountMode; rules: ModeRules };
type EntryRow = {
  id: string;
  user_id: string;
  intent_id: string;
  payload_hash: string;
  session_id: string;
  host_id: string;
  configuration_hash: string;
  mode: AccountMode;
  config_version: string;
  policy_version: string;
  region: string;
  lineup_snapshot: OwnedLineupSnapshot;
  rating_scope: 'ranked' | 'growth' | null;
  rating_season: string | null;
  rating_points: number | null;
  state: QueueEntry['state'];
  reason: QueueEntry['reason'];
  assignment_id: string | null;
  member: 0 | 1 | null;
  created_at: Date;
  expires_at: Date;
};
type AssignmentRow = {
  id: string;
  host_id: string;
  room_code: string;
  configuration_hash: string;
  match_id: string | null;
  state: 'preparing' | 'ready' | 'failed' | 'completed';
  expires_at: Date;
};
export interface QueueAssignment {
  id: string;
  roomCode: string;
  matchId: string | null;
  expiresAt: string;
  state: AssignmentRow['state'];
  mode: AccountMode;
  rules: ModeRules;
  data: GameData;
  selections: [OwnedLineupSnapshot, OwnedLineupSnapshot];
}
export interface MatchmakingOptions {
  db: Database;
  lineups: Lineups;
  resolveData: () => GameData;
  hostId?: string;
  policy?: MatchmakingPolicy;
  enabledModes?: readonly AccountMode[];
  ratings?: { read(tx: SqlExecutor, userId: string, mode: AccountMode): Promise<QueueRating | null> };
}
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const conflict = () => new ApiError('CONFLICT', 409);

/** Persistent lifecycle only. Room allocation is a separate trusted coordinator, never a player-supplied result. */
export class MatchmakingQueue {
  readonly hostId: string;
  readonly policy: MatchmakingPolicy;
  private readonly enabled: readonly AccountMode[];
  constructor(private readonly options: MatchmakingOptions) {
    this.hostId = z.uuid().parse(options.hostId ?? randomUUID());
    this.policy = freezeSnapshot(MatchmakingPolicySchema.parse(options.policy ?? MATCHMAKING_POLICY));
    this.enabled = [...(options.enabledModes ?? ['friend'])];
  }
  capabilities() {
    return {
      protocol: ACCOUNT_PROTOCOL_VERSION,
      configVersion: this.options.resolveData().version,
      policy: this.policy,
      enabledModes: this.enabled.filter((mode) => mode === 'friend' || !!this.options.ratings),
    };
  }
  private run<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return retryTransaction(this.options.db, async (tx) => {
      // Queue coordination locks first; pairing then checks user/session locks in user-id order.
      await lockMatchmaking(tx);
      return work(tx);
    }).catch((error) => {
      if (error instanceof ApiError) throw error;
      throw new ApiError('UNAVAILABLE', 503, true);
    });
  }
  private async sweep(tx: SqlExecutor, userId?: string) {
    await tx.query(
      `UPDATE matchmaking_entries SET state='expired',reason='timeout',updated_at=clock_timestamp()
      WHERE state='queued' AND expires_at<=clock_timestamp() AND (host_id=$1 OR user_id=$2)`,
      [this.hostId, userId ?? null],
    );
    const due = (
      await tx.query<{ id: string; finished: boolean }>(
        `SELECT a.id,
      EXISTS(SELECT 1 FROM matches m WHERE m.id=a.match_id AND (m.status<>'playing' OR m.recovery_closed_at IS NOT NULL)) AS finished
      FROM matchmaking_assignments a WHERE a.state IN ('preparing','ready')
        AND (a.host_id=$1 OR EXISTS(SELECT 1 FROM matchmaking_entries e WHERE e.assignment_id=a.id AND e.user_id=$2))
        AND (EXISTS(SELECT 1 FROM matches m WHERE m.id=a.match_id AND (m.status<>'playing' OR m.recovery_closed_at IS NOT NULL))
          OR (a.expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM matches m WHERE m.id=a.match_id AND m.status='playing' AND m.recovery_closed_at IS NULL)))
      ORDER BY CASE WHEN EXISTS(SELECT 1 FROM matchmaking_entries e WHERE e.assignment_id=a.id AND e.user_id=$2) THEN 0 ELSE 1 END,
        a.expires_at,a.id LIMIT 20 FOR UPDATE OF a`,
        [this.hostId, userId ?? null],
      )
    ).rows;
    for (const row of due) {
      await tx.query('UPDATE matchmaking_assignments SET state=$2,updated_at=clock_timestamp() WHERE id=$1', [
        row.id,
        row.finished ? 'completed' : 'failed',
      ]);
      await tx.query(
        "UPDATE matchmaking_entries SET state=$2,reason=$3,updated_at=clock_timestamp() WHERE assignment_id=$1 AND state='matched'",
        [row.id, row.finished ? 'completed' : 'expired', row.finished ? 'match-completed' : 'timeout'],
      );
    }
  }
  private async response(tx: SqlExecutor, userId: string, row?: EntryRow) {
    const serverNow = (await tx.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0].now.toISOString();
    if (!row) return { userId, serverNow, entry: null };
    const assignment = row.assignment_id
      ? (await tx.query<AssignmentRow>('SELECT * FROM matchmaking_assignments WHERE id=$1', [row.assignment_id]))
          .rows[0]
      : null;
    const entry = QueueEntrySchema.parse({
      id: row.id,
      intentId: row.intent_id,
      mode: row.mode,
      configVersion: row.config_version,
      policyVersion: row.policy_version,
      rules: row.lineup_snapshot.rules,
      region: row.region,
      lineupId: row.lineup_snapshot.lineupId,
      lineupRevision: row.lineup_snapshot.revision,
      rating: row.rating_scope
        ? { scope: row.rating_scope, season: row.rating_season, points: row.rating_points }
        : null,
      state: row.state,
      reason: row.state === 'queued' && row.host_id !== this.hostId ? 'other-server' : row.reason,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      assignment: assignment
        ? {
            id: assignment.id,
            roomCode: assignment.room_code,
            expiresAt: assignment.expires_at.toISOString(),
            state: assignment.state,
          }
        : null,
    });
    return { userId, serverNow, entry };
  }
  async enqueue(principal: Principal, raw: unknown) {
    if (typeof raw === 'object' && raw !== null && 'protocol' in raw && raw.protocol !== ACCOUNT_PROTOCOL_VERSION)
      throw new ApiError('PROTOCOL_UNSUPPORTED', 426);
    const result = QueueCommandSchema.safeParse(raw);
    if (!result.success) throw new ApiError('INVALID_REQUEST', 400);
    const input = result.data,
      { intentId, ...body } = input,
      digest = hash(body);
    return this.run(async (tx) => {
      await requireActivePrincipal(tx, principal);
      await this.sweep(tx, principal.userId);
      const prior = (
        await tx.query<EntryRow>('SELECT * FROM matchmaking_entries WHERE user_id=$1 AND intent_id=$2 FOR UPDATE', [
          principal.userId,
          intentId,
        ])
      ).rows[0];
      if (prior) {
        if (prior.payload_hash !== digest) throw conflict();
        return this.response(tx, principal.userId, prior);
      }
      if (!this.enabled.includes(input.mode) || (input.mode !== 'friend' && !this.options.ratings))
        throw new ApiError('FORBIDDEN', 403);
      const data = freezeSnapshot(structuredClone(this.options.resolveData()));
      if (input.configVersion !== data.version) throw conflict();
      if (!this.policy.regions.some((value) => value.id === input.region)) throw new ApiError('INVALID_REQUEST', 400);
      if (
        (
          await tx.query("SELECT 1 FROM matchmaking_entries WHERE user_id=$1 AND state IN ('queued','matched')", [
            principal.userId,
          ])
        ).rowCount
      )
        throw conflict();
      if (
        (
          await tx.query(
            `SELECT 1 FROM match_participants p JOIN matches m ON m.id=p.match_id
        WHERE p.user_id=$1 AND m.status='playing' AND m.recovery_closed_at IS NULL LIMIT 1`,
            [principal.userId],
          )
        ).rowCount
      )
        throw conflict();
      if (
        (
          await tx.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM matchmaking_entries WHERE host_id=$1 AND state='queued'",
            [this.hostId],
          )
        ).rows[0].n >= this.policy.maxQueued
      )
        throw new ApiError('RATE_LIMITED', 429, true);
      const snapshot = await this.options.lineups.snapshotInTransaction(
        tx,
        principal,
        input.lineupId,
        input.expectedRevision,
        input.mode,
        data,
      );
      const rating =
        input.mode === 'friend'
          ? null
          : QueueRatingSchema.parse(await this.options.ratings!.read(tx, principal.userId, input.mode));
      if (rating && rating.scope !== input.mode) throw conflict();
      const configuration: Configuration = {
          format: 1,
          data,
          policy: this.policy,
          mode: input.mode,
          rules: snapshot.rules,
        },
        configurationHash = hash(configuration);
      await tx.query('INSERT INTO matchmaking_configurations(hash,payload) VALUES($1,$2) ON CONFLICT DO NOTHING', [
        configurationHash,
        JSON.stringify(configuration),
      ]);
      const row = (
        await tx.query<EntryRow>(
          `INSERT INTO matchmaking_entries(user_id,intent_id,payload_hash,session_id,host_id,configuration_hash,
        mode,config_version,policy_version,region,rating_scope,rating_season,rating_points,rating_window,lineup_snapshot,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,clock_timestamp()+($16::int*interval '1 millisecond')) RETURNING *`,
          [
            principal.userId,
            intentId,
            digest,
            principal.sessionId,
            this.hostId,
            configurationHash,
            input.mode,
            data.version,
            this.policy.version,
            input.region,
            rating?.scope ?? null,
            rating?.season ?? null,
            rating?.points ?? null,
            this.policy.ratingDifference,
            JSON.stringify(snapshot),
            this.policy.waitMs,
          ],
        )
      ).rows[0];
      return this.response(tx, principal.userId, row);
    });
  }
  current(principal: Principal) {
    return this.read(principal);
  }
  get(principal: Principal, id: string) {
    if (!z.uuid().safeParse(id).success) return Promise.reject(new ApiError('INVALID_REQUEST', 400));
    return this.read(principal, id);
  }
  private read(principal: Principal, id?: string) {
    return this.run(async (tx) => {
      await requireActivePrincipal(tx, principal);
      await this.sweep(tx, principal.userId);
      const row = (
        await tx.query<EntryRow>(
          `SELECT * FROM matchmaking_entries WHERE user_id=$1 AND ($2::uuid IS NULL OR id=$2)
        ORDER BY created_at DESC,id DESC LIMIT 1`,
          [principal.userId, id ?? null],
        )
      ).rows[0];
      if (id && !row) throw new ApiError('NOT_FOUND', 404);
      return this.response(tx, principal.userId, row);
    });
  }
  cancel(principal: Principal, id: string) {
    if (!z.uuid().safeParse(id).success) return Promise.reject(new ApiError('INVALID_REQUEST', 400));
    return this.run(async (tx) => {
      await requireActivePrincipal(tx, principal);
      await this.sweep(tx, principal.userId);
      const row = (
        await tx.query<EntryRow>(
          `UPDATE matchmaking_entries SET state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END,
        reason=CASE WHEN state='queued' THEN 'cancelled' ELSE reason END,updated_at=clock_timestamp() WHERE id=$1 AND user_id=$2 RETURNING *`,
          [id, principal.userId],
        )
      ).rows[0];
      if (!row) throw new ApiError('NOT_FOUND', 404);
      return this.response(tx, principal.userId, row);
    });
  }
  private async assignment(tx: SqlExecutor, row: AssignmentRow): Promise<QueueAssignment> {
    const configuration = (
      await tx.query<{ payload: Configuration }>('SELECT payload FROM matchmaking_configurations WHERE hash=$1', [
        row.configuration_hash,
      ])
    ).rows[0]?.payload;
    const members = (
      await tx.query<EntryRow>('SELECT * FROM matchmaking_entries WHERE assignment_id=$1 ORDER BY member', [row.id])
    ).rows;
    if (
      !configuration ||
      configuration.format !== 1 ||
      hash(configuration) !== row.configuration_hash ||
      members.length !== 2 ||
      members[0].user_id === members[1].user_id
    )
      throw conflict();
    const policy = MatchmakingPolicySchema.parse(configuration.policy);
    for (const [index, member] of members.entries()) {
      if (
        member.member !== index ||
        member.configuration_hash !== row.configuration_hash ||
        member.mode !== configuration.mode ||
        member.lineup_snapshot.userId !== member.user_id
      )
        throw conflict();
      verifyModeRules(configuration.data, member.lineup_snapshot.rules);
      if (canonicalJson(member.lineup_snapshot.rules) !== canonicalJson(configuration.rules)) throw conflict();
      if (member.policy_version !== policy.version) throw conflict();
    }
    return freezeSnapshot<QueueAssignment>({
      id: row.id,
      roomCode: row.room_code,
      matchId: row.match_id,
      expiresAt: row.expires_at.toISOString(),
      state: row.state,
      mode: configuration.mode,
      rules: configuration.rules,
      data: configuration.data,
      selections: [members[0].lineup_snapshot, members[1].lineup_snapshot],
    });
  }
  /** Called only after a bounded local room reservation. Retrying the same room code recovers a lost SQL reply. */
  pair(rawCode: string): Promise<QueueAssignment | null> {
    const code = RoomCodeSchema.safeParse(rawCode);
    if (!code.success) return Promise.reject(new ApiError('INVALID_REQUEST', 400));
    return this.run(async (tx) => {
      await this.sweep(tx);
      const existing = (
        await tx.query<AssignmentRow>('SELECT * FROM matchmaking_assignments WHERE room_code=$1', [code.data])
      ).rows[0];
      if (existing) {
        if (existing.host_id !== this.hostId || !['preparing', 'ready'].includes(existing.state)) throw conflict();
        return this.assignment(tx, existing);
      }
      for (let attempt = 0; attempt < 8; attempt++) {
        const candidate = (
          await tx.query<{ a: string; b: string }>(
            `SELECT a.id AS a,b.id AS b FROM matchmaking_entries a JOIN matchmaking_entries b
          ON a.id<>b.id AND (a.created_at,a.id)<(b.created_at,b.id) AND a.host_id=b.host_id AND a.mode=b.mode
          AND a.configuration_hash=b.configuration_hash AND a.region=b.region
          AND ((a.rating_points IS NULL AND b.rating_points IS NULL) OR
            (a.rating_scope=b.rating_scope AND a.rating_season=b.rating_season
              AND ABS(a.rating_points::bigint-b.rating_points::bigint)<=LEAST(a.rating_window,b.rating_window)))
          WHERE a.host_id=$1 AND a.state='queued' AND b.state='queued'
            AND a.expires_at>clock_timestamp() AND b.expires_at>clock_timestamp()
          ORDER BY a.created_at,a.id,b.created_at,b.id LIMIT 1`,
            [this.hostId],
          )
        ).rows[0];
        if (!candidate) return null;
        const members = (
          await tx.query<EntryRow>('SELECT * FROM matchmaking_entries WHERE id=ANY($1::uuid[]) ORDER BY user_id', [
            [candidate.a, candidate.b],
          ])
        ).rows;
        let valid = true;
        for (const member of members) {
          try {
            await requireActivePrincipal(tx, { userId: member.user_id, sessionId: member.session_id });
            const cards = await tx.query(
              "SELECT id FROM owned_cards WHERE user_id=$1 AND id=ANY($2::uuid[]) AND status='active' ORDER BY id FOR UPDATE",
              [member.user_id, member.lineup_snapshot.cards.map((card) => card.ownedCardId)],
            );
            if (cards.rowCount !== 5) throw new ApiError('FORBIDDEN', 403);
            if (
              (
                await tx.query(
                  `SELECT 1 FROM match_participants p JOIN matches m ON m.id=p.match_id WHERE p.user_id=$1
              AND m.status='playing' AND m.recovery_closed_at IS NULL LIMIT 1`,
                  [member.user_id],
                )
              ).rowCount
            )
              throw conflict();
          } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            await tx.query(
              "UPDATE matchmaking_entries SET state='failed',reason='account-unavailable',updated_at=clock_timestamp() WHERE id=$1",
              [member.id],
            );
            valid = false;
          }
        }
        if (!valid) continue;
        const first = members.find((member) => member.id === candidate.a)!;
        const configuration = (
          await tx.query<{ payload: Configuration }>('SELECT payload FROM matchmaking_configurations WHERE hash=$1', [
            first.configuration_hash,
          ])
        ).rows[0].payload;
        const assignment = (
          await tx.query<AssignmentRow>(
            `INSERT INTO matchmaking_assignments(host_id,room_code,configuration_hash,expires_at)
          VALUES($1,$2,$3,clock_timestamp()+($4::int*interval '1 millisecond')) RETURNING *`,
            [this.hostId, code.data, first.configuration_hash, configuration.policy.joinMs],
          )
        ).rows[0];
        for (const [member, id] of [candidate.a, candidate.b].entries())
          await tx.query(
            "UPDATE matchmaking_entries SET state='matched',reason='paired',assignment_id=$2,member=$3,updated_at=clock_timestamp() WHERE id=$1 AND state='queued'",
            [id, assignment.id, member],
          );
        return this.assignment(tx, assignment);
      }
      return null;
    });
  }
  ready(id: string) {
    return this.changeAssignment(id, 'ready');
  }
  fail(id: string) {
    return this.changeAssignment(id, 'failed');
  }
  private changeAssignment(id: string, state: 'ready' | 'failed') {
    if (!z.uuid().safeParse(id).success) return Promise.reject(new ApiError('INVALID_REQUEST', 400));
    return this.run(async (tx) => {
      await this.sweep(tx);
      const row = (
        await tx.query<AssignmentRow>('SELECT * FROM matchmaking_assignments WHERE id=$1 AND host_id=$2 FOR UPDATE', [
          id,
          this.hostId,
        ])
      ).rows[0];
      if (!row) throw new ApiError('NOT_FOUND', 404);
      if (row.state === state) return;
      if (row.state !== 'preparing' && !(state === 'failed' && row.state === 'ready')) throw conflict();
      if (
        state === 'failed' &&
        (
          await tx.query("SELECT 1 FROM matches WHERE id=$1 AND status='playing' AND recovery_closed_at IS NULL", [
            row.match_id,
          ])
        ).rowCount
      )
        throw conflict();
      await tx.query('UPDATE matchmaking_assignments SET state=$2,updated_at=clock_timestamp() WHERE id=$1', [
        id,
        state,
      ]);
      if (state === 'failed')
        await tx.query(
          "UPDATE matchmaking_entries SET state='failed',reason='room-unavailable',updated_at=clock_timestamp() WHERE assignment_id=$1 AND state='matched'",
          [id],
        );
    });
  }
  assignments() {
    return this.run(async (tx) => {
      await this.sweep(tx);
      const rows = (
        await tx.query<AssignmentRow>(
          "SELECT * FROM matchmaking_assignments WHERE host_id=$1 AND state='preparing' ORDER BY created_at,id LIMIT 20",
          [this.hostId],
        )
      ).rows;
      return Promise.all(rows.map((row) => this.assignment(tx, row)));
    });
  }
  assignmentStates(ids: readonly string[]) {
    const parsed = z.array(z.uuid()).max(128).safeParse(ids);
    if (!parsed.success) return Promise.reject(new ApiError('INVALID_REQUEST', 400));
    return this.run(async (tx) => {
      await this.sweep(tx);
      return (
        await tx.query<{ id: string; state: AssignmentRow['state']; matchId: string | null }>(
          'SELECT id,state,match_id AS "matchId" FROM matchmaking_assignments WHERE host_id=$1 AND id=ANY($2::uuid[])',
          [this.hostId, parsed.data],
        )
      ).rows;
    });
  }
  stopHost() {
    return this.run(async (tx) => {
      await tx.query(
        "UPDATE matchmaking_entries SET state='failed',reason='room-unavailable',updated_at=clock_timestamp() WHERE host_id=$1 AND state='queued'",
        [this.hostId],
      );
      const rows = (
        await tx.query<{ id: string }>(
          "UPDATE matchmaking_assignments SET state='failed',updated_at=clock_timestamp() WHERE host_id=$1 AND state IN ('preparing','ready') AND match_id IS NULL RETURNING id",
          [this.hostId],
        )
      ).rows;
      for (const row of rows)
        await tx.query(
          "UPDATE matchmaking_entries SET state='failed',reason='room-unavailable',updated_at=clock_timestamp() WHERE assignment_id=$1 AND state='matched'",
          [row.id],
        );
    });
  }
}
