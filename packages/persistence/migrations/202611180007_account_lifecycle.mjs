export function up(pgm) {
  pgm.sql(`
    ALTER TABLE sessions ADD COLUMN reauthenticated_at timestamptz;
    ALTER TABLE sessions ADD CONSTRAINT sessions_owner_unique UNIQUE(id, user_id);
    CREATE FUNCTION revoke_restricted_account_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE sessions SET revoked_at = COALESCE(revoked_at, clock_timestamp()), reauthenticated_at = NULL
          WHERE user_id = NEW.id AND (revoked_at IS NULL OR reauthenticated_at IS NOT NULL);
        RETURN NEW;
      END $$;
    CREATE TRIGGER users_restrict_sessions AFTER UPDATE OF status ON users
      FOR EACH ROW WHEN (NEW.status <> 'active') EXECUTE FUNCTION revoke_restricted_account_sessions();
    CREATE TABLE identity_link_requests (
      token_hash text PRIMARY KEY,
      purpose verification_purpose NOT NULL DEFAULT 'identity-link' CHECK (purpose = 'identity-link'),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      session_id uuid NOT NULL,
      email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
      password_hash text NOT NULL,
      FOREIGN KEY(session_id, user_id) REFERENCES sessions(id, user_id) ON DELETE RESTRICT,
      FOREIGN KEY(purpose, token_hash) REFERENCES verification_tokens(purpose, token_hash) ON DELETE RESTRICT
    );
    CREATE TABLE account_deletion_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled', 'completed')),
      policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 80),
      requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      execute_at timestamptz NOT NULL,
      finished_at timestamptz,
      CHECK ((status = 'pending') = (finished_at IS NULL))
    );
    CREATE UNIQUE INDEX account_deletion_pending_user ON account_deletion_requests(user_id) WHERE status = 'pending';
    CREATE INDEX account_deletion_due ON account_deletion_requests(execute_at, user_id) WHERE status = 'pending';
    CREATE TABLE account_bans (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
      expires_at timestamptz,
      cleared_at timestamptz,
      reason_code text NOT NULL CHECK (reason_code IN ('security', 'abuse', 'policy', 'support'))
    );
    CREATE INDEX account_bans_due ON account_bans(expires_at, user_id) WHERE cleared_at IS NULL AND expires_at IS NOT NULL;
    CREATE TABLE account_audit_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      action text NOT NULL CHECK (action IN ('reauthenticated', 'link_requested', 'identity_linked', 'deletion_requested', 'deletion_cancelled', 'deletion_completed', 'banned', 'unbanned', 'ban_expired')),
      provider text CHECK (provider IN ('email', 'wechat')),
      reason_code text CHECK (reason_code IN ('security', 'abuse', 'policy', 'support')),
      request_id uuid,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX account_audit_user_created ON account_audit_events(user_id, created_at DESC, id DESC);
    CREATE FUNCTION prevent_account_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Account audit events are append-only'; END $$;
    CREATE TRIGGER account_audit_immutable BEFORE UPDATE OR DELETE ON account_audit_events
      FOR EACH ROW EXECUTE FUNCTION prevent_account_audit_mutation();
  `);
}
export function down(pgm) {
  pgm.sql(`DROP TABLE account_audit_events; DROP FUNCTION prevent_account_audit_mutation();
    DROP TRIGGER users_restrict_sessions ON users; DROP FUNCTION revoke_restricted_account_sessions();
    DROP TABLE account_bans; DROP TABLE account_deletion_requests; DROP TABLE identity_link_requests;
    ALTER TABLE sessions DROP CONSTRAINT sessions_owner_unique, DROP COLUMN reauthenticated_at;`);
}
