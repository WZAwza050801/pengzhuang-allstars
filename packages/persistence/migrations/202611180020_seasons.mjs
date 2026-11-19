export function up(pgm) {
  pgm.sql(`CREATE TABLE seasons (
    id text PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9._-]{1,80}$'),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','active','closed')),
    closed_at timestamptz,
    CHECK(ends_at > starts_at)
  );
  CREATE TABLE season_history (
    season_id text NOT NULL REFERENCES seasons(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    scope text NOT NULL CHECK(scope IN ('ranked','growth')),
    points integer NOT NULL CHECK(points>=0),
    wins integer NOT NULL DEFAULT 0 CHECK(wins>=0),
    draws integer NOT NULL DEFAULT 0 CHECK(draws>=0),
    losses integer NOT NULL DEFAULT 0 CHECK(losses>=0),
    tier_id text NOT NULL,
    tier_label text NOT NULL,
    reward_coins bigint NOT NULL DEFAULT 0 CHECK(reward_coins>=0),
    frozen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(season_id,user_id,scope)
  );
  CREATE FUNCTION guard_season_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION 'immutable_season_history';
  END $$;
  CREATE TRIGGER immutable_season_history BEFORE UPDATE OR DELETE ON season_history
    FOR EACH ROW EXECUTE FUNCTION guard_season_history();
  CREATE TABLE season_rewards (
    season_id text NOT NULL REFERENCES seasons(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    scope text NOT NULL CHECK(scope IN ('ranked','growth')),
    operation_id text NOT NULL CHECK(operation_id ~ '^[A-Za-z0-9_:./-]{1,200}$'),
    coins bigint NOT NULL DEFAULT 0 CHECK(coins>=0),
    granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(season_id,user_id,scope)
  );
  CREATE INDEX season_history_board ON season_history(season_id,scope,points DESC,user_id);`);
}
export function down(pgm) {
  pgm.sql('DROP TABLE season_rewards,season_history,seasons; DROP FUNCTION guard_season_history()');
}
