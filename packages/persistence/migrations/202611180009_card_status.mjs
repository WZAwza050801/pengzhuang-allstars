export function up(pgm) {
  pgm.sql(
    "ALTER TABLE owned_cards ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled'));",
  );
}
export function down(pgm) {
  pgm.sql('ALTER TABLE owned_cards DROP COLUMN status;');
}
