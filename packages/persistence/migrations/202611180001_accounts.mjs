export function up(pgm) {
  pgm.sql("CREATE TYPE user_status AS ENUM ('active', 'banned', 'deleting', 'deleted')");
  pgm.sql("CREATE TYPE verification_purpose AS ENUM ('email-verification', 'password-reset', 'identity-link')");
  pgm.sql(`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      status user_status NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      banned_at timestamptz,
      deletion_requested_at timestamptz,
      deleted_at timestamptz,
      CHECK (status <> 'banned' OR banned_at IS NOT NULL),
      CHECK (status <> 'deleting' OR deletion_requested_at IS NOT NULL),
      CHECK (status <> 'deleted' OR deleted_at IS NOT NULL)
    )
  `);
  pgm.sql(`
    CREATE TABLE auth_identities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      provider text NOT NULL CHECK (length(btrim(provider)) > 0),
      provider_app_id text NOT NULL CHECK (length(btrim(provider_app_id)) > 0),
      provider_subject text NOT NULL CHECK (length(btrim(provider_subject)) > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (provider, provider_app_id, provider_subject),
      UNIQUE (user_id, provider, provider_app_id)
    )
  `);
  pgm.sql(`
    CREATE TABLE password_credentials (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
      password_hash text NOT NULL CHECK (length(password_hash) > 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`
    CREATE TABLE verification_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      purpose verification_purpose NOT NULL,
      token_hash text NOT NULL CHECK (length(token_hash) > 0),
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (expires_at > created_at),
      CHECK (used_at IS NULL OR used_at >= created_at),
      UNIQUE (purpose, token_hash)
    )
  `);
  pgm.sql(`
    CREATE TABLE sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      refresh_token_hash text NOT NULL UNIQUE CHECK (length(refresh_token_hash) > 0),
      family_id uuid NOT NULL,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      device_label text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (expires_at > created_at),
      CHECK (revoked_at IS NULL OR revoked_at >= created_at)
    )
  `);
  pgm.sql('CREATE INDEX users_created_at_idx ON users(created_at DESC)');
  pgm.sql('CREATE INDEX users_status_updated_at_idx ON users(status, updated_at DESC)');
  pgm.sql('CREATE INDEX sessions_user_revoked_at_idx ON sessions(user_id, revoked_at)');
  pgm.sql('CREATE INDEX verification_tokens_user_purpose_idx ON verification_tokens(user_id, purpose)');
}

export function down(pgm) {
  pgm.sql('DROP TABLE sessions');
  pgm.sql('DROP TABLE verification_tokens');
  pgm.sql('DROP TABLE password_credentials');
  pgm.sql('DROP TABLE auth_identities');
  pgm.sql('DROP TABLE users');
  pgm.sql('DROP TYPE verification_purpose');
  pgm.sql('DROP TYPE user_status');
}
