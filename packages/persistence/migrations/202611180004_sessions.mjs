export function up(pgm) {
  pgm.sql(`
    ALTER TABLE sessions ADD COLUMN refresh_generation integer NOT NULL DEFAULT 0 CHECK (refresh_generation >= 0);
    ALTER TABLE sessions ADD COLUMN csrf_token_hash text CHECK (csrf_token_hash ~ '^[0-9a-f]{64}$');
    -- Pre-rotation sessions have no CSRF binding and must authenticate again.
    UPDATE sessions SET revoked_at = clock_timestamp() WHERE revoked_at IS NULL;
    CREATE INDEX sessions_family_idx ON sessions(family_id);
    CREATE TABLE session_refresh_history (
      token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
      session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
      generation integer NOT NULL CHECK (generation >= 0),
      consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(session_id, generation)
    );
  `);
}
export function down(pgm) {
  pgm.sql(`
    DROP TABLE session_refresh_history;
    DROP INDEX sessions_family_idx;
    ALTER TABLE sessions DROP COLUMN csrf_token_hash, DROP COLUMN refresh_generation;
  `);
}
