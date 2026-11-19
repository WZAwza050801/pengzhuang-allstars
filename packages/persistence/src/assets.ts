import type { SqlExecutor } from './database';
import type { OwnedCard, Wallet, Currency } from './user-data';

export class AssetRepository {
  constructor(private readonly sql: SqlExecutor) {}
  async operation(userId: string, operationId: string) {
    return (
      (
        await this.sql.query<{ payload_hash: string; result: unknown }>(
          'SELECT payload_hash, result FROM asset_operations WHERE user_id = $1 AND operation_key = $2',
          [userId, operationId],
        )
      ).rows[0] ?? null
    );
  }
  async record(
    userId: string,
    operationId: string,
    kind: string,
    reason: string,
    sourceId: string,
    payloadHash: string,
    result: unknown,
  ) {
    await this.sql.query(
      'INSERT INTO asset_operations(user_id, operation_key, kind, reason, source_id, payload_hash, result) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [userId, operationId, kind, reason, sourceId, payloadHash, JSON.stringify(result)],
    );
  }
  async sourceExists(userId: string, kind: string, reason: string, sourceId: string): Promise<boolean> {
    return (
      (
        await this.sql.query(
          'SELECT operation_key FROM asset_operations WHERE user_id = $1 AND kind = $2 AND reason = $3 AND source_id = $4',
          [userId, kind, reason, sourceId],
        )
      ).rowCount === 1
    );
  }
  async lockUser(userId: string) {
    return (
      (await this.sql.query<{ status: string }>('SELECT status FROM users WHERE id = $1 FOR UPDATE', [userId]))
        .rows[0] ?? null
    );
  }
  async lockWallets(userId: string) {
    return (
      await this.sql.query<Wallet>(
        'SELECT user_id AS "userId", currency, balance::text, version FROM wallets WHERE user_id = $1 ORDER BY currency FOR UPDATE',
        [userId],
      )
    ).rows;
  }
  async lockCard(userId: string, id: string): Promise<OwnedCard | null> {
    return (
      (
        await this.sql.query<OwnedCard>(
          'SELECT id, user_id AS "userId", player_def_id AS "playerDefId", level, exp::text, version, status FROM owned_cards WHERE user_id = $1 AND id = $2 FOR UPDATE',
          [userId, id],
        )
      ).rows[0] ?? null
    );
  }
  async lockDefinitions(userId: string, ids: readonly string[]): Promise<OwnedCard[]> {
    return (
      await this.sql.query<OwnedCard>(
        'SELECT id, user_id AS "userId", player_def_id AS "playerDefId", level, exp::text, version, status FROM owned_cards WHERE user_id = $1 AND player_def_id = ANY($2::text[]) ORDER BY id FOR UPDATE',
        [userId, ids],
      )
    ).rows;
  }
  async wallet(userId: string, currency: Currency, balance: bigint): Promise<Wallet> {
    return (
      await this.sql.query<Wallet>(
        'UPDATE wallets SET balance = $3, version = version + 1 WHERE user_id = $1 AND currency = $2 RETURNING user_id AS "userId", currency, balance::text, version',
        [userId, currency, balance.toString()],
      )
    ).rows[0];
  }
  async upgrade(userId: string, id: string, revision: number): Promise<OwnedCard | null> {
    return (
      (
        await this.sql.query<OwnedCard>(
          `UPDATE owned_cards SET level = level + 1, version = version + 1 WHERE user_id = $1 AND id = $2 AND version = $3 AND status = 'active' RETURNING id, user_id AS "userId", player_def_id AS "playerDefId", level, exp::text, version, status`,
          [userId, id, revision],
        )
      ).rows[0] ?? null
    );
  }
  async ledger(userId: string, limit: number, cursor?: { createdAt: string; id: string }) {
    return (
      await this.sql.query<{
        id: string;
        currency: Currency;
        delta: string;
        balanceAfter: string;
        reason: string;
        sourceId: string;
        created_at: Date;
        cursor_time: string;
      }>(
        `SELECT id, currency, delta::text, balance_after::text AS "balanceAfter", reason, source_id AS "sourceId", created_at,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM asset_ledger WHERE user_id = $1 AND ($2::timestamptz IS NULL OR (created_at,id) < ($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4`,
        [userId, cursor?.createdAt ?? null, cursor?.id ?? null, limit],
      )
    ).rows;
  }
}
