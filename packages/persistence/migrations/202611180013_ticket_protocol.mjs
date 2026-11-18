export function up(pgm) {
  pgm.sql(
    'ALTER TABLE match_tickets ADD COLUMN protocol_version smallint NOT NULL DEFAULT 1 CHECK (protocol_version IN (1, 2));',
  );
}
export function down(pgm) {
  pgm.sql('ALTER TABLE match_tickets DROP COLUMN protocol_version;');
}
