import type { SqlExecutor } from './database';
import type { OwnedCard } from './user-data';
type StoredLineupCard = Pick<OwnedCard, 'id' | 'playerDefId' | 'level' | 'version' | 'status'>;

export interface StoredLineup {
  id: string;
  name: string;
  revision: number;
}
export class LineupRepository {
  constructor(private readonly sql: SqlExecutor) {}
  async list(userId: string, afterId: string | undefined, limit: number) {
    return (
      await this.sql.query<StoredLineup>(
        'SELECT id, name, revision FROM lineups WHERE user_id = $1 AND ($2::uuid IS NULL OR id > $2::uuid) ORDER BY id LIMIT $3',
        [userId, afterId ?? null, limit],
      )
    ).rows;
  }
  async lock(userId: string, lineupId: string): Promise<StoredLineup | null> {
    return (
      (
        await this.sql.query<StoredLineup>(
          'SELECT id, name, revision FROM lineups WHERE user_id = $1 AND id = $2 FOR UPDATE',
          [userId, lineupId],
        )
      ).rows[0] ?? null
    );
  }
  async slots(userId: string, ids: readonly string[]) {
    return (
      await this.sql.query<{ lineup_id: string; owned_card_id: string; slot: number }>(
        'SELECT lineup_id, owned_card_id, slot FROM lineup_slots WHERE user_id = $1 AND lineup_id = ANY($2::uuid[]) ORDER BY lineup_id, slot',
        [userId, ids],
      )
    ).rows;
  }
  async lockCards(userId: string, ids: readonly string[]): Promise<StoredLineupCard[]> {
    return (
      await this.sql.query<StoredLineupCard>(
        'SELECT id, player_def_id AS "playerDefId", level, version, status FROM owned_cards WHERE user_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE',
        [userId, ids],
      )
    ).rows;
  }
  async replace(
    userId: string,
    lineupId: string,
    expectedRevision: number,
    ids: readonly string[],
  ): Promise<StoredLineup | null> {
    const row = (
      await this.sql.query<StoredLineup>(
        'UPDATE lineups SET revision = revision + 1 WHERE user_id = $1 AND id = $2 AND revision = $3 RETURNING id, name, revision',
        [userId, lineupId, expectedRevision],
      )
    ).rows[0];
    if (!row) return null;
    await this.sql.query('DELETE FROM lineup_slots WHERE user_id = $1 AND lineup_id = $2', [userId, lineupId]);
    await this.sql.query(
      'INSERT INTO lineup_slots(user_id, lineup_id, slot, owned_card_id) SELECT $1, $2, (n - 1)::smallint, id FROM unnest($3::uuid[]) WITH ORDINALITY AS cards(id, n)',
      [userId, lineupId, ids],
    );
    return row;
  }
}
