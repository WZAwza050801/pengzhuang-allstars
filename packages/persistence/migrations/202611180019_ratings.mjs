export function up(pgm) {
  pgm.sql(`CREATE TABLE ratings (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    scope text NOT NULL CHECK(scope IN ('ranked','growth')),
    season text NOT NULL CHECK(season ~ '^[A-Za-z0-9._-]{1,80}$'),
    points integer NOT NULL CHECK(points>=0),
    wins integer NOT NULL DEFAULT 0 CHECK(wins>=0),
    draws integer NOT NULL DEFAULT 0 CHECK(draws>=0),
    losses integer NOT NULL DEFAULT 0 CHECK(losses>=0),
    version integer NOT NULL DEFAULT 0 CHECK(version>=0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(user_id,scope,season)
  );
  CREATE TABLE rating_applications (
    match_id uuid NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    scope text NOT NULL CHECK(scope IN ('ranked','growth')),
    season text NOT NULL CHECK(season ~ '^[A-Za-z0-9._-]{1,80}$'),
    result text NOT NULL CHECK(result IN ('win','draw','loss')),
    delta integer NOT NULL,
    points_after integer NOT NULL CHECK(points_after>=0),
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(match_id,user_id)
  );
  CREATE FUNCTION guard_rating_application() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION 'immutable_rating_application';
  END $$;
  CREATE TRIGGER immutable_rating_application BEFORE UPDATE OR DELETE ON rating_applications
    FOR EACH ROW EXECUTE FUNCTION guard_rating_application();
  CREATE INDEX ratings_leaderboard ON ratings(scope,season,points DESC,user_id);
  CREATE INDEX rating_applications_user ON rating_applications(user_id,applied_at DESC);`);
}
export function down(pgm) {
  pgm.sql('DROP TABLE rating_applications,ratings; DROP FUNCTION guard_rating_application()');
}
