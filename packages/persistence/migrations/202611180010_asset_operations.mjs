export function up(pgm) {
  pgm.sql(`CREATE TABLE asset_operations (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    operation_key text NOT NULL CHECK (length(operation_key) BETWEEN 1 AND 200),
    kind text NOT NULL CHECK (kind IN ('upgrade', 'craft', 'grant', 'debit')),
    reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 100),
    source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 200),
    payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(user_id, operation_key)
  );
  CREATE UNIQUE INDEX asset_operations_source_once ON asset_operations(user_id, kind, reason, source_id) WHERE kind IN ('grant', 'debit');
  ALTER TABLE asset_ledger ALTER COLUMN created_at SET DEFAULT clock_timestamp();
  CREATE FUNCTION prevent_asset_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Asset history is append-only'; END $$;
  CREATE TRIGGER asset_ledger_immutable BEFORE UPDATE OR DELETE ON asset_ledger FOR EACH ROW EXECUTE FUNCTION prevent_asset_history_mutation();
  CREATE TRIGGER asset_operations_immutable BEFORE UPDATE OR DELETE ON asset_operations FOR EACH ROW EXECUTE FUNCTION prevent_asset_history_mutation();`);
}
export function down(pgm) {
  pgm.sql(`DROP TRIGGER asset_ledger_immutable ON asset_ledger;
    DROP TABLE asset_operations; DROP FUNCTION prevent_asset_history_mutation();
    ALTER TABLE asset_ledger ALTER COLUMN created_at SET DEFAULT now();`);
}
