import type { Database } from '../../packages/persistence/src/database';
import { MatchmakingInsightsSchema, type MatchmakingInsights as InsightsResult } from '../../packages/contracts/src/matchmaking';

export interface InsightsOptions {
  windowMs?: number;
  limit?: number;
  minSample?: number;
  surrenderThreshold?: number;
  repeatThreshold?: number;
}

/**
 * MM-04: read-only abnormal-match statistics over durable settlement data.
 * Produces advisory flags and counts only — it has no ban port and never mutates
 * account status, so a false positive cannot cause an irreversible penalty.
 * Server faults (void) are counted apart from disconnect forfeits (loss).
 */
export class MatchmakingInsights {
  constructor(private readonly db: Database, private readonly options: InsightsOptions = {}) {}
  async analyze(userId: string): Promise<InsightsResult> {
    const windowMs = this.options.windowMs ?? 30 * 24 * 3600 * 1000;
    const limit = this.options.limit ?? 100;
    const minSample = this.options.minSample ?? 5;
    const surrenderThreshold = this.options.surrenderThreshold ?? 0.5;
    const repeatThreshold = this.options.repeatThreshold ?? 5;
    return this.db.transaction(async (tx) => {
      const rows = (
        await tx.query(
          `SELECT o.payload->>'reason' AS reason, (o.payload->>'winner')::int AS winner, p.side AS side,
            opp.user_id AS opponent_id, pr.nickname AS opponent_nickname
          FROM match_participants p
          JOIN match_outcomes o ON o.match_id=p.match_id
          JOIN match_participants opp ON opp.match_id=p.match_id AND opp.user_id<>p.user_id
          JOIN profiles pr ON pr.user_id=opp.user_id
          WHERE p.user_id=$1 AND o.created_at >= clock_timestamp() - ($2::bigint*interval '1 millisecond')
          ORDER BY o.created_at DESC LIMIT $3`,
          [userId, windowMs, limit],
        )
      ).rows;
      let wins = 0, draws = 0, losses = 0, surrenderLosses = 0, disconnectLosses = 0, serverFaults = 0;
      const opponents = new Map<string, { nickname: string; count: number }>();
      for (const r of rows) {
        const winner = Number(r.winner), side = Number(r.side), reason = String(r.reason);
        if (reason === 'server-fault') serverFaults++;
        if (winner === -1) {
          if (reason === 'goals' || reason === 'time') draws++;
        } else if (winner === side) wins++;
        else {
          losses++;
          if (reason === 'surrender') surrenderLosses++;
          if (reason === 'disconnect') disconnectLosses++;
        }
        const opp = opponents.get(String(r.opponent_id)) ?? { nickname: String(r.opponent_nickname), count: 0 };
        opp.count++;
        opponents.set(String(r.opponent_id), opp);
      }
      const matches = rows.length;
      const flags: ('frequent-surrender' | 'repeat-opponent')[] = [];
      if (matches >= minSample && surrenderLosses / matches >= surrenderThreshold) flags.push('frequent-surrender');
      const repeatOpponents = [...opponents.values()].filter((o) => o.count >= repeatThreshold).sort((a, b) => b.count - a.count).slice(0, 20);
      if (repeatOpponents.length) flags.push('repeat-opponent');
      return MatchmakingInsightsSchema.parse({
        userId,
        windowMs,
        sampleSize: matches,
        totals: { matches, wins, draws, losses, surrenderLosses, disconnectLosses, serverFaults },
        flags,
        repeatOpponents,
      });
    });
  }
}