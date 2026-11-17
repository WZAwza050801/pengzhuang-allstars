import type { SqlExecutor } from './database';

export type Currency = 'coins' | 'fragments';
export interface UserProfile {
  userId: string;
  nickname: string;
  avatarAssetId: string;
  level: number;
  exp: string;
  version: number;
}
export interface OwnedCard {
  id: string;
  userId: string;
  playerDefId: string;
  level: number;
  exp: string;
  version: number;
}
export interface Wallet {
  userId: string;
  currency: Currency;
  balance: string;
  version: number;
}
export interface LedgerEntry {
  id: string;
  userId: string;
  currency: Currency;
  delta: string;
  balanceAfter: string;
  reason: string;
  sourceId: string;
  idempotencyKey: string;
  payloadHash: string;
}

const profileColumns = 'user_id AS "userId", nickname, avatar_asset_id AS "avatarAssetId", level, exp::text, version';
const cardColumns = 'id, user_id AS "userId", player_def_id AS "playerDefId", level, exp::text, version';
const walletColumns = 'user_id AS "userId", currency, balance::text, version';
const ledgerColumns =
  'id, user_id AS "userId", currency, delta::text, balance_after::text AS "balanceAfter", reason, source_id AS "sourceId", idempotency_key AS "idempotencyKey", payload_hash AS "payloadHash"';

function integerAmount(value: bigint, signed = false): string {
  if (typeof value !== 'bigint' || value < (signed ? -9223372036854775808n : 0n) || value > 9223372036854775807n)
    throw new Error('Amount must be an exact PostgreSQL bigint');
  return value.toString();
}

function pageLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Page limit must be between 1 and 100');
  return limit;
}

/** Trusted server persistence; business authorization and atomic operations belong to services. */
export class UserDataRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async registerPlayerDefinitions(ids: readonly string[]): Promise<void> {
    await this.sql.query('INSERT INTO player_definitions(id) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [ids]);
  }

  async createProfile(input: { userId: string; nickname: string; avatarAssetId: string }): Promise<UserProfile> {
    const result = await this.sql.query<UserProfile>(
      `INSERT INTO profiles(user_id, nickname, avatar_asset_id) VALUES ($1, $2, $3) RETURNING ${profileColumns}`,
      [input.userId, input.nickname, input.avatarAssetId],
    );
    return result.rows[0];
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    return (
      (await this.sql.query<UserProfile>(`SELECT ${profileColumns} FROM profiles WHERE user_id = $1`, [userId]))
        .rows[0] ?? null
    );
  }

  async createCard(input: { userId: string; playerDefId: string; level?: number }): Promise<OwnedCard> {
    const result = await this.sql.query<OwnedCard>(
      `INSERT INTO owned_cards(user_id, player_def_id, level) VALUES ($1, $2, $3) RETURNING ${cardColumns}`,
      [input.userId, input.playerDefId, input.level ?? 1],
    );
    return result.rows[0];
  }

  async listCards(userId: string, options: { afterId?: string; limit?: number } = {}): Promise<OwnedCard[]> {
    return (
      await this.sql.query<OwnedCard>(
        `SELECT ${cardColumns} FROM owned_cards WHERE user_id = $1 AND ($2::uuid IS NULL OR id > $2::uuid) ORDER BY id LIMIT $3`,
        [userId, options.afterId ?? null, pageLimit(options.limit ?? 50)],
      )
    ).rows;
  }

  async createLineup(
    userId: string,
    name: string,
  ): Promise<{ id: string; userId: string; name: string; revision: number }> {
    return (
      await this.sql.query<{ id: string; userId: string; name: string; revision: number }>(
        'INSERT INTO lineups(user_id, name) VALUES ($1, $2) RETURNING id, user_id AS "userId", name, revision',
        [userId, name],
      )
    ).rows[0];
  }

  async addLineupSlot(input: { lineupId: string; userId: string; slot: number; ownedCardId: string }): Promise<void> {
    await this.sql.query('INSERT INTO lineup_slots(lineup_id, user_id, slot, owned_card_id) VALUES ($1, $2, $3, $4)', [
      input.lineupId,
      input.userId,
      input.slot,
      input.ownedCardId,
    ]);
  }

  async createWallet(userId: string, currency: Currency, balance = 0n): Promise<Wallet> {
    return (
      await this.sql.query<Wallet>(
        `INSERT INTO wallets(user_id, currency, balance) VALUES ($1, $2, $3) RETURNING ${walletColumns}`,
        [userId, currency, integerAmount(balance)],
      )
    ).rows[0];
  }

  async getWallets(userId: string): Promise<Wallet[]> {
    return (
      await this.sql.query<Wallet>(`SELECT ${walletColumns} FROM wallets WHERE user_id = $1 ORDER BY currency`, [
        userId,
      ])
    ).rows;
  }

  async appendLedger(input: {
    userId: string;
    currency: Currency;
    delta: bigint;
    balanceAfter: bigint;
    reason: string;
    sourceId: string;
    idempotencyKey: string;
    payloadHash: string;
  }): Promise<LedgerEntry> {
    return (
      await this.sql.query<LedgerEntry>(
        `INSERT INTO asset_ledger(user_id, currency, delta, balance_after, reason, source_id, idempotency_key, payload_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${ledgerColumns}`,
        [
          input.userId,
          input.currency,
          integerAmount(input.delta, true),
          integerAmount(input.balanceAfter),
          input.reason,
          input.sourceId,
          input.idempotencyKey,
          input.payloadHash,
        ],
      )
    ).rows[0];
  }
}

export interface StoredMatch {
  id: string;
  mode: 'practice' | 'friend' | 'growth' | 'ranked';
  configVersion: string;
  protocolVersion: number;
  status: 'created' | 'playing' | 'settlement-pending' | 'settled' | 'void';
}
export interface OutboxEvent {
  id: string;
  type: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  attempts: number;
  nextAttemptAt: Date;
}

export class MatchDataRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async createMatch(input: Pick<StoredMatch, 'mode' | 'configVersion' | 'protocolVersion'>): Promise<StoredMatch> {
    return (
      await this.sql.query<StoredMatch>(
        'INSERT INTO matches(mode, config_version, protocol_version) VALUES ($1, $2, $3) RETURNING id, mode, config_version AS "configVersion", protocol_version AS "protocolVersion", status',
        [input.mode, input.configVersion, input.protocolVersion],
      )
    ).rows[0];
  }

  async addParticipant(input: {
    matchId: string;
    userId: string;
    side: 0 | 1;
    lineupSnapshot: readonly Record<string, unknown>[];
  }): Promise<void> {
    await this.sql.query(
      'INSERT INTO match_participants(match_id, user_id, side, lineup_snapshot) VALUES ($1, $2, $3, $4::jsonb)',
      [input.matchId, input.userId, input.side, JSON.stringify(input.lineupSnapshot)],
    );
  }

  async enqueue(input: { type: string; aggregateId: string; payload: Record<string, unknown> }): Promise<string> {
    return (
      await this.sql.query<{ id: string }>(
        'INSERT INTO outbox_events(type, aggregate_id, payload) VALUES ($1, $2, $3::jsonb) RETURNING id',
        [input.type, input.aggregateId, JSON.stringify(input.payload)],
      )
    ).rows[0].id;
  }

  async pendingOutbox(limit = 50): Promise<OutboxEvent[]> {
    return (
      await this.sql.query<OutboxEvent>(
        `SELECT id, type, aggregate_id AS "aggregateId", payload, attempts, next_attempt_at AS "nextAttemptAt"
       FROM outbox_events WHERE processed_at IS NULL AND next_attempt_at <= now() ORDER BY next_attempt_at, id LIMIT $1`,
        [pageLimit(limit)],
      )
    ).rows;
  }
}
