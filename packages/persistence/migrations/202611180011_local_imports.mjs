export function up(pgm) {
  pgm.sql(`CREATE TABLE account_local_imports (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
  );`);
}
export function down(pgm) {
  pgm.dropTable('account_local_imports');
}
