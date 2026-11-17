export function up(pgm) {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN registration_nickname text CHECK (length(registration_nickname) BETWEEN 1 AND 64);
    ALTER TABLE auth_identities ADD COLUMN verified_at timestamptz;
    CREATE TABLE auth_rate_limits (
      key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
      bucket_start timestamptz NOT NULL,
      attempts integer NOT NULL CHECK (attempts > 0),
      PRIMARY KEY(key_hash, bucket_start)
    );
    CREATE INDEX auth_rate_limits_expiry_idx ON auth_rate_limits(bucket_start);
    CREATE TABLE account_mail_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      purpose verification_purpose NOT NULL,
      token_hash text NOT NULL,
      encrypted_payload text,
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      sent_at timestamptz,
      abandoned_at timestamptz,
      UNIQUE(purpose, token_hash),
      FOREIGN KEY(purpose, token_hash) REFERENCES verification_tokens(purpose, token_hash) ON DELETE RESTRICT
    );
    CREATE INDEX account_mail_pending_idx ON account_mail_jobs(next_attempt_at, id) WHERE sent_at IS NULL AND abandoned_at IS NULL;
  `);
}
export function down(pgm) {
  pgm.sql(`
    DROP TABLE account_mail_jobs;
    DROP TABLE auth_rate_limits;
    ALTER TABLE auth_identities DROP COLUMN verified_at;
    ALTER TABLE users DROP COLUMN registration_nickname;
  `);
}
