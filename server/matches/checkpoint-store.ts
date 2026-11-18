import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACCOUNT_PROTOCOL_VERSION } from '../../shared/protocol';
import type { Database, SqlExecutor } from '../../packages/persistence/src/database';
import { retryTransaction } from '../../packages/persistence/src/transactions';
import { MatchOutcomeRepository, type SettlementConfiguration } from '../../packages/persistence/src/match-outcomes';
import { canonicalJson } from '../../packages/game-core/src/snapshot';
import { buildOwnedLineupCards } from '../../packages/game-core/src/lineups';
import { EconomyPolicySchema } from '../../packages/contracts/src/economy';
import { verifyModeRules } from '../../config/modes';
import { parseSkin } from '../validation';
import { ApiError } from '../api/http';
import { CheckpointSchema, CheckpointCardSchema, checkpointHash, type AccountCheckpoint } from './checkpoint';

export interface CheckpointLease {
  matchId: string;
  ownerId: string;
  storageId: string;
  epoch: string;
  checkpoint: string;
}
export type CheckpointEvent = 'shot' | 'update' | 'presence' | 'terminal';
interface Head extends CheckpointLease {
  active: boolean;
}
const conflict = () => new ApiError('CONFLICT', 409);
export class CheckpointReadFailure extends Error {
  constructor(readonly reason: 'incompatible-checkpoint' | 'corrupt-checkpoint') {
    super(reason);
  }
}
function parse(value: unknown): AccountCheckpoint {
  const result = CheckpointSchema.safeParse(value);
  if (!result.success || Buffer.byteLength(JSON.stringify(result.data)) > 128 * 1024)
    throw new ApiError('INVALID_REQUEST', 400);
  return result.data;
}
const leaseOf = ({ matchId, ownerId, storageId, epoch, checkpoint }: Head): CheckpointLease => ({
  matchId,
  ownerId,
  storageId,
  epoch,
  checkpoint,
});
/** SQL-only checkpoints. A lease epoch fences a stale process; ownership never comes from a player request. */
export class MatchCheckpoints {
  readonly ownerId: string;
  readonly storageId: string;
  readonly leaseMs: number;
  constructor(
    private readonly db: Database,
    options: { ownerId?: string; storageId?: string; leaseMs?: number } = {},
  ) {
    this.ownerId = options.ownerId ?? randomUUID();
    this.storageId = options.storageId ?? this.ownerId;
    this.leaseMs = options.leaseMs ?? 15000;
    if (
      !z.uuid().safeParse(this.ownerId).success ||
      !z.uuid().safeParse(this.storageId).success ||
      !Number.isInteger(this.leaseMs) ||
      this.leaseMs < 1000 ||
      this.leaseMs > 60000
    )
      throw new Error('Invalid checkpoint store configuration');
  }
  private async head(tx: SqlExecutor, matchId: string, lock = false): Promise<Head | undefined> {
    return (
      await tx.query<Head>(
        `SELECT match_id AS "matchId",owner_id AS "ownerId",storage_id AS "storageId",epoch::text,checkpoint::text,lease_until>clock_timestamp() AS active
      FROM match_recovery_heads WHERE match_id=$1 ${lock ? 'FOR UPDATE' : ''}`,
        [matchId],
      )
    ).rows[0];
  }
  private async binding(
    tx: SqlExecutor,
    record: AccountCheckpoint,
    writing: boolean,
  ): Promise<SettlementConfiguration> {
    const match = (
      await tx.query<{
        status: string;
        mode: string;
        room_code: string;
        closed: boolean;
        protocol: number;
        configVersion: string;
      }>(
        `SELECT status,mode,room_code,protocol_version AS protocol,config_version AS "configVersion",recovery_closed_at IS NOT NULL AS closed FROM matches WHERE id=$1 ${writing ? 'FOR UPDATE' : ''}`,
        [record.matchId],
      )
    ).rows[0];
    const configuration = await new MatchOutcomeRepository(tx).configuration(record.matchId);
    if (
      !match ||
      !configuration ||
      match.protocol !== ACCOUNT_PROTOCOL_VERSION ||
      match.configVersion !== record.configVersion ||
      match.room_code !== record.code ||
      (writing && (match.status !== 'playing' || match.closed))
    )
      throw conflict();
    try {
      const { data, policy, rules, hash } = configuration;
      const playbackBudget = Math.ceil(data.physics.maxSimSeconds * 1000) + 2000;
      if (
        record.configurationHash !== hash ||
        record.configVersion !== data.version ||
        match.mode !== rules.mode ||
        createHash('sha256').update(canonicalJson({ data, policy, rules })).digest('hex') !== hash ||
        !parseSkin(record.skin).ok ||
        record.clocks.matchMs > data.rules.matchSeconds * 1000 ||
        (record.clocks.turnMs !== null && record.clocks.turnMs > data.rules.turnSeconds * 1000 + playbackBudget) ||
        record.clocks.playbackMs > playbackBudget ||
        record.clocks.reconnectMs.some(
          (remaining) => remaining !== null && remaining > data.rules.reconnectSeconds * 1000,
        )
      )
        throw conflict();
      verifyModeRules(data, rules);
      EconomyPolicySchema.parse(policy);
      const participants = (
        await tx.query<{ userId: string; side: 0 | 1; lineupSnapshot: unknown }>(
          'SELECT user_id AS "userId",side,lineup_snapshot AS "lineupSnapshot" FROM match_participants WHERE match_id=$1 ORDER BY side',
          [record.matchId],
        )
      ).rows;
      if (participants.length !== 2) throw conflict();
      for (const [side, seat] of record.seats.entries()) {
        const participant = participants[side];
        if (participant.side !== side || participant.userId !== seat.userId) throw conflict();
        const stored = z.array(z.object(CheckpointCardSchema.shape)).length(5).safeParse(participant.lineupSnapshot);
        if (!stored.success || canonicalJson(stored.data) !== canonicalJson(seat.cards)) throw conflict();
        const rebuilt = buildOwnedLineupCards(
          data,
          rules,
          seat.cards.map((card) => ({
            id: card.ownedCardId,
            playerDefId: card.playerDefId,
            level: card.ownedLevel,
            version: card.cardVersion,
            status: 'active',
          })),
        );
        if (rebuilt.some((card, slot) => card.level !== seat.cards[slot].level)) throw conflict();
      }
    } catch {
      throw conflict();
    }
    return configuration;
  }
  private async stored(tx: SqlExecutor, head: Head) {
    const row = (
      await tx.query<{ payload: unknown; hash: string; event: string }>(
        'SELECT payload,payload_hash AS hash,event FROM match_checkpoints WHERE match_id=$1 AND ordinal=$2',
        [head.matchId, head.checkpoint],
      )
    ).rows[0];
    if (!row) throw conflict();
    const tags = z
      .object({
        format: z.literal(1),
        engine: z.literal('shared-match-v1'),
        protocol: z.literal(ACCOUNT_PROTOCOL_VERSION),
        identity: z.literal('account'),
        clockPolicy: z.literal('freeze-v1'),
      })
      .safeParse(row.payload);
    if (!tags.success) throw new CheckpointReadFailure('incompatible-checkpoint');
    const result = CheckpointSchema.safeParse(row.payload);
    if (!result.success || result.data.matchId !== head.matchId || checkpointHash(result.data) !== row.hash)
      throw new CheckpointReadFailure('corrupt-checkpoint');
    return { ...row, record: result.data };
  }
  /** Called inside the match/participant/configuration start transaction, before any match-start publication. */
  async initialize(tx: SqlExecutor, value: unknown): Promise<CheckpointLease> {
    const record = parse(value),
      digest = checkpointHash(record),
      prior = await this.head(tx, record.matchId, true);
    if (prior) {
      const previous = await this.stored(tx, prior);
      if (
        !prior.active ||
        prior.ownerId !== this.ownerId ||
        prior.storageId !== this.storageId ||
        previous.hash !== digest ||
        prior.checkpoint !== '0'
      )
        throw conflict();
      return leaseOf(prior);
    }
    if (record.revision !== 0 || record.seq !== 0 || record.terminal) throw conflict();
    await this.binding(tx, record, true);
    for (const seat of record.seats) {
      if (
        (await tx.query('SELECT 1 FROM lineups WHERE id=$1 AND user_id=$2', [seat.lineupId, seat.userId])).rowCount !==
        1
      )
        throw conflict();
    }
    await tx.query(
      "INSERT INTO match_checkpoints(match_id,ordinal,revision,seq,event,payload_hash,payload) VALUES ($1,0,0,0,'start',$2,$3)",
      [record.matchId, digest, JSON.stringify(record)],
    );
    const created = await tx.query(
      `INSERT INTO match_recovery_heads(match_id,checkpoint,owner_id,storage_id,epoch,lease_until)
      VALUES ($1,0,$2,$4,1,clock_timestamp()+($3::int*interval '1 millisecond')) ON CONFLICT DO NOTHING`,
      [record.matchId, this.ownerId, this.leaseMs, this.storageId],
    );
    if (created.rowCount !== 1) throw conflict();
    return { matchId: record.matchId, ownerId: this.ownerId, storageId: this.storageId, epoch: '1', checkpoint: '0' };
  }
  async read(matchId: string) {
    return this.db.transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const head = await this.head(tx, matchId);
      if (!head) throw new ApiError('NOT_FOUND', 404);
      const { record } = await this.stored(tx, head);
      return { record, configuration: await this.binding(tx, record, false), lease: leaseOf(head) };
    });
  }
  async claim(matchId: string) {
    return retryTransaction(this.db, async (tx) => {
      await tx.query("SET LOCAL lock_timeout='2s'");
      const head = await this.head(tx, matchId, true);
      if (!head || head.storageId !== this.storageId || (head.active && head.ownerId !== this.ownerId)) return null;
      const { record } = await this.stored(tx, head),
        configuration = await this.binding(tx, record, true);
      const epoch = head.ownerId === this.ownerId && head.active ? head.epoch : (BigInt(head.epoch) + 1n).toString();
      await tx.query(
        "UPDATE match_recovery_heads SET owner_id=$2,epoch=$3,lease_until=clock_timestamp()+($4::int*interval '1 millisecond') WHERE match_id=$1",
        [matchId, this.ownerId, epoch, this.leaseMs],
      );
      return { record, configuration, lease: { ...leaseOf(head), ownerId: this.ownerId, epoch } };
    });
  }
  async write(lease: CheckpointLease, value: unknown, event: CheckpointEvent): Promise<CheckpointLease> {
    const record = parse(value),
      digest = checkpointHash(record);
    if (
      lease.ownerId !== this.ownerId ||
      lease.storageId !== this.storageId ||
      lease.matchId !== record.matchId ||
      !['shot', 'update', 'presence', 'terminal'].includes(event)
    )
      throw conflict();
    return retryTransaction(this.db, async (tx) => {
      await tx.query("SET LOCAL lock_timeout='2s'");
      const head = await this.head(tx, record.matchId, true);
      if (
        !head?.active ||
        head.ownerId !== this.ownerId ||
        head.storageId !== this.storageId ||
        head.epoch !== lease.epoch
      )
        throw conflict();
      const previous = await this.stored(tx, head);
      if (head.checkpoint !== lease.checkpoint) {
        if (
          BigInt(head.checkpoint) === BigInt(lease.checkpoint) + 1n &&
          previous.hash === digest &&
          previous.event === event
        )
          return leaseOf(head);
        throw conflict();
      }
      if (previous.hash === digest) return leaseOf(head);
      const prior = previous.record;
      if (
        prior.terminal ||
        record.seq < prior.seq ||
        record.seq > prior.seq + 1 ||
        record.savedAt < prior.savedAt ||
        record.clocks.elapsedMs < prior.clocks.elapsedMs ||
        canonicalJson(record.receipts.slice(0, prior.receipts.length)) !== canonicalJson(prior.receipts) ||
        canonicalJson(record.seats) !== canonicalJson(prior.seats) ||
        record.seed !== prior.seed ||
        record.configurationHash !== prior.configurationHash ||
        record.skin !== prior.skin ||
        (event === 'presence'
          ? record.revision !== prior.revision ||
            record.seq !== prior.seq ||
            canonicalJson(record.match) !== canonicalJson(prior.match)
          : record.revision !== prior.revision + 1) ||
        (event === 'shot' ? record.seq !== prior.seq + 1 : event !== 'terminal' && record.seq !== prior.seq) ||
        (event === 'terminal') !== (record.terminal !== null)
      )
        throw conflict();
      await this.binding(tx, record, true);
      const checkpoint = (BigInt(head.checkpoint) + 1n).toString();
      await tx.query(
        'INSERT INTO match_checkpoints(match_id,ordinal,revision,seq,event,payload_hash,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [record.matchId, checkpoint, record.revision, record.seq, event, digest, JSON.stringify(record)],
      );
      await tx.query(
        "UPDATE match_recovery_heads SET checkpoint=$2,lease_until=clock_timestamp()+($3::int*interval '1 millisecond') WHERE match_id=$1",
        [record.matchId, checkpoint, this.leaseMs],
      );
      return { ...leaseOf(head), checkpoint };
    });
  }
  async renew(lease: CheckpointLease): Promise<boolean> {
    if (lease.ownerId !== this.ownerId || lease.storageId !== this.storageId) return false;
    const result = await this.db.query(
      `UPDATE match_recovery_heads SET lease_until=clock_timestamp()+($4::int*interval '1 millisecond')
      WHERE match_id=$1 AND owner_id=$2 AND epoch=$3 AND lease_until>clock_timestamp()`,
      [lease.matchId, this.ownerId, lease.epoch, this.leaseMs],
    );
    return result.rowCount === 1;
  }
  async release(lease: CheckpointLease): Promise<void> {
    if (lease.ownerId !== this.ownerId || lease.storageId !== this.storageId) return;
    await this.db.query(
      'UPDATE match_recovery_heads SET lease_until=clock_timestamp() WHERE match_id=$1 AND owner_id=$2 AND epoch=$3',
      [lease.matchId, this.ownerId, lease.epoch],
    );
  }
  async pending(after: string | null = null, limit = 100) {
    if ((after !== null && !z.uuid().safeParse(after).success) || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ApiError('INVALID_REQUEST', 400);
    const rows = (
      await this.db.query<{ matchId: string; code: string; storageId: string; ageMs: string }>(
        `SELECT h.match_id AS "matchId",m.room_code AS code,h.storage_id AS "storageId",
      GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (clock_timestamp()-c.created_at))*1000))::bigint::text AS "ageMs"
      FROM match_recovery_heads h JOIN matches m ON m.id=h.match_id JOIN match_checkpoints c ON c.match_id=h.match_id AND c.ordinal=h.checkpoint
      WHERE m.status='playing' AND m.recovery_closed_at IS NULL AND ($1::uuid IS NULL OR h.match_id>$1)
      ORDER BY h.match_id LIMIT $2`,
        [after, limit + 1],
      )
    ).rows;
    return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].matchId : null };
  }
  async disposition(matchId: string) {
    return (
      (
        await this.db.query<{ status: string; payloadHash: string | null }>(
          'SELECT m.status,o.payload_hash AS "payloadHash" FROM matches m LEFT JOIN match_outcomes o ON o.match_id=m.id WHERE m.id=$1',
          [matchId],
        )
      ).rows[0] ?? null
    );
  }
  async legacy() {
    return (
      await this.db.query<{ total: string; examples: string[] }>(`WITH legacy AS (
      SELECT m.id FROM matches m LEFT JOIN match_recovery_heads h ON h.match_id=m.id
      WHERE m.protocol_version=2 AND m.status='playing' AND m.room_code IS NOT NULL AND m.recovery_closed_at IS NULL AND h.match_id IS NULL
    ) SELECT count(*)::text AS total,(SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM (SELECT id FROM legacy ORDER BY id LIMIT 20) sample) AS examples FROM legacy`)
    ).rows[0];
  }
  async pruneSettled(retentionMs = 7 * 24 * 60 * 60 * 1000, limit = 20) {
    if (!Number.isSafeInteger(retentionMs) || retentionMs < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ApiError('INVALID_REQUEST', 400);
    return retryTransaction(this.db, async (tx) => {
      const rows = (
        await tx.query<{ matchId: string }>(
          `SELECT h.match_id AS "matchId" FROM match_recovery_heads h
        JOIN match_outcomes o ON o.match_id=h.match_id WHERE h.storage_id=$1 AND o.settled_at<clock_timestamp()-($2::bigint*interval '1 millisecond')
        ORDER BY o.settled_at,h.match_id LIMIT $3 FOR UPDATE OF h SKIP LOCKED`,
          [this.storageId, String(retentionMs), limit],
        )
      ).rows;
      for (const row of rows) {
        await tx.query('DELETE FROM match_recovery_heads WHERE match_id=$1', [row.matchId]);
        await tx.query('DELETE FROM match_checkpoints WHERE match_id=$1', [row.matchId]);
      }
      return rows.length;
    });
  }
  async pruneAborted(retentionMs = 7 * 24 * 60 * 60 * 1000, limit = 20) {
    if (!Number.isSafeInteger(retentionMs) || retentionMs < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ApiError('INVALID_REQUEST', 400);
    return retryTransaction(this.db, async (tx) => {
      const rows = (
        await tx.query<{ matchId: string }>(
          `SELECT h.match_id AS "matchId" FROM match_recovery_heads h
        JOIN matches m ON m.id=h.match_id JOIN match_checkpoints c ON c.match_id=h.match_id AND c.ordinal=h.checkpoint
        WHERE h.storage_id=$1 AND h.checkpoint=0 AND c.seq=0 AND m.status='playing' AND m.result IS NULL
          AND m.recovery_close_reason='abandoned' AND m.recovery_closed_at<clock_timestamp()-($2::bigint*interval '1 millisecond')
          AND NOT EXISTS(SELECT 1 FROM match_outcomes o WHERE o.match_id=h.match_id)
          AND NOT EXISTS(SELECT 1 FROM match_checkpoints x WHERE x.match_id=h.match_id AND x.ordinal<>0)
        ORDER BY m.recovery_closed_at,h.match_id LIMIT $3 FOR UPDATE OF h SKIP LOCKED`,
          [this.storageId, String(retentionMs), limit],
        )
      ).rows;
      for (const row of rows) {
        await tx.query('DELETE FROM match_recovery_heads WHERE match_id=$1', [row.matchId]);
        await tx.query('DELETE FROM match_checkpoints WHERE match_id=$1', [row.matchId]);
      }
      return rows.length;
    });
  }
}
