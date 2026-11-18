export function up(pgm) {
  pgm.sql(`CREATE TABLE data_repair_receipts (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('restore-wallet','compensate','retry-settlement')),
    case_id text NOT NULL CHECK (case_id ~ '^[A-Z0-9][A-Z0-9_:./-]{0,99}$'),
    target_key text NOT NULL CHECK (length(target_key) BETWEEN 1 AND 200),
    user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    match_id uuid REFERENCES matches(id) ON DELETE RESTRICT,
    payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
    plan jsonb NOT NULL CHECK (jsonb_typeof(plan)='object'),
    receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(kind,case_id,target_key)
  );
  CREATE INDEX data_repairs_user_created_idx ON data_repair_receipts(user_id,created_at);
  CREATE INDEX data_repairs_match_created_idx ON data_repair_receipts(match_id,created_at);
  CREATE TRIGGER data_repairs_immutable BEFORE UPDATE OR DELETE ON data_repair_receipts
    FOR EACH ROW EXECUTE FUNCTION prevent_asset_history_mutation();`);
}
export function down(pgm) {
  pgm.sql('DROP TABLE data_repair_receipts');
}
