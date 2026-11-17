import type { SqlExecutor } from './database';

interface SessionState {
  id: string;
  user_id: string;
  family_id: string;
  refresh_token_hash: string;
  refresh_generation: number;
  csrf_token_hash: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  unexpired: boolean;
  status: string;
}

export class SessionRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async active(sessionId: string, userId: string): Promise<{ csrf_token_hash: string } | null> {
    return (
      (
        await this.sql.query<{ csrf_token_hash: string }>(
          `SELECT s.csrf_token_hash FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL
       AND s.expires_at > clock_timestamp() AND s.csrf_token_hash IS NOT NULL AND u.status = 'active'`,
          [sessionId, userId],
        )
      ).rows[0] ?? null
    );
  }

  async create(input: {
    id: string;
    userId: string;
    familyId: string;
    refreshHash: string;
    csrfHash: string;
    durationSeconds: number;
    deviceKind: string;
  }): Promise<Date | null> {
    // Same lock order as password reset/login: user first, then session.
    const user = await this.sql.query("SELECT id FROM users WHERE id = $1 AND status = 'active' FOR UPDATE", [
      input.userId,
    ]);
    if (!user.rowCount) return null;
    const result = await this.sql.query<{ expires_at: Date }>(
      `WITH timing AS (SELECT clock_timestamp() AS issued)
       INSERT INTO sessions(id, user_id, family_id, refresh_token_hash, csrf_token_hash, created_at, expires_at, device_label)
       SELECT $1, $2, $3, $4, $5, issued, issued + $6 * interval '1 second', $7 FROM timing RETURNING expires_at`,
      [
        input.id,
        input.userId,
        input.familyId,
        input.refreshHash,
        input.csrfHash,
        input.durationSeconds,
        input.deviceKind,
      ],
    );
    return result.rows[0].expires_at;
  }

  async lock(sessionId: string): Promise<SessionState | null> {
    await this.sql.query(
      'SELECT u.id FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.id = $1 FOR UPDATE OF u',
      [sessionId],
    );
    return (
      (
        await this.sql.query<SessionState>(
          `SELECT s.*, s.expires_at > clock_timestamp() AS unexpired, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 FOR UPDATE OF s`,
          [sessionId],
        )
      ).rows[0] ?? null
    );
  }

  async recentlyConsumed(sessionId: string, tokenHash: string): Promise<boolean | null> {
    return (
      (
        await this.sql.query<{ recent: boolean }>(
          `SELECT consumed_at >= clock_timestamp() - interval '10 seconds' AS recent
       FROM session_refresh_history WHERE session_id = $1 AND token_hash = $2`,
          [sessionId, tokenHash],
        )
      ).rows[0]?.recent ?? null
    );
  }

  async rotate(state: SessionState, nextHash: string): Promise<void> {
    await this.sql.query(
      'INSERT INTO session_refresh_history(token_hash, session_id, generation) VALUES ($1, $2, $3)',
      [state.refresh_token_hash, state.id, state.refresh_generation],
    );
    await this.sql.query(
      'UPDATE sessions SET refresh_token_hash = $2, refresh_generation = refresh_generation + 1 WHERE id = $1',
      [state.id, nextHash],
    );
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.sql.query(
      'UPDATE sessions SET revoked_at = clock_timestamp() WHERE family_id = $1 AND revoked_at IS NULL',
      [familyId],
    );
  }

  async listOwned(userId: string, limit: number, cursor?: { createdAt: string; id: string }) {
    return (
      await this.sql.query<{
        id: string;
        device_label: string | null;
        created_at: Date;
        expires_at: Date;
        cursor_time: string;
      }>(
        `SELECT id, device_label, created_at, expires_at,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
       FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > clock_timestamp()
       AND csrf_token_hash IS NOT NULL AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
       ORDER BY created_at DESC, id DESC LIMIT $4`,
        [userId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
      )
    ).rows;
  }

  async revokeOwned(userId: string, sessionId: string): Promise<boolean> {
    return (
      (
        await this.sql.query(
          'UPDATE sessions SET revoked_at = COALESCE(revoked_at, clock_timestamp()) WHERE user_id = $1 AND id = $2',
          [userId, sessionId],
        )
      ).rowCount === 1
    );
  }

  async revokeAll(userId: string): Promise<void> {
    await this.sql.query(
      'UPDATE sessions SET revoked_at = clock_timestamp() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
  }

  async logoutAction(
    operationId: string,
  ): Promise<{ session_id: string; all_sessions: boolean; csrf_token_hash: string } | null> {
    return (
      (
        await this.sql.query<{ session_id: string; all_sessions: boolean; csrf_token_hash: string }>(
          `SELECT a.session_id, a.all_sessions, s.csrf_token_hash FROM session_logout_actions a
           JOIN sessions s ON s.id = a.session_id WHERE a.operation_id = $1`,
          [operationId],
        )
      ).rows[0] ?? null
    );
  }

  async recordLogout(sessionId: string, operationId: string, allSessions: boolean): Promise<void> {
    await this.sql.query(
      'INSERT INTO session_logout_actions(session_id, operation_id, all_sessions) VALUES ($1, $2, $3)',
      [sessionId, operationId, allSessions],
    );
  }
}
