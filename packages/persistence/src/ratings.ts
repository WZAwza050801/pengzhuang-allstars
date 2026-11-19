import type { SqlExecutor } from './database';

export interface RatingRow {
  userId: string;
  scope: 'ranked' | 'growth';
  season: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  version: number;
}
export interface RatingApplication {
  userId: string;
  result: 'win' | 'draw' | 'loss';
  delta: number;
  pointsAfter: number;
}
const row = (r: Record<string, unknown>): RatingRow => ({
  userId: String(r.user_id),
  scope: r.scope as RatingRow['scope'],
  season: String(r.season),
  points: Number(r.points),
  wins: Number(r.wins),
  draws: Number(r.draws),
  losses: Number(r.losses),
  version: Number(r.version),
});

/** Rating persistence only; Elo math and tier mapping live in game-core/config. */
export class RatingRepository {
  constructor(private readonly tx: SqlExecutor) {}
  /** Provision the current-season row if absent, then lock it for the caller transaction. */
  async ensure(userId: string, scope: RatingRow['scope'], season: string, initialPoints: number): Promise<RatingRow> {
    await this.tx.query(
      'INSERT INTO ratings(user_id,scope,season,points) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,scope,season) DO NOTHING',
      [userId, scope, season, initialPoints],
    );
    const found = await this.tx.query(
      'SELECT user_id,scope,season,points,wins,draws,losses,version FROM ratings WHERE user_id=$1 AND scope=$2 AND season=$3 FOR UPDATE',
      [userId, scope, season],
    );
    return row(found.rows[0]);
  }
  async read(userId: string, scope: RatingRow['scope'], season: string): Promise<RatingRow | null> {
    const found = await this.tx.query(
      'SELECT user_id,scope,season,points,wins,draws,losses,version FROM ratings WHERE user_id=$1 AND scope=$2 AND season=$3',
      [userId, scope, season],
    );
    return found.rows[0] ? row(found.rows[0]) : null;
  }
  async applied(matchId: string): Promise<boolean> {
    const found = await this.tx.query('SELECT 1 FROM rating_applications WHERE match_id=$1 LIMIT 1', [matchId]);
    return found.rowCount !== null && found.rowCount > 0;
  }
  /** Caller must hold the rating row locks (ensure) in stable user order before applying. */
  async apply(
    matchId: string,
    scope: RatingRow['scope'],
    season: string,
    entries: readonly RatingApplication[],
  ): Promise<void> {
    for (const entry of entries) {
      await this.tx.query(
        'INSERT INTO rating_applications(match_id,user_id,scope,season,result,delta,points_after) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [matchId, entry.userId, scope, season, entry.result, entry.delta, entry.pointsAfter],
      );
      await this.tx.query(
        `UPDATE ratings SET points=$4,
          wins=wins+CASE WHEN $5='win' THEN 1 ELSE 0 END,
          draws=draws+CASE WHEN $5='draw' THEN 1 ELSE 0 END,
          losses=losses+CASE WHEN $5='loss' THEN 1 ELSE 0 END,
          version=version+1, updated_at=clock_timestamp()
        WHERE user_id=$1 AND scope=$2 AND season=$3`,
        [entry.userId, scope, season, entry.pointsAfter, entry.result],
      );
    }
  }
  async leaderboard(
    scope: RatingRow['scope'],
    season: string,
    limit: number,
    after?: { points: number; userId: string },
  ): Promise<{ entries: (RatingRow & { nickname: string })[]; hasMore: boolean }> {
    const found = after
      ? await this.tx.query(
          `SELECT r.user_id,r.scope,r.season,r.points,r.wins,r.draws,r.losses,r.version,p.nickname
          FROM ratings r JOIN profiles p ON p.user_id=r.user_id
          WHERE r.scope=$1 AND r.season=$2 AND (r.points,r.user_id) < ($3,$4)
          ORDER BY r.points DESC,r.user_id LIMIT $5`,
          [scope, season, after.points, after.userId, limit + 1],
        )
      : await this.tx.query(
          `SELECT r.user_id,r.scope,r.season,r.points,r.wins,r.draws,r.losses,r.version,p.nickname
          FROM ratings r JOIN profiles p ON p.user_id=r.user_id
          WHERE r.scope=$1 AND r.season=$2
          ORDER BY r.points DESC,r.user_id LIMIT $3`,
          [scope, season, limit + 1],
        );
    const rows = found.rows.map((r) => ({ ...row(r), nickname: String(r.nickname) }));
    return { entries: rows.slice(0, limit), hasMore: rows.length > limit };
  }
}
