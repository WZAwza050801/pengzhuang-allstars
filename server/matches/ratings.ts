import type { Database, SqlExecutor } from '../../packages/persistence/src/database';
import { RatingRepository } from '../../packages/persistence/src/ratings';
import type { RatingsConfig, LeaderboardQuery, OwnRatings, Leaderboard } from '../../packages/contracts/src/ratings';
import { OwnRatingsSchema, LeaderboardSchema } from '../../packages/contracts/src/ratings';
import type { QueueRating } from '../../packages/contracts/src/matchmaking';
import type { OutcomeIntent } from '../../packages/contracts/src/match-results';
import type { ModeRules } from '../../packages/contracts/src/modes';
import type { AccountMode } from './tickets';
import { eloDelta, resultFor, tierFor } from '../../packages/game-core/src/ratings';
import { classifyModeOutcome } from '../../packages/game-core/src/modes';
import { ApiError } from '../api/http';
import type { MatchRatings } from './outcomes';

const encodeCursor = (points: number, userId: string) => Buffer.from(JSON.stringify({ p: points, u: userId }), 'utf8').toString('base64url');
function decodeCursor(cursor: string): { points: number; userId: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Number.isInteger(value.p) && value.p >= 0 && typeof value.u === 'string' && /^[0-9a-f-]{36}$/.test(value.u))
      return { points: value.p, userId: value.u };
  } catch {
    /* fall through */
  }
  throw new ApiError('INVALID_REQUEST', 400);
}

/**
 * Versioned simple Elo bound to the settlement transaction. Applications are
 * append-only and keyed by match, so replays and out-of-order consumption can
 * never double-apply; rating rows are locked in stable user order.
 */
export class Ratings implements MatchRatings {
  constructor(private readonly db: Database, readonly config: Readonly<RatingsConfig>) {}
  /** Queue port: friend has no rating pool; other modes read (and provision) the real server rating. */
  async readForQueue(tx: SqlExecutor, userId: string, mode: AccountMode): Promise<QueueRating | null> {
    if (mode === 'friend') return null;
    const row = await new RatingRepository(tx).ensure(userId, mode, this.config.season, this.config.initialPoints);
    return { scope: mode, season: this.config.season, points: row.points };
  }
  async applyInTransaction(tx: SqlExecutor, outcome: OutcomeIntent, rules: ModeRules): Promise<void> {
    const scope = rules.ratingScope;
    if (!scope) return;
    const classification = classifyModeOutcome(rules, {
      authority: 'server',
      durable: true,
      accountsVerified: true,
      reason: outcome.reason,
      winner: outcome.winner,
    });
    if (!classification.ratingScope) return;
    const repo = new RatingRepository(tx);
    if (await repo.applied(outcome.matchId)) return;
    const sorted = [...outcome.participants].sort((a, b) => a.userId.localeCompare(b.userId));
    const before = new Map<string, number>();
    for (const participant of sorted)
      before.set(participant.userId, (await repo.ensure(participant.userId, scope, this.config.season, this.config.initialPoints)).points);
    const entries = sorted.map((participant) => {
      const opponent = sorted.find((other) => other.userId !== participant.userId)!;
      const result = resultFor(outcome.winner, participant.side);
      const { delta, after } = eloDelta(before.get(participant.userId)!, before.get(opponent.userId)!, result, this.config);
      return { userId: participant.userId, result, delta, pointsAfter: after };
    });
    await repo.apply(outcome.matchId, scope, this.config.season, entries);
  }
  async own(userId: string): Promise<OwnRatings> {
    return this.db.transaction(async (tx) => {
      const repo = new RatingRepository(tx);
      const ratings = [];
      for (const scope of ['ranked', 'growth'] as const) {
        const row = await repo.ensure(userId, scope, this.config.season, this.config.initialPoints);
        ratings.push({ scope, season: row.season, points: row.points, tier: tierFor(row.points, this.config), wins: row.wins, draws: row.draws, losses: row.losses, version: row.version });
      }
      return OwnRatingsSchema.parse({ userId, season: this.config.season, ratings });
    });
  }
  async leaderboard(query: LeaderboardQuery): Promise<Leaderboard> {
    const season = query.season ?? this.config.season;
    const limit = query.limit ?? 20;
    if (season !== this.config.season)
      return LeaderboardSchema.parse({ scope: query.scope, season, entries: [], nextCursor: null });
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    return this.db.transaction(async (tx) => {
      const page = await new RatingRepository(tx).leaderboard(query.scope, season, limit, after);
      const entries = page.entries.map((entry) => ({
        nickname: entry.nickname,
        points: entry.points,
        tier: tierFor(entry.points, this.config),
        wins: entry.wins,
        draws: entry.draws,
        losses: entry.losses,
      }));
      const last = page.entries[page.entries.length - 1];
      return LeaderboardSchema.parse({
        scope: query.scope,
        season,
        entries,
        nextCursor: page.hasMore && last ? encodeCursor(last.points, last.userId) : null,
      });
    });
  }
}