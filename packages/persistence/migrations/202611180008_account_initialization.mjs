export function up(pgm) {
  pgm.sql(`CREATE TABLE account_initializations (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    grant_id text NOT NULL CHECK (length(grant_id) BETWEEN 1 AND 80),
    economy_version text NOT NULL,
    data_version text NOT NULL,
    payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    default_lineup_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(default_lineup_id, user_id) REFERENCES lineups(id, user_id) ON DELETE RESTRICT
  );`);
}
export function down(pgm) {
  pgm.sql('DROP TABLE account_initializations;');
}
