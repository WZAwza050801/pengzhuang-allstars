export function up(pgm) {
  pgm.sql(`
    ALTER TABLE matches
      ADD COLUMN room_code text CHECK (room_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
      ADD COLUMN recovery_closed_at timestamptz,
      ADD COLUMN recovery_close_reason text CHECK (recovery_close_reason IN ('ended', 'abandoned', 'expired')),
      ADD CONSTRAINT match_recovery_closed_pair CHECK ((recovery_closed_at IS NULL) = (recovery_close_reason IS NULL));
    CREATE INDEX matches_recovery_room_idx ON matches(room_code) WHERE room_code IS NOT NULL;
  `);
}
export function down(pgm) {
  pgm.sql(
    `ALTER TABLE matches DROP COLUMN recovery_close_reason, DROP COLUMN recovery_closed_at, DROP COLUMN room_code;`,
  );
}
