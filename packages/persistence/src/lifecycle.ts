import type { SqlExecutor } from './database';

export type AuditAction =
  | 'reauthenticated'
  | 'link_requested'
  | 'identity_linked'
  | 'deletion_requested'
  | 'deletion_cancelled'
  | 'deletion_completed'
  | 'banned'
  | 'unbanned'
  | 'ban_expired';
export type BanReason = 'security' | 'abuse' | 'policy' | 'support';
export class LifecycleRepository {
  constructor(private readonly sql: SqlExecutor) {}
  async lockUser(userId: string, skip = false) {
    return (
      (
        await this.sql.query<{ id: string; status: string }>(
          `SELECT id, status FROM users WHERE id = $1 FOR UPDATE ${skip ? 'SKIP LOCKED' : ''}`,
          [userId],
        )
      ).rows[0] ?? null
    );
  }
  async recent(sessionId: string): Promise<boolean> {
    return (
      (
        await this.sql.query(
          "SELECT id FROM sessions WHERE id = $1 AND reauthenticated_at > clock_timestamp() - interval '5 minutes'",
          [sessionId],
        )
      ).rowCount === 1
    );
  }
  async authenticate(sessionId: string) {
    return (
      await this.sql.query<{ until: Date }>(
        "UPDATE sessions SET reauthenticated_at = clock_timestamp() WHERE id = $1 RETURNING reauthenticated_at + interval '5 minutes' AS until",
        [sessionId],
      )
    ).rows[0].until;
  }
  async password(userId: string): Promise<string | null> {
    return (
      (
        await this.sql.query<{ password_hash: string }>(
          'SELECT password_hash FROM password_credentials WHERE user_id = $1',
          [userId],
        )
      ).rows[0]?.password_hash ?? null
    );
  }
  async passwordOwner(email: string): Promise<string | null> {
    return (
      (
        await this.sql.query<{ user_id: string }>(
          "SELECT user_id FROM auth_identities WHERE provider = 'email' AND provider_app_id = 'primary' AND provider_subject = $1 AND verified_at IS NOT NULL",
          [email],
        )
      ).rows[0]?.user_id ?? null
    );
  }
  async hasEmail(userId: string): Promise<boolean> {
    return (
      (
        await this.sql.query(
          "SELECT id FROM auth_identities WHERE user_id = $1 AND provider = 'email' AND provider_app_id = 'primary'",
          [userId],
        )
      ).rowCount === 1
    );
  }
  async audit(
    userId: string,
    action: AuditAction,
    details: { actorId?: string; provider?: 'email' | 'wechat'; reason?: BanReason; requestId?: string } = {},
  ) {
    await this.sql.query(
      'INSERT INTO account_audit_events(user_id, action, actor_user_id, provider, reason_code, request_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        userId,
        action,
        details.actorId ?? null,
        details.provider ?? null,
        details.reason ?? null,
        details.requestId ?? null,
      ],
    );
  }
  async createLink(userId: string, sessionId: string, email: string, passwordHash: string, tokenHash: string) {
    await this.sql.query(
      'INSERT INTO identity_link_requests(token_hash, user_id, session_id, email, password_hash) VALUES ($1, $2, $3, $4, $5)',
      [tokenHash, userId, sessionId, email, passwordHash],
    );
  }
  async linkRequest(tokenHash: string, userId: string, sessionId: string) {
    return (
      (
        await this.sql.query<{ email: string; password_hash: string }>(
          `SELECT r.email, r.password_hash FROM identity_link_requests r JOIN verification_tokens t
       ON t.token_hash = r.token_hash AND t.purpose = r.purpose WHERE r.token_hash = $1 AND r.user_id = $2
       AND r.session_id = $3 AND t.used_at IS NULL AND t.expires_at > clock_timestamp() FOR UPDATE OF r, t`,
          [tokenHash, userId, sessionId],
        )
      ).rows[0] ?? null
    );
  }
  async consumeLink(tokenHash: string) {
    await this.sql.query(
      "UPDATE verification_tokens SET used_at = clock_timestamp() WHERE token_hash = $1 AND purpose = 'identity-link'",
      [tokenHash],
    );
    await this.sql.query('DELETE FROM identity_link_requests WHERE token_hash = $1', [tokenHash]);
  }
  async deletion(userId: string) {
    return (
      (
        await this.sql.query<{ id: string; status: string; execute_at: Date; policy_version: string }>(
          'SELECT id, status, execute_at, policy_version FROM account_deletion_requests WHERE user_id = $1 ORDER BY requested_at DESC, id DESC LIMIT 1 FOR UPDATE',
          [userId],
        )
      ).rows[0] ?? null
    );
  }
  async requestDeletion(userId: string, graceHours: number, policy: string) {
    const row = (
      await this.sql.query<{ id: string; execute_at: Date }>(
        "INSERT INTO account_deletion_requests(user_id, execute_at, policy_version) VALUES ($1, clock_timestamp() + $2 * interval '1 hour', $3) RETURNING id, execute_at",
        [userId, graceHours, policy],
      )
    ).rows[0];
    await this.sql.query(
      "UPDATE users SET status = 'deleting', deletion_requested_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1",
      [userId],
    );
    return row;
  }
  async blocked(userId: string): Promise<boolean> {
    return (
      (
        await this.sql.query(
          'SELECT user_id FROM account_bans WHERE user_id = $1 AND cleared_at IS NULL AND (expires_at IS NULL OR expires_at > clock_timestamp())',
          [userId],
        )
      ).rowCount === 1
    );
  }
  async cancelDeletion(userId: string, id: string): Promise<boolean> {
    const changed =
      (
        await this.sql.query(
          "UPDATE account_deletion_requests SET status = 'cancelled', finished_at = clock_timestamp() WHERE id = $1 AND user_id = $2 AND status = 'pending' AND execute_at > clock_timestamp()",
          [id, userId],
        )
      ).rowCount === 1;
    if (changed)
      await this.sql.query(
        "UPDATE users SET status = 'active', updated_at = clock_timestamp() WHERE id = $1 AND status = 'deleting'",
        [userId],
      );
    return changed;
  }
  async ban(userId: string, reason: BanReason, expiresAt: Date | null) {
    await this.sql.query(
      'INSERT INTO account_bans(user_id, reason_code, expires_at) VALUES ($1, $2, $3) ON CONFLICT(user_id) DO UPDATE SET reason_code = $2, expires_at = $3, cleared_at = NULL',
      [userId, reason, expiresAt],
    );
    await this.sql.query(
      "UPDATE users SET status = CASE WHEN status = 'active' THEN 'banned'::user_status ELSE status END, banned_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1",
      [userId],
    );
  }
  async unban(userId: string, expiredOnly = false): Promise<boolean> {
    const changed =
      (
        await this.sql.query(
          `UPDATE account_bans SET cleared_at = clock_timestamp() WHERE user_id = $1 AND cleared_at IS NULL ${expiredOnly ? 'AND expires_at <= clock_timestamp()' : ''}`,
          [userId],
        )
      ).rowCount === 1;
    if (changed)
      await this.sql.query(
        "UPDATE users SET status = 'active', updated_at = clock_timestamp() WHERE id = $1 AND status = 'banned'",
        [userId],
      );
    return changed;
  }
  async dueDeletions() {
    return (
      await this.sql.query<{ user_id: string }>(
        "SELECT user_id FROM account_deletion_requests WHERE status = 'pending' AND execute_at <= clock_timestamp() ORDER BY execute_at, user_id LIMIT 10",
      )
    ).rows;
  }
  async dueBans() {
    return (
      await this.sql.query<{ user_id: string }>(
        'SELECT user_id FROM account_bans WHERE cleared_at IS NULL AND expires_at <= clock_timestamp() ORDER BY expires_at, user_id LIMIT 10',
      )
    ).rows;
  }
  async purgeLinks() {
    await this.sql.query(
      'DELETE FROM identity_link_requests WHERE token_hash IN (SELECT r.token_hash FROM identity_link_requests r JOIN verification_tokens t ON t.purpose = r.purpose AND t.token_hash = r.token_hash WHERE t.used_at IS NOT NULL OR t.expires_at <= clock_timestamp() LIMIT 50)',
    );
    await this.sql.query(
      `UPDATE account_mail_jobs SET abandoned_at = clock_timestamp(), encrypted_payload = NULL WHERE id IN (
        SELECT j.id FROM account_mail_jobs j JOIN verification_tokens t ON t.purpose = j.purpose AND t.token_hash = j.token_hash
        WHERE j.encrypted_payload IS NOT NULL AND (t.used_at IS NOT NULL OR t.expires_at <= clock_timestamp())
        LIMIT 50 FOR UPDATE OF j SKIP LOCKED)`,
    );
  }
  async erase(userId: string, requestId: string): Promise<boolean> {
    const due = await this.sql.query(
      "SELECT id FROM account_deletion_requests WHERE id = $1 AND user_id = $2 AND status = 'pending' AND execute_at <= clock_timestamp() FOR UPDATE",
      [requestId, userId],
    );
    if (!due.rowCount) return false;
    await this.sql.query('DELETE FROM identity_link_requests WHERE user_id = $1', [userId]);
    await this.sql.query(
      'DELETE FROM account_mail_jobs WHERE (purpose, token_hash) IN (SELECT purpose, token_hash FROM verification_tokens WHERE user_id = $1)',
      [userId],
    );
    await this.sql.query('DELETE FROM verification_tokens WHERE user_id = $1', [userId]);
    await this.sql.query('DELETE FROM password_credentials WHERE user_id = $1', [userId]);
    await this.sql.query('DELETE FROM auth_identities WHERE user_id = $1', [userId]);
    await this.sql.query('DELETE FROM profiles WHERE user_id = $1', [userId]);
    await this.sql.query("UPDATE lineups SET name = '已注销阵容', revision = revision + 1 WHERE user_id = $1", [
      userId,
    ]);
    await this.sql.query(
      'DELETE FROM session_refresh_history WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)',
      [userId],
    );
    await this.sql.query(
      'DELETE FROM session_logout_actions WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)',
      [userId],
    );
    await this.sql.query(
      "UPDATE sessions SET refresh_token_hash = 'deleted:' || id::text, csrf_token_hash = NULL, device_label = NULL, reauthenticated_at = NULL, revoked_at = COALESCE(revoked_at, clock_timestamp()) WHERE user_id = $1",
      [userId],
    );
    await this.sql.query(
      "UPDATE users SET status = 'deleted', registration_nickname = NULL, deleted_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1",
      [userId],
    );
    await this.sql.query(
      "UPDATE account_deletion_requests SET status = 'completed', finished_at = clock_timestamp() WHERE id = $1",
      [requestId],
    );
    return true;
  }
}
