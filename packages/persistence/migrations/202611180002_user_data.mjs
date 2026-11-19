export function up(pgm) {
  pgm.sql(`
    CREATE TABLE player_definitions (
      id text PRIMARY KEY CHECK (id ~ '^p[0-9]{2,4}$')
    );
    CREATE TABLE profiles (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
      nickname text NOT NULL CHECK (length(btrim(nickname)) BETWEEN 1 AND 24),
      avatar_asset_id text NOT NULL CHECK (avatar_asset_id ~ '^[A-Za-z0-9_-]{1,64}$'),
      level integer NOT NULL DEFAULT 1 CHECK (level >= 1),
      exp bigint NOT NULL DEFAULT 0 CHECK (exp >= 0),
      version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE owned_cards (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      player_def_id text NOT NULL REFERENCES player_definitions(id) ON DELETE RESTRICT,
      level smallint NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 10),
      exp bigint NOT NULL DEFAULT 0 CHECK (exp >= 0),
      version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_id, player_def_id),
      UNIQUE(id, user_id)
    );
    CREATE TABLE lineups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
      revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(id, user_id)
    );
    CREATE INDEX lineups_user_idx ON lineups(user_id, id);
    CREATE TABLE lineup_slots (
      lineup_id uuid NOT NULL,
      user_id uuid NOT NULL,
      slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 4),
      owned_card_id uuid NOT NULL,
      PRIMARY KEY(lineup_id, slot),
      UNIQUE(lineup_id, owned_card_id),
      FOREIGN KEY(lineup_id, user_id) REFERENCES lineups(id, user_id) ON DELETE RESTRICT,
      FOREIGN KEY(owned_card_id, user_id) REFERENCES owned_cards(id, user_id) ON DELETE RESTRICT
    );
    CREATE INDEX lineup_slots_card_idx ON lineup_slots(owned_card_id);
    CREATE TABLE wallets (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      currency text NOT NULL CHECK (currency IN ('coins', 'fragments')),
      balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
      version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
      PRIMARY KEY(user_id, currency)
    );
    CREATE TABLE asset_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      currency text NOT NULL,
      delta bigint NOT NULL,
      balance_after bigint NOT NULL CHECK (balance_after >= 0),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 100),
      source_id text NOT NULL CHECK (length(btrim(source_id)) BETWEEN 1 AND 200),
      idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
      payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(user_id, currency) REFERENCES wallets(user_id, currency) ON DELETE RESTRICT,
      UNIQUE(user_id, reason, idempotency_key, currency)
    );
    CREATE INDEX asset_ledger_user_created_idx ON asset_ledger(user_id, created_at DESC, id DESC);
    CREATE TABLE matches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      mode text NOT NULL CHECK (mode IN ('practice', 'friend', 'growth', 'ranked')),
      config_version text NOT NULL CHECK (length(btrim(config_version)) > 0),
      protocol_version integer NOT NULL CHECK (protocol_version > 0),
      status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'playing', 'settlement-pending', 'settled', 'void')),
      result jsonb CHECK (jsonb_typeof(result) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );
    CREATE INDEX matches_status_idx ON matches(status, created_at);
    CREATE TABLE match_participants (
      match_id uuid NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      side smallint NOT NULL CHECK (side IN (0, 1)),
      lineup_snapshot jsonb NOT NULL CHECK (jsonb_typeof(lineup_snapshot) = 'array' AND jsonb_array_length(lineup_snapshot) = 5),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(match_id, user_id),
      UNIQUE(match_id, side)
    );
    CREATE INDEX match_participants_user_created_idx ON match_participants(user_id, created_at DESC, match_id);
    CREATE TABLE outbox_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type text NOT NULL CHECK (length(btrim(type)) BETWEEN 1 AND 100),
      aggregate_id text NOT NULL CHECK (length(btrim(aggregate_id)) BETWEEN 1 AND 200),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      processed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX outbox_pending_idx ON outbox_events(next_attempt_at, id) WHERE processed_at IS NULL;
  `);
}

export function down(pgm) {
  pgm.sql(`
    DROP TABLE outbox_events;
    DROP TABLE match_participants;
    DROP TABLE matches;
    DROP TABLE asset_ledger;
    DROP TABLE wallets;
    DROP TABLE lineup_slots;
    DROP TABLE lineups;
    DROP TABLE owned_cards;
    DROP TABLE profiles;
    DROP TABLE player_definitions;
  `);
}
