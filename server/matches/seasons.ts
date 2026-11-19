import type { Database, SqlExecutor } from '../../packages/persistence/src/database';
import { SeasonRepository } from '../../packages/persistence/src/seasons';
import type { SeasonsConfig, SeasonHistoryQuery, SeasonHistory } from '../../packages/contracts/src/seasons';
import { SeasonHistorySchema, SeasonListSchema } from '../../packages/contracts/src/seasons';
import type { RatingsConfig } from '../../packages/contracts/src/ratings';
import type { EconomyPolicy } from '../../packages/contracts/src/economy';
import type { GameData } from '../../shared/data';
import { tierFor, softResetPoints } from '../../packages/game-core/src/ratings';
import type { Assets } from '../accounts/assets';
import { ApiError } from '../api/http';
import { encodeCursor, decodeCursor } from './ratings';

const SCOPES = ['ranked', 'growth'] as const;

/**
 * Clock-driven seasons. Closing a season freezes its leaderboard, grants tier
 * rewards idempotently through the asset ledger, and soft-resets standings into
 * the next season. The whole switch is one transaction gated by the season row
 * lock, so a failed or repeated job never double-grants or double-resets.
 */
export class SeasonService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private closing = false;
  constructor(
    private readonly db: Database,
    readonly config: Readonly<SeasonsConfig>,
    private readonly ratingsConfig: Readonly<RatingsConfig>,
    private readonly assets: Assets,
    private readonly policy: () => EconomyPolicy,
    private readonly resolveData: () => GameData,
  ) {}
  currentSeason(nowMs: number): { id: string; startsAt: string; endsAt: string } | null {
    return this.config.seasons.find((s) => Date.parse(s.startsAt) <= nowMs && nowMs < Date.parse(s.endsAt)) ?? null;
  }
  async list() {
    return this.db.transaction(async (tx) => SeasonListSchema.parse({ seasons: await new SeasonRepository(tx).list() }));
  }
  /** Idempotent season switch; safe to call repeatedly and concurrently. */
  async runJob(nowMs = Date.now()): Promise<{ closed: string[] }> {
    return this.db.transaction(async (tx) => {
      const repo = new SeasonRepository(tx);
      await repo.upsertSeasons(this.config.seasons);
      const closed: string[] = [];
      for (const window of this.config.seasons) {
        if (Date.parse(window.endsAt) > nowMs) continue;
        if (await this.closeSeason(tx, repo, window, nowMs)) closed.push(window.id);
      }
      const current = this.currentSeason(nowMs);
      if (current) await repo.markActive(current.id);
      return { closed };
    });
  }
  private async closeSeason(tx: SqlExecutor, repo: SeasonRepository, window: { id: string }, nowMs: number): Promise<boolean> {
    // The conditional UPDATE locks the season row and serializes concurrent jobs.
    if (!(await repo.close(window.id, new Date(nowMs).toISOString()))) return false;
    const index = this.config.seasons.findIndex((s) => s.id === window.id);
    const next = this.config.seasons[index + 1];
    const floor = this.ratingsConfig.floorPoints;
    for (const scope of SCOPES) {
      const standings = await repo.standings(window.id, scope);
      const history = standings.map((s) => {
        const tier = tierFor(s.points, this.ratingsConfig);
        return { ...s, seasonId: window.id, scope, tierId: tier.id, tierLabel: tier.label, rewardCoins: this.config.tierRewards[tier.id] ?? '0' };
      });
      await repo.freeze(history);
      for (const entry of history) {
        if (BigInt(entry.rewardCoins) > 0n && !(await repo.rewardApplied(window.id, entry.userId, scope))) {
          const operationId = `season:${window.id}:${scope}:${entry.userId}`;
          await this.assets.grantInTransaction(
            tx,
            { userId: entry.userId, operationId, sourceId: `season:${window.id}:${scope}`, reason: 'season.reward', coins: entry.rewardCoins },
            { data: this.resolveData(), policy: this.policy() },
          );
          await repo.recordReward({ seasonId: window.id, userId: entry.userId, scope, operationId, coins: entry.rewardCoins });
        }
        if (next) await repo.seedRating(entry.userId, scope, next.id, softResetPoints(entry.points, floor, this.config.softResetFactor));
      }
    }
    return true;
  }
  async history(query: SeasonHistoryQuery): Promise<SeasonHistory> {
    const limit = query.limit ?? 20;
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    return this.db.transaction(async (tx) => {
      const repo = new SeasonRepository(tx);
      if (!(await repo.get(query.season))) throw new ApiError('NOT_FOUND', 404);
      const page = await repo.historyBoard(query.season, query.scope, limit, after);
      const entries = page.entries.map((e) => ({ nickname: e.nickname, points: e.points, tier: { id: e.tierId, label: e.tierLabel }, wins: e.wins, draws: e.draws, losses: e.losses }));
      const last = page.entries[page.entries.length - 1];
      return SeasonHistorySchema.parse({ season: query.season, scope: query.scope, entries, nextCursor: page.hasMore && last ? encodeCursor(last.points, last.userId) : null });
    });
  }
  async start(): Promise<void> {
    this.closing = false;
    await this.runJob();
    if (!this.timer && !this.closing) {
      this.timer = setInterval(() => void this.runJob().catch(() => undefined), 60000);
      this.timer.unref();
    }
  }
  async close(): Promise<void> {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}