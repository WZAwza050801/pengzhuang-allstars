export function up(pgm) {
  pgm.sql(`
    CREATE TABLE match_tickets (
      nonce_hash text PRIMARY KEY CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
      room_code text NOT NULL CHECK (room_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
      mode text NOT NULL CHECK (mode IN ('friend', 'ranked', 'growth')),
      config_version text NOT NULL,
      lineup_snapshot jsonb NOT NULL CHECK (jsonb_typeof(lineup_snapshot) = 'object'),
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX match_tickets_expiry_idx ON match_tickets(expires_at);
    CREATE INDEX match_tickets_owner_idx ON match_tickets(user_id, created_at DESC);
  `);
}
export function down(pgm) {
  pgm.sql('DROP TABLE match_tickets;');
}
