export function up(pgm) {
  pgm.sql(`CREATE TABLE matchmaking_configurations (
    hash text PRIMARY KEY CHECK(hash ~ '^[a-f0-9]{64}$'),
    payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
  );
  CREATE FUNCTION guard_matchmaking_configuration() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION 'immutable_matchmaking_configuration';
  END $$;
  CREATE TRIGGER immutable_matchmaking_configuration BEFORE UPDATE OR DELETE ON matchmaking_configurations
    FOR EACH ROW EXECUTE FUNCTION guard_matchmaking_configuration();
  CREATE TABLE matchmaking_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id uuid NOT NULL,
    room_code text NOT NULL UNIQUE CHECK(room_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
    configuration_hash text NOT NULL REFERENCES matchmaking_configurations(hash) ON DELETE RESTRICT,
    match_id uuid UNIQUE REFERENCES matches(id) ON DELETE RESTRICT,
    state text NOT NULL DEFAULT 'preparing' CHECK(state IN ('preparing','ready','failed','completed')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
  );
  CREATE TABLE matchmaking_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    intent_id uuid NOT NULL,
    payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
    session_id uuid NOT NULL,
    host_id uuid NOT NULL,
    configuration_hash text NOT NULL REFERENCES matchmaking_configurations(hash) ON DELETE RESTRICT,
    mode text NOT NULL CHECK(mode IN ('friend','ranked','growth')),
    config_version text NOT NULL,
    policy_version text NOT NULL,
    region text NOT NULL CHECK(region ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
    rating_scope text CHECK(rating_scope IN ('ranked','growth')),
    rating_season text,
    rating_points integer CHECK(rating_points>=0),
    rating_window integer NOT NULL CHECK(rating_window BETWEEN 0 AND 5000),
    lineup_snapshot jsonb NOT NULL CHECK(jsonb_typeof(lineup_snapshot)='object'),
    state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','matched','cancelled','expired','failed','completed')),
    reason text NOT NULL DEFAULT 'waiting-compatible-player'
      CHECK(reason IN ('waiting-compatible-player','paired','cancelled','timeout','account-unavailable','room-unavailable','match-completed')),
    assignment_id uuid REFERENCES matchmaking_assignments(id) ON DELETE RESTRICT,
    member integer CHECK(member IN (0,1)),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(user_id,intent_id), UNIQUE(assignment_id,member),
    CHECK((assignment_id IS NULL)=(member IS NULL)),
    CHECK(state<>'matched' OR assignment_id IS NOT NULL),
    CHECK(state<>'queued' OR assignment_id IS NULL),
    CHECK((mode='friend' AND rating_scope IS NULL AND rating_season IS NULL AND rating_points IS NULL)
      OR (mode IN ('ranked','growth') AND rating_scope=mode AND rating_season IS NOT NULL AND rating_points IS NOT NULL))
  );
  CREATE FUNCTION guard_matchmaking_entry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF ROW(NEW.id,NEW.user_id,NEW.intent_id,NEW.payload_hash,NEW.session_id,NEW.host_id,NEW.configuration_hash,
      NEW.mode,NEW.config_version,NEW.policy_version,NEW.region,NEW.rating_scope,NEW.rating_season,NEW.rating_points,
      NEW.rating_window,NEW.lineup_snapshot,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.intent_id,OLD.payload_hash,OLD.session_id,OLD.host_id,OLD.configuration_hash,
      OLD.mode,OLD.config_version,OLD.policy_version,OLD.region,OLD.rating_scope,OLD.rating_season,OLD.rating_points,
      OLD.rating_window,OLD.lineup_snapshot,OLD.created_at)
      OR (OLD.assignment_id IS NOT NULL AND ROW(NEW.assignment_id,NEW.member) IS DISTINCT FROM ROW(OLD.assignment_id,OLD.member))
    THEN RAISE EXCEPTION 'immutable_matchmaking_entry'; END IF;
    IF (OLD.state='queued' AND NEW.state NOT IN ('queued','matched','cancelled','expired','failed'))
      OR (OLD.state='matched' AND NEW.state NOT IN ('matched','expired','failed','completed'))
      OR (OLD.state IN ('cancelled','expired','failed','completed') AND NEW.state<>OLD.state)
    THEN RAISE EXCEPTION 'invalid_matchmaking_transition'; END IF;
    RETURN NEW;
  END $$;
  CREATE TRIGGER immutable_matchmaking_entry BEFORE UPDATE ON matchmaking_entries
    FOR EACH ROW EXECUTE FUNCTION guard_matchmaking_entry();
  CREATE UNIQUE INDEX matchmaking_user_active ON matchmaking_entries(user_id) WHERE state IN ('queued','matched');
  CREATE INDEX matchmaking_waiting ON matchmaking_entries(host_id,state,created_at,id) WHERE state='queued';
  CREATE INDEX matchmaking_user_history ON matchmaking_entries(user_id,created_at DESC,id DESC);
  CREATE INDEX matchmaking_assignment_members ON matchmaking_entries(assignment_id) WHERE assignment_id IS NOT NULL;
  CREATE INDEX matchmaking_assignment_due ON matchmaking_assignments(host_id,state,expires_at);`);
}
export function down(pgm) {
  pgm.sql(
    'DROP TABLE matchmaking_entries,matchmaking_assignments,matchmaking_configurations; DROP FUNCTION guard_matchmaking_configuration(),guard_matchmaking_entry()',
  );
}
