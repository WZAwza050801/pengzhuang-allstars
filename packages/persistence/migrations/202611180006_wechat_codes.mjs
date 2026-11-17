export function up(pgm) {
  pgm.sql(`
    CREATE TABLE wechat_code_attempts (
      app_id text NOT NULL CHECK (length(app_id) BETWEEN 1 AND 128),
      code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
      user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      completed_at timestamptz,
      PRIMARY KEY(app_id, code_hash),
      CHECK (expires_at > created_at),
      CHECK ((status = 'pending') = (completed_at IS NULL)),
      CHECK ((status = 'succeeded') = (user_id IS NOT NULL))
    );
    CREATE INDEX wechat_codes_retention_idx ON wechat_code_attempts(created_at);
  `);
}
export function down(pgm) {
  pgm.sql('DROP TABLE wechat_code_attempts;');
}
