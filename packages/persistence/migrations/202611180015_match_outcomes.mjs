export function up(pgm) {
  pgm.sql(`
    CREATE TABLE match_settlement_configurations (
      hash text PRIMARY KEY CHECK (hash ~ '^[0-9a-f]{64}$'),
      game_version text NOT NULL,
      economy_version text NOT NULL,
      modes_version text NOT NULL,
      mode text NOT NULL CHECK (mode IN ('friend','growth','ranked')),
      game_data jsonb NOT NULL CHECK (jsonb_typeof(game_data)='object'),
      economy_policy jsonb NOT NULL CHECK (jsonb_typeof(economy_policy)='object'),
      mode_rules jsonb NOT NULL CHECK (jsonb_typeof(mode_rules)='object'),
      UNIQUE(game_version,economy_version,modes_version,mode)
    );
    CREATE TABLE match_settlement_contexts (
      match_id uuid PRIMARY KEY REFERENCES matches(id) ON DELETE RESTRICT,
      configuration_hash text NOT NULL REFERENCES match_settlement_configurations(hash) ON DELETE RESTRICT
    );
    CREATE TABLE match_outcomes (
      match_id uuid PRIMARY KEY REFERENCES match_settlement_contexts(match_id) ON DELETE RESTRICT,
      payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
      final_seq bigint NOT NULL CHECK (final_seq>=0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      settled_at timestamptz
    );
    CREATE INDEX match_outcomes_pending_idx ON match_outcomes(created_at,match_id) WHERE settled_at IS NULL;
    CREATE TABLE match_rewards (
      match_id uuid NOT NULL REFERENCES match_outcomes(match_id) ON DELETE RESTRICT,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reward_type text NOT NULL CHECK (reward_type='completion'),
      eligible boolean NOT NULL,
      coins bigint NOT NULL CHECK (coins>=0),
      fragments bigint NOT NULL CHECK (fragments>=0),
      player_def_id text CHECK (player_def_id ~ '^p[0-9]{2,4}$'),
      operation_id uuid,
      ledger_ids uuid[] NOT NULL DEFAULT '{}',
      day_key date NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(match_id,user_id,reward_type)
    );
    CREATE TABLE match_reward_days (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      day_key date NOT NULL,
      earned_coins bigint NOT NULL DEFAULT 0 CHECK (earned_coins>=0),
      card_claimed boolean NOT NULL DEFAULT false,
      qualified_matches integer NOT NULL DEFAULT 0 CHECK (qualified_matches>=0),
      PRIMARY KEY(user_id,day_key)
    );
    CREATE TABLE match_participation_progress (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      economy_version text NOT NULL,
      progress integer NOT NULL DEFAULT 0 CHECK (progress>=0),
      claim_index bigint NOT NULL DEFAULT 0 CHECK (claim_index>=0),
      PRIMARY KEY(user_id,economy_version)
    );
    ALTER TABLE outbox_events ADD COLUMN error_code text CHECK (error_code ~ '^[a-z-]{1,64}$');
    CREATE UNIQUE INDEX match_settlement_event_once ON outbox_events(type,aggregate_id) WHERE type='match.settle';
    CREATE FUNCTION guard_match_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' OR NEW.match_id IS DISTINCT FROM OLD.match_id OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
         OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.final_seq IS DISTINCT FROM OLD.final_seq OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN RAISE EXCEPTION 'immutable_match_outcome'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER immutable_match_outcome BEFORE UPDATE OR DELETE ON match_outcomes FOR EACH ROW EXECUTE FUNCTION guard_match_outcome();
    CREATE FUNCTION guard_match_settlement_record() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'immutable_match_settlement_record'; END $$;
    CREATE TRIGGER immutable_match_configuration BEFORE UPDATE OR DELETE ON match_settlement_configurations FOR EACH ROW EXECUTE FUNCTION guard_match_settlement_record();
    CREATE TRIGGER immutable_match_reward BEFORE UPDATE OR DELETE ON match_rewards FOR EACH ROW EXECUTE FUNCTION guard_match_settlement_record();
  `);
}
export function down(pgm) {
  pgm.sql(`
    DROP TABLE match_participation_progress,match_reward_days,match_rewards,match_outcomes,match_settlement_contexts,match_settlement_configurations;
    DROP FUNCTION guard_match_settlement_record(); DROP FUNCTION guard_match_outcome();
    DROP INDEX match_settlement_event_once; ALTER TABLE outbox_events DROP COLUMN error_code;
  `);
}
