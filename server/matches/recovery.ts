import type { Database, SqlExecutor } from '../../packages/persistence/src/database';
import type { Principal } from '../accounts/access-tokens';
import { requireActivePrincipal } from '../accounts/authorization';
import { ApiError } from '../api/http';
import { ACCOUNT_PROTOCOL_VERSION } from '../../shared/protocol';
import type { ActiveMatch } from '../../packages/contracts/src/match-recovery';
import type { AccountIdentity, AccountMode, AccountRooms, OwnedLineupSnapshot } from './tickets';
import type { GameData } from '../../shared/data';
import type { ModeRules } from '../../packages/contracts/src/modes';
import type { OutcomeIntent } from '../../packages/contracts/src/match-results';
import type { SettlementReceipt } from './outcomes';
import { MatchCheckpoints, type CheckpointEvent } from './checkpoint-store';
import type { AccountCheckpoint, AccountCheckpointDraft } from './checkpoint';

export interface AccountMatchStart {
  matchId: string;
  roomCode: string;
  mode: AccountMode;
  configVersion: string;
  rules: ModeRules;
  participants: readonly { userId: string; sessionId: string; side: 0 | 1; cards: OwnedLineupSnapshot['cards'] }[];
}
export interface AccountRoomSetup {
  code: string; data: GameData; mode: AccountMode;
  rules?: ModeRules;
  restored?: { record: AccountCheckpoint; selections: [OwnedLineupSnapshot, OwnedLineupSnapshot] };
  admit(options: unknown): Promise<AccountIdentity>;
  recordStart(input: AccountMatchStart, checkpoint: AccountCheckpointDraft): Promise<string>;
  saveCheckpoint(checkpoint: AccountCheckpointDraft, event: CheckpointEvent): Promise<void>;
  recordClose(matchId: string, reason: 'ended' | 'abandoned' | 'expired'): Promise<void>;
  recordOutcome(input: OutcomeIntent, checkpoint: AccountCheckpointDraft): Promise<SettlementReceipt>;
  subscribeOutcome(matchId: string, listener: (receipt: SettlementReceipt) => void): () => void;
}
export class MatchRecovery {
  constructor(private readonly db: Database) {}
  checkpointStore(storageId: string) { return new MatchCheckpoints(this.db, { storageId }); }
  async started(input: AccountMatchStart, initialize?: (tx: SqlExecutor) => Promise<void>): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const participant of [...input.participants].sort((a, b) => a.userId.localeCompare(b.userId)))
        await requireActivePrincipal(tx, participant);
      await tx.query(
        `INSERT INTO matches(id, mode, config_version, protocol_version, status, room_code)
        VALUES ($1,$2,$3,$4,'playing',$5)`,
        [input.matchId, input.mode, input.configVersion, ACCOUNT_PROTOCOL_VERSION, input.roomCode],
      );
      for (const participant of input.participants)
        await tx.query(
          `INSERT INTO match_participants(match_id,user_id,side,lineup_snapshot)
        VALUES ($1,$2,$3,$4)`,
          [input.matchId, participant.userId, participant.side, JSON.stringify(participant.cards)],
        );
      if (initialize) await initialize(tx);
    });
  }
  async closed(matchId: string, reason: 'ended' | 'abandoned' | 'expired'): Promise<void> {
    await this.db.query(
      `UPDATE matches SET recovery_closed_at=clock_timestamp(), recovery_close_reason=$2
      WHERE id=$1 AND recovery_closed_at IS NULL`,
      [matchId, reason],
    );
  }
  async read(principal: Principal, rooms: AccountRooms, matchId?: string): Promise<ActiveMatch> {
    try {
      const row = await this.db.transaction(async (tx) => {
        await requireActivePrincipal(tx, principal);
        return (
          await tx.query<{
            id: string;
            room_code: string;
            mode: AccountMode;
            config_version: string;
            protocol_version: number;
            side: 0 | 1;
            recovery_closed_at: Date | null;
            recovery_close_reason: string | null;
            status: string;
            reason: string | null;
          }>(
            `SELECT m.id,m.room_code,m.mode,m.config_version,m.protocol_version,p.side,m.recovery_closed_at,m.recovery_close_reason,m.status,m.result->>'reason' AS reason
           FROM matches m JOIN match_participants p ON p.match_id=m.id
           WHERE p.user_id=$1 AND m.room_code IS NOT NULL AND ($2::uuid IS NULL OR m.id=$2)
           ORDER BY (m.status='playing' AND m.recovery_closed_at IS NULL) DESC,m.created_at DESC,m.id DESC LIMIT 1`,
            [principal.userId, matchId ?? null],
          )
        ).rows[0];
      });
      const unavailable = (state: 'none' | 'expired' | 'ended' | 'unavailable'): ActiveMatch => ({
        userId: principal.userId,
        state,
        match: null,
      });
      if (!row) return unavailable('none');
      if (row.protocol_version !== ACCOUNT_PROTOCOL_VERSION) return unavailable('unavailable');
      if (['settlement-pending', 'settled', 'void'].includes(row.status)) return unavailable(row.reason === 'abandoned' || row.reason === 'disconnect' ? 'expired' : 'ended');
      if (row.recovery_closed_at) return unavailable(row.recovery_close_reason === 'ended' ? 'ended' : 'expired');
      const target = rooms.find(row.room_code),
        live = target?.recovery(principal.userId);
      if (
        !target ||
        !live ||
        live.matchId !== row.id ||
        live.side !== row.side ||
        target.mode !== row.mode ||
        target.data.version !== row.config_version
      )
        return unavailable('unavailable');
      if (live.phase === 'ended') return unavailable('ended');
      if (live.phase !== 'playing') return unavailable('unavailable');
      if (!target.canEnter(principal.userId)) return unavailable('expired');
      return {
        userId: principal.userId,
        state: 'available',
        match: {
          matchId: row.id,
          roomCode: row.room_code,
          mode: row.mode,
          side: row.side,
          protocol: ACCOUNT_PROTOCOL_VERSION,
          configVersion: row.config_version,
          reconnectMs: live.reconnectMs,
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('UNAVAILABLE', 503, true);
    }
  }
}
