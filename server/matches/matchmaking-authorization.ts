import type { SqlExecutor } from '../../packages/persistence/src/database';
import { canonicalJson } from '../../packages/game-core/src/snapshot';
import type { AccountRoomTarget } from './tickets';
import type { AccountMatchStart } from './recovery';
import type { OwnedLineupSnapshot } from './tickets';
import { ApiError } from '../api/http';

/** Shared by queue transitions and match starts: always before acquiring participant user locks. */
export async function lockMatchmaking(tx: SqlExecutor) {
  await tx.query("SET LOCAL lock_timeout='2s'");
  await tx.query('SELECT pg_advisory_xact_lock(70726,1)');
}
async function activeEntries(tx: SqlExecutor, userIds: readonly string[]) {
  return (
    await tx.query<{ user_id: string; assignment_id: string | null; lineup_snapshot: OwnedLineupSnapshot }>(
      `SELECT e.user_id,e.assignment_id,e.lineup_snapshot FROM matchmaking_entries e
    LEFT JOIN matchmaking_assignments a ON a.id=e.assignment_id LEFT JOIN matches m ON m.id=a.match_id
    WHERE e.user_id=ANY($1::uuid[]) AND ((e.state='queued' AND e.expires_at>clock_timestamp())
      OR (e.state='matched' AND a.state IN ('preparing','ready') AND
        ((a.match_id IS NULL AND a.expires_at>clock_timestamp()) OR (m.status='playing' AND m.recovery_closed_at IS NULL))))
    ORDER BY e.user_id`,
      [userIds],
    )
  ).rows;
}
export async function requireQueueTicket(tx: SqlExecutor, userId: string, target: AccountRoomTarget) {
  if (!target.assignmentId) {
    if (target.recovery(userId)?.phase === 'playing') return;
    if ((await activeEntries(tx, [userId])).length) throw new ApiError('CONFLICT', 409);
    return;
  }
  const found = await tx.query(
    `SELECT 1 FROM matchmaking_entries e JOIN matchmaking_assignments a ON a.id=e.assignment_id
    WHERE e.user_id=$1 AND e.state='matched' AND a.id=$2 AND a.room_code=$3 AND e.config_version=$4
      AND e.mode=$5 AND a.state='ready' AND (a.match_id IS NOT NULL OR a.expires_at>clock_timestamp())`,
    [userId, target.assignmentId, target.code, target.data.version, target.mode],
  );
  if (found.rowCount !== 1) throw new ApiError('NOT_FOUND', 404);
}
/** Caller holds the queue coordination lock, then both active principals' user/session locks. */
export async function authorizeQueuedStart(tx: SqlExecutor, input: AccountMatchStart) {
  const ids = input.participants.map((value) => value.userId);
  if (
    input.assignmentId &&
    (
      await tx.query(
        `SELECT 1 FROM match_participants p JOIN matches m ON m.id=p.match_id
    WHERE p.user_id=ANY($1::uuid[]) AND m.id<>$2 AND m.status='playing' AND m.recovery_closed_at IS NULL LIMIT 1`,
        [ids, input.matchId],
      )
    ).rowCount
  )
    throw new ApiError('CONFLICT', 409);
  const entries = await activeEntries(tx, ids);
  if (!input.assignmentId) {
    if (entries.length) throw new ApiError('CONFLICT', 409);
    return;
  }
  const valid = await tx.query(
    `SELECT 1 FROM matchmaking_assignments WHERE id=$1 AND state='ready' AND room_code=$2
    AND (match_id=$3 OR (match_id IS NULL AND expires_at>clock_timestamp())) FOR UPDATE`,
    [input.assignmentId, input.roomCode, input.matchId],
  );
  if (valid.rowCount !== 1 || entries.length !== 2) throw new ApiError('CONFLICT', 409);
  for (const participant of input.participants) {
    const entry = entries.find((value) => value.user_id === participant.userId);
    if (
      !entry ||
      entry.assignment_id !== input.assignmentId ||
      entry.lineup_snapshot.rules.gameDataVersion !== input.configVersion ||
      entry.lineup_snapshot.rules.mode !== input.mode ||
      canonicalJson(entry.lineup_snapshot.cards) !== canonicalJson(participant.cards)
    )
      throw new ApiError('CONFLICT', 409);
    if (
      (
        await tx.query(
          "SELECT id FROM owned_cards WHERE user_id=$1 AND id=ANY($2::uuid[]) AND status='active' ORDER BY id FOR UPDATE",
          [participant.userId, entry.lineup_snapshot.cards.map((card) => card.ownedCardId)],
        )
      ).rowCount !== 5
    )
      throw new ApiError('FORBIDDEN', 403);
  }
}
