import type { SqlExecutor } from './database';

export interface SeasonRow {
  id: string;
  startsAt: string;
  endsAt: string;
  status: 'scheduled' | 'active' | 'closed';
  closedAt: string | null;
}
export interface SeasonStanding {
  userId: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
}
export interface HistoryEntry extends SeasonStanding {
  tierId: string;
  tierLabel: string;
  rewardCoins: string;
}
const seasonRow = (r: Record<string, unknown>): SeasonRow => ({
  id: String(r.id),
  startsAt: new Date(r.starts_at as string).toISOString(),
  endsAt: new Date(r.ends_at as string).toISOString(),
  status: r.status as SeasonRow['status'],
  closedAt: r.closed_at ? new Date(r.closed_at as string).toISOString() : null,
});

/** Season persistence only; clock/reset/reward logic lives in the SeasonService. */
export class SeasonRepository {
  constructor(private readonly tx: SqlExecutor) {}
  async upsertSeasons(windows: readonly { id: string; startsAt: string; endsAt: string }[]): Promise<void> {
    for (const w of windows)
      await this.tx.query('INSERT INTO seasons(id,starts_at,ends_at) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING', [
        w.id,
        w.startsAt,
        w.endsAt,
      ]);
  }
  async list(): Promise<SeasonRow[]> {
    const found = await this.tx.query(
      'SELECT id,starts_at,ends_at,status,closed_at FROM seasons ORDER BY starts_at,id',
    );
    return found.rows.map(seasonRow);
  }
  async get(id: string): Promise<SeasonRow | null> {
    const found = await this.tx.query('SELECT id,starts_at,ends_at,status,closed_at FROM seasons WHERE id=$1', [id]);
    return found.rows[0] ? seasonRow(found.rows[0]) : null;
  }
  async markActive(id: string): Promise<void> {
    await this.tx.query("UPDATE seasons SET status='active' WHERE id=$1 AND status='scheduled'", [id]);
  }
  async close(id: string, closedAt: string): Promise<boolean> {
    const found = await this.tx.query(
      "UPDATE seasons SET status='closed', closed_at=$2 WHERE id=$1 AND status<>'closed' RETURNING id",
      [id, closedAt],
    );
    return (found.rowCount ?? 0) > 0;
  }
  async standings(seasonId: string, scope: 'ranked' | 'growth'): Promise<SeasonStanding[]> {
    const found = await this.tx.query(
      'SELECT user_id,points,wins,draws,losses FROM ratings WHERE season=$1 AND scope=$2 ORDER BY user_id',
      [seasonId, scope],
    );
    return found.rows.map((r) => ({
      userId: String(r.user_id),
      points: Number(r.points),
      wins: Number(r.wins),
      draws: Number(r.draws),
      losses: Number(r.losses),
    }));
  }
  async freeze(entries: readonly (HistoryEntry & { seasonId: string; scope: 'ranked' | 'growth' })[]): Promise<void> {
    for (const e of entries)
      await this.tx.query(
        'INSERT INTO season_history(season_id,user_id,scope,points,wins,draws,losses,tier_id,tier_label,reward_coins) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (season_id,user_id,scope) DO NOTHING',
        [e.seasonId, e.userId, e.scope, e.points, e.wins, e.draws, e.losses, e.tierId, e.tierLabel, e.rewardCoins],
      );
  }
  async historyBoard(
    seasonId: string,
    scope: 'ranked' | 'growth',
    limit: number,
    after?: { points: number; userId: string },
  ): Promise<{
    entries: (SeasonStanding & { nickname: string; tierId: string; tierLabel: string })[];
    hasMore: boolean;
  }> {
    const found = after
      ? await this.tx.query(
          `SELECT h.user_id,h.points,h.wins,h.draws,h.losses,h.tier_id,h.tier_label,p.nickname
          FROM season_history h JOIN profiles p ON p.user_id=h.user_id
          WHERE h.season_id=$1 AND h.scope=$2 AND (h.points,h.user_id) < ($3,$4)
          ORDER BY h.points DESC,h.user_id LIMIT $5`,
          [seasonId, scope, after.points, after.userId, limit + 1],
        )
      : await this.tx.query(
          `SELECT h.user_id,h.points,h.wins,h.draws,h.losses,h.tier_id,h.tier_label,p.nickname
          FROM season_history h JOIN profiles p ON p.user_id=h.user_id
          WHERE h.season_id=$1 AND h.scope=$2
          ORDER BY h.points DESC,h.user_id LIMIT $3`,
          [seasonId, scope, limit + 1],
        );
    const rows = found.rows.map((r) => ({
      userId: String(r.user_id),
      points: Number(r.points),
      wins: Number(r.wins),
      draws: Number(r.draws),
      losses: Number(r.losses),
      tierId: String(r.tier_id),
      tierLabel: String(r.tier_label),
      nickname: String(r.nickname),
    }));
    return { entries: rows.slice(0, limit), hasMore: rows.length > limit };
  }
  async rewardApplied(seasonId: string, userId: string, scope: 'ranked' | 'growth'): Promise<boolean> {
    const found = await this.tx.query('SELECT 1 FROM season_rewards WHERE season_id=$1 AND user_id=$2 AND scope=$3', [
      seasonId,
      userId,
      scope,
    ]);
    return (found.rowCount ?? 0) > 0;
  }
  async recordReward(value: {
    seasonId: string;
    userId: string;
    scope: 'ranked' | 'growth';
    operationId: string;
    coins: string;
  }): Promise<void> {
    await this.tx.query(
      'INSERT INTO season_rewards(season_id,user_id,scope,operation_id,coins) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (season_id,user_id,scope) DO NOTHING',
      [value.seasonId, value.userId, value.scope, value.operationId, value.coins],
    );
  }
  /** Soft-reset provisioning: never overwrite a row the new season already created. */
  async seedRating(userId: string, scope: 'ranked' | 'growth', seasonId: string, points: number): Promise<void> {
    await this.tx.query(
      'INSERT INTO ratings(user_id,scope,season,points) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,scope,season) DO NOTHING',
      [userId, scope, seasonId, points],
    );
  }
}
