import type { SqlExecutor } from './database';
import { AccountRepository, type VerificationPurpose } from './accounts';

export class EmailAuthRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async createAccount(email: string, passwordHash: string, nickname: string): Promise<string> {
    const accounts = new AccountRepository(this.sql);
    const user = await accounts.createUser();
    await accounts.linkIdentity({
      userId: user.id,
      provider: 'email',
      providerAppId: 'primary',
      providerSubject: email,
    });
    await accounts.setPasswordCredential({ userId: user.id, passwordHash });
    await this.sql.query('UPDATE users SET registration_nickname = $2 WHERE id = $1', [user.id, nickname]);
    return user.id;
  }

  async verifiedActiveUser(email: string): Promise<string | null> {
    const result = await this.sql.query<{ id: string }>(
      `SELECT u.id FROM users u JOIN auth_identities i ON i.user_id = u.id
       WHERE i.provider = 'email' AND i.provider_app_id = 'primary' AND i.provider_subject = $1
       AND i.verified_at IS NOT NULL AND u.status = 'active' FOR UPDATE OF u`,
      [email],
    );
    return result.rows[0]?.id ?? null;
  }

  async unverifiedActiveUser(email: string): Promise<string | null> {
    const result = await this.sql.query<{ id: string }>(
      `SELECT u.id FROM users u JOIN auth_identities i ON i.user_id = u.id
       WHERE i.provider = 'email' AND i.provider_app_id = 'primary' AND i.provider_subject = $1
       AND i.verified_at IS NULL AND u.status = 'active' FOR UPDATE OF u`,
      [email],
    );
    return result.rows[0]?.id ?? null;
  }

  /** The hash stays inside this trusted credential boundary and never becomes a public account DTO. */
  async authenticate(email: string, check: (hash: string | null) => Promise<boolean>): Promise<string | null> {
    const result = await this.sql.query<{
      id: string;
      status: string;
      verified_at: Date | null;
      password_hash: string | null;
    }>(
      `SELECT u.id, u.status, i.verified_at, c.password_hash FROM users u
       JOIN auth_identities i ON i.user_id = u.id LEFT JOIN password_credentials c ON c.user_id = u.id
       WHERE i.provider = 'email' AND i.provider_app_id = 'primary' AND i.provider_subject = $1 FOR UPDATE OF u`,
      [email],
    );
    const row = result.rows[0];
    const valid = await check(row?.password_hash ?? null);
    return row?.status === 'active' && row.verified_at && valid ? row.id : null;
  }

  async lockTokenUser(purpose: VerificationPurpose, tokenHash: string): Promise<string | null> {
    const result = await this.sql.query<{ id: string }>(
      `SELECT u.id FROM users u JOIN verification_tokens t ON t.user_id = u.id
       WHERE t.purpose = $1::verification_purpose AND t.token_hash = $2 AND t.used_at IS NULL
       AND t.expires_at > now() AND u.status = 'active' FOR UPDATE OF u`,
      [purpose, tokenHash],
    );
    return result.rows[0]?.id ?? null;
  }

  async verifyEmail(userId: string): Promise<void> {
    await this.sql.query(
      "UPDATE auth_identities SET verified_at = COALESCE(verified_at, now()) WHERE user_id = $1 AND provider = 'email' AND provider_app_id = 'primary'",
      [userId],
    );
  }

  async invalidateTokens(userId: string, purpose: VerificationPurpose): Promise<void> {
    await this.sql.query(
      'UPDATE verification_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2::verification_purpose AND used_at IS NULL',
      [userId, purpose],
    );
  }

  async revokeSessions(userId: string): Promise<void> {
    await this.sql.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  }

  async rateLimit(keyHash: string, windowSeconds: number, maximum: number): Promise<boolean> {
    const result = await this.sql.query<{ allowed: boolean }>(
      `INSERT INTO auth_rate_limits(key_hash, bucket_start, attempts)
       VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
       ON CONFLICT (key_hash, bucket_start) DO UPDATE SET attempts = LEAST(auth_rate_limits.attempts + 1, $3 + 1)
       RETURNING attempts <= $3 AS allowed`,
      [keyHash, windowSeconds, maximum],
    );
    await this.sql.query(
      "DELETE FROM auth_rate_limits WHERE ctid IN (SELECT ctid FROM auth_rate_limits WHERE bucket_start < now() - interval '1 day' LIMIT 100)",
    );
    return result.rows[0].allowed;
  }

  async enqueueMail(purpose: VerificationPurpose, tokenHash: string, encryptedPayload: string): Promise<void> {
    await this.sql.query('INSERT INTO account_mail_jobs(purpose, token_hash, encrypted_payload) VALUES ($1, $2, $3)', [
      purpose,
      tokenHash,
      encryptedPayload,
    ]);
  }

  async claimMail(): Promise<{
    id: string;
    encrypted_payload: string;
    purpose: 'email-verification' | 'password-reset';
    attempts: number;
    valid: boolean;
  } | null> {
    return (
      (
        await this.sql.query<{
          id: string;
          encrypted_payload: string;
          purpose: 'email-verification' | 'password-reset';
          attempts: number;
          valid: boolean;
        }>(
          `SELECT j.id, j.encrypted_payload, j.purpose, j.attempts, (t.used_at IS NULL AND t.expires_at > now() AND u.status = 'active') AS valid
       FROM account_mail_jobs j JOIN verification_tokens t ON t.purpose = j.purpose AND t.token_hash = j.token_hash JOIN users u ON u.id = t.user_id
       WHERE j.sent_at IS NULL AND j.abandoned_at IS NULL AND j.next_attempt_at <= now()
       ORDER BY j.next_attempt_at, j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,
        )
      ).rows[0] ?? null
    );
  }

  async finishMail(id: string, outcome: 'sent' | 'retry' | 'abandoned'): Promise<void> {
    await this.sql.query(
      `UPDATE account_mail_jobs SET attempts = attempts + 1,
      sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
      abandoned_at = CASE WHEN $2 = 'abandoned' OR ($2 = 'retry' AND attempts >= 4) THEN now() ELSE abandoned_at END,
      next_attempt_at = now() + make_interval(secs => LEAST(900, 5 * power(2, attempts))::int),
      encrypted_payload = CASE WHEN $2 <> 'retry' OR attempts >= 4 THEN NULL ELSE encrypted_payload END WHERE id = $1`,
      [id, outcome],
    );
  }
}
