export function up(pgm) {
  pgm.sql(`CREATE TABLE match_checkpoints (
    match_id uuid NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
    ordinal bigint NOT NULL CHECK (ordinal>=0),
    revision bigint NOT NULL CHECK (revision>=0),
    seq bigint NOT NULL CHECK (seq>=0),
    event text NOT NULL CHECK (event IN ('start','shot','update','presence','terminal')),
    payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(match_id,ordinal)
  );
  CREATE TABLE match_recovery_heads (
    match_id uuid PRIMARY KEY REFERENCES matches(id) ON DELETE RESTRICT,
    checkpoint bigint NOT NULL CHECK (checkpoint>=0),
    owner_id uuid NOT NULL,
    storage_id uuid NOT NULL,
    epoch bigint NOT NULL CHECK (epoch>=1),
    lease_until timestamptz NOT NULL,
    FOREIGN KEY(match_id,checkpoint) REFERENCES match_checkpoints(match_id,ordinal) DEFERRABLE INITIALLY DEFERRED
  );
  CREATE INDEX match_recovery_due_idx ON match_recovery_heads(lease_until,match_id);
  CREATE FUNCTION guard_match_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM match_recovery_heads WHERE match_id=OLD.match_id)
      AND (EXISTS(SELECT 1 FROM match_outcomes WHERE match_id=OLD.match_id AND settled_at IS NOT NULL)
        OR (OLD.ordinal=0 AND OLD.seq=0
          AND NOT EXISTS(SELECT 1 FROM match_checkpoints WHERE match_id=OLD.match_id AND ordinal<>0)
          AND EXISTS(SELECT 1 FROM matches m WHERE m.id=OLD.match_id AND m.status='playing' AND m.result IS NULL
            AND m.recovery_closed_at IS NOT NULL AND m.recovery_close_reason='abandoned')
          AND NOT EXISTS(SELECT 1 FROM match_outcomes WHERE match_id=OLD.match_id)))
    THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'immutable_running_checkpoint';
  END $$;
  CREATE TRIGGER immutable_match_checkpoint BEFORE UPDATE OR DELETE ON match_checkpoints FOR EACH ROW EXECUTE FUNCTION guard_match_checkpoint();`);
}
export function down(pgm) {
  pgm.sql('DROP TABLE match_recovery_heads,match_checkpoints; DROP FUNCTION guard_match_checkpoint()');
}
