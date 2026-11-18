import { createHash, randomBytes } from 'node:crypto';
import type { z } from 'zod';
import type { Database } from '../../packages/persistence/src/database';
import { MatchTicketSchema } from '../../packages/contracts/src/http';
import { RoomTicketTokenSchema } from '../../packages/contracts/src/match-tickets';
import { freezeSnapshot } from '../../packages/game-core/src/snapshot';
import type { Principal } from '../accounts/access-tokens';
import { requireActivePrincipal } from '../accounts/authorization';
import type { Lineups } from '../accounts/lineups';
import { ApiError } from '../api/http';
import type { GameData } from '../../shared/data';
import { ACCOUNT_PROTOCOL_VERSION } from '../../shared/protocol';
import type { Phase } from '../../shared/protocol';
import { MatchRecovery } from './recovery';
import { ReentryCommandSchema } from '../../packages/contracts/src/match-recovery';

export type OwnedLineupSnapshot = Awaited<ReturnType<Lineups['snapshotInTransaction']>>;
export type AccountMode = z.infer<typeof MatchTicketSchema>['mode'];
export interface AccountIdentity {
  userId: string;
  authSessionId: string;
  nickname: string;
  snapshot: OwnedLineupSnapshot;
}
export interface AccountRoomTarget {
  code: string;
  data: GameData;
  mode: AccountMode;
  /** Returns the existing frozen snapshot on authorized in-process re-entry. */
  selection(userId: string): OwnedLineupSnapshot | undefined;
  canEnter(userId: string): boolean;
  recovery(userId: string): { matchId: string; side: 0 | 1; phase: Phase; reconnectMs: number | null } | undefined;
}
export interface AccountRoomLease {
  target: AccountRoomTarget;
  create(): Promise<void>;
  release(): Promise<void>;
}
export interface AccountRooms {
  reserve(data: GameData, mode: AccountMode): AccountRoomLease;
  find(code: string): AccountRoomTarget | undefined;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export class MatchTickets {
  readonly recovery: MatchRecovery;
  constructor(
    private readonly db: Database,
    private readonly lineups: Lineups,
    private readonly resolveData: () => GameData,
  ) { this.recovery = new MatchRecovery(db); }
  async reenter(principal: Principal, matchId: string, raw: unknown, rooms: AccountRooms) {
    if (!ReentryCommandSchema.safeParse(raw).success) throw new ApiError('INVALID_REQUEST', 400);
    const active = await this.recovery.read(principal, rooms, matchId);
    if (active.state === 'unavailable') throw new ApiError('UNAVAILABLE', 503, true);
    if (active.state !== 'available') throw new ApiError('NOT_FOUND', 404);
    const snapshot = rooms.find(active.match.roomCode)?.selection(principal.userId);
    if (!snapshot) throw new ApiError('NOT_FOUND', 404);
    return this.issue(principal, { protocol: ACCOUNT_PROTOCOL_VERSION, mode: active.match.mode, roomCode: active.match.roomCode, lineupId: snapshot.lineupId, expectedRevision: snapshot.revision }, rooms);
  }
  async issue(principal: Principal, raw: unknown, rooms: AccountRooms) {
    if (typeof raw === 'object' && raw !== null && 'protocol' in raw && raw.protocol !== ACCOUNT_PROTOCOL_VERSION)
      throw new ApiError('PROTOCOL_UNSUPPORTED', 426);
    const parsed = MatchTicketSchema.safeParse(raw);
    if (!parsed.success) throw new ApiError('INVALID_REQUEST', 400);
    const input = parsed.data;
    let lease: AccountRoomLease | undefined;
    const target = input.roomCode
      ? rooms.find(input.roomCode)
      : (lease = rooms.reserve(this.resolveData(), input.mode)).target;
    if (!target || target.mode !== input.mode || !target.canEnter(principal.userId))
      throw new ApiError('NOT_FOUND', 404);
    const token = randomBytes(32).toString('base64url');
    const hash = digest(token);
    try {
      const expiresAt = await this.db.transaction(async (tx) => {
        await requireActivePrincipal(tx, principal);
        // User lock serializes issuance across runtimes; reconnects also count. Failed requests never allocate rooms.
        const count = await tx.query<{ total: number }>(
          "SELECT count(*)::integer AS total FROM match_tickets WHERE user_id = $1 AND created_at > clock_timestamp() - interval '1 minute'",
          [principal.userId],
        );
        if (count.rows[0].total >= 12) throw new ApiError('RATE_LIMITED', 429, true);
        const existing = target.selection(principal.userId);
        if (existing && (existing.lineupId !== input.lineupId || existing.revision !== input.expectedRevision))
          throw new ApiError('CONFLICT', 409);
        const snapshot =
          existing ??
          (await this.lineups.snapshotInTransaction(
            tx,
            principal,
            input.lineupId,
            input.expectedRevision,
            input.mode,
            target.data,
          ));
        // Snapshot and nonce hash become durable together; the client supplies no cards, levels, identity or price.
        const result = await tx.query<{ expires_at: Date }>(
          `INSERT INTO match_tickets
          (nonce_hash, user_id, session_id, room_code, mode, config_version, lineup_snapshot, expires_at, protocol_version)
          VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp() + interval '60 seconds',$8) RETURNING expires_at`,
          [
            hash,
            principal.userId,
            principal.sessionId,
            target.code,
            input.mode,
            target.data.version,
            JSON.stringify(snapshot),
            ACCOUNT_PROTOCOL_VERSION,
          ],
        );
        return result.rows[0].expires_at.toISOString();
      });
      if (lease) await lease.create();
      // Bounded opportunistic collection; keep consumed hashes through their expiry to reject every replay.
      await this.db.query(`DELETE FROM match_tickets WHERE nonce_hash IN
        (SELECT nonce_hash FROM match_tickets WHERE expires_at < clock_timestamp() - interval '1 day' ORDER BY expires_at LIMIT 100)`);
      return {
        ticket: token,
        roomCode: target.code,
        expiresAt,
        protocol: ACCOUNT_PROTOCOL_VERSION,
        configVersion: target.data.version,
        mode: input.mode,
      };
    } catch (error) {
      if (lease) await lease.release().catch(() => undefined);
      await this.db
        .query('DELETE FROM match_tickets WHERE nonce_hash = $1 AND consumed_at IS NULL', [hash])
        .catch(() => undefined);
      if (error instanceof ApiError) throw error;
      throw new ApiError('UNAVAILABLE', 503, true);
    }
  }
  async consume(raw: unknown, target: AccountRoomTarget): Promise<AccountIdentity> {
    const token = RoomTicketTokenSchema.safeParse(raw);
    if (!token.success) throw new ApiError('UNAUTHENTICATED', 401);
    const hash = digest(token.data);
    try {
      // This non-locking lookup only locates the principal. Lock user/session before nonce, matching account operations.
      const found = await this.db.query<{ user_id: string; session_id: string }>(
        'SELECT user_id, session_id FROM match_tickets WHERE nonce_hash = $1',
        [hash],
      );
      const hint = found.rows[0];
      if (!hint) throw new ApiError('UNAUTHENTICATED', 401);
      return await this.db.transaction(async (tx) => {
        await requireActivePrincipal(tx, { userId: hint.user_id, sessionId: hint.session_id });
        const claimed = await tx.query<{ lineup_snapshot: OwnedLineupSnapshot }>(
          `UPDATE match_tickets SET consumed_at = clock_timestamp()
          WHERE nonce_hash = $1 AND user_id = $2 AND session_id = $3 AND room_code = $4 AND mode = $5
          AND config_version = $6 AND protocol_version = $7 AND consumed_at IS NULL AND expires_at > clock_timestamp() RETURNING lineup_snapshot`,
          [hash, hint.user_id, hint.session_id, target.code, target.mode, target.data.version, ACCOUNT_PROTOCOL_VERSION],
        );
        const snapshot = claimed.rows[0]?.lineup_snapshot;
        if (!snapshot || snapshot.userId !== hint.user_id || !target.canEnter(hint.user_id))
          throw new ApiError('UNAUTHENTICATED', 401);
        const cards = await tx.query<{ id: string }>(
          `SELECT id FROM owned_cards WHERE user_id = $1 AND id = ANY($2::uuid[]) AND status = 'active' ORDER BY id FOR UPDATE`,
          [hint.user_id, snapshot.cards.map((c) => c.ownedCardId)],
        );
        if (cards.rows.length !== 5) throw new ApiError('FORBIDDEN', 403);
        const profile = await tx.query<{ nickname: string }>('SELECT nickname FROM profiles WHERE user_id = $1', [
          hint.user_id,
        ]);
        if (!profile.rows[0]) throw new ApiError('UNAUTHENTICATED', 401);
        return {
          userId: hint.user_id,
          authSessionId: hint.session_id,
          nickname: profile.rows[0].nickname,
          snapshot: freezeSnapshot(snapshot),
        };
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('UNAVAILABLE', 503, true);
    }
  }
}
