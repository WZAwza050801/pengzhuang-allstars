export function up(pgm) {
  pgm.sql(`
    CREATE TABLE session_logout_actions (
      session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
      operation_id uuid PRIMARY KEY,
      all_sessions boolean NOT NULL,
      completed_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX sessions_active_page_idx ON sessions(user_id, created_at DESC, id DESC) WHERE revoked_at IS NULL;
  `);
}
export function down(pgm) {
  pgm.sql('DROP INDEX sessions_active_page_idx; DROP TABLE session_logout_actions;');
}
