export function up(pgm) {
  pgm.sql(
    'CREATE TABLE service_metadata (key text PRIMARY KEY, value jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())',
  );
}
export function down(pgm) {
  pgm.sql('DROP TABLE service_metadata');
}
