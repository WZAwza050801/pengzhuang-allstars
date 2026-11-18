import { z } from 'zod';
import type { Database } from '../../packages/persistence/src/database';
import {
  MatchHistoryQuerySchema,
  MatchResultSchema,
  OutcomeIntentSchema,
  type MatchResult,
} from '../../packages/contracts/src/match-results';
import { ChronologicalCursorSchema } from '../../packages/contracts/src/pagination';
import { requireActivePrincipal } from '../accounts/authorization';
import type { Principal } from '../accounts/access-tokens';
import { ApiError } from '../api/http';
import { OutcomeJournal, outcomeHash } from './outcome-journal';

interface ResultRow {
  id: string;
  mode: string;
  config_version: string;
  configuration_hash: string;
  side: 0 | 1;
  economy_version: string;
  modes_version: string;
  payload: unknown;
  payload_hash: string | null;
  settled_at: Date | null;
  attempts: number | null;
  error_code: string | null;
  reward_match_id: string | null;
  eligible: boolean;
  coins: string;
  fragments: string;
  player_def_id: string | null;
  operation_id: string | null;
  ledger_ids: string[];
  day_key: string;
  cursor_time: string;
}
const projection = `SELECT m.id,m.mode,m.config_version,c.configuration_hash,p.side,g.economy_version,g.modes_version,
  o.payload,o.payload_hash,o.settled_at,e.attempts,e.error_code,r.match_id AS reward_match_id,
  r.eligible,r.coins::text,r.fragments::text,r.player_def_id,r.operation_id,r.ledger_ids,r.day_key::text,
  to_char(m.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS cursor_time
  FROM matches m JOIN match_participants p ON p.match_id=m.id
  JOIN match_settlement_contexts c ON c.match_id=m.id JOIN match_settlement_configurations g ON g.hash=c.configuration_hash
  LEFT JOIN match_outcomes o ON o.match_id=m.id
  LEFT JOIN outbox_events e ON e.type='match.settle' AND e.aggregate_id=m.id::text
  LEFT JOIN match_rewards r ON r.match_id=m.id AND r.user_id=p.user_id AND r.reward_type='completion'`;

/** Read-only owner views. Ledger creation and retries have no player HTTP endpoint. */
export class MatchResults {
  constructor(
    private readonly db: Database,
    private readonly journal: OutcomeJournal,
    private readonly pending?: (id: string) => { outcome: unknown; attempts: number; error: string } | undefined,
  ) {}
  private view(principal: Principal, row: ResultRow): MatchResult {
    const recorded = row.payload !== null;
    let input = row.payload;
    let memory: { outcome: unknown; attempts: number; error: string } | undefined;
    if (!recorded) {
      try {
        input = this.journal.read(row.id);
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
          memory = this.pending?.(row.id);
          input = memory?.outcome;
          if (!input) throw new ApiError('NOT_FOUND', 404);
        } else {
          throw new ApiError('UNAVAILABLE', 503, true);
        }
      }
    }
    const parsed = OutcomeIntentSchema.safeParse(input);
    if (!parsed.success) throw new ApiError('UNAVAILABLE', 503, true);
    const outcome = parsed.data;
    if (
      outcome.matchId !== row.id ||
      outcome.configurationHash !== row.configuration_hash ||
      outcome.configVersion !== row.config_version ||
      outcome.mode !== row.mode ||
      outcome.participants[row.side]?.userId !== principal.userId ||
      (recorded && outcomeHash(outcome) !== row.payload_hash)
    )
      throw new ApiError('UNAVAILABLE', 503, true);
    const retry = recorded
      ? { attempts: row.attempts ?? 0, error: row.error_code }
      : (memory ?? this.journal.retry(row.id));
    const status = row.settled_at ? 'settled' : retry.attempts >= 12 ? 'failed' : recorded ? 'recorded' : 'pending';
    const acceptedErrors = new Set([
      'rating-unavailable',
      'account-restricted',
      'processing-failed',
      'outcome-conflict',
      'storage-unavailable',
    ]);
    const pendingReason =
      status === 'settled'
        ? null
        : retry.attempts >= 12
          ? 'retry-exhausted'
          : retry.error && retry.error !== 'none'
            ? acceptedErrors.has(retry.error)
              ? retry.error
              : 'processing-failed'
            : recorded
              ? null
              : 'storage-unavailable';
    const result = MatchResultSchema.safeParse({
      userId: principal.userId,
      matchId: outcome.matchId,
      mode: outcome.mode,
      side: row.side,
      configVersion: outcome.configVersion,
      economyVersion: row.economy_version,
      modesVersion: row.modes_version,
      finalSeq: outcome.finalSeq,
      score: outcome.score,
      winner: outcome.winner,
      reason: outcome.reason,
      endedAt: outcome.endedAt,
      status,
      recorded,
      pendingReason,
      reward:
        status === 'settled' && row.reward_match_id === outcome.matchId
          ? {
              eligible: row.eligible,
              coins: row.coins,
              fragments: row.fragments,
              playerDefId: row.player_def_id,
              operationId: row.operation_id,
              ledgerIds: row.ledger_ids,
              dayKey: row.day_key,
            }
          : null,
    });
    if (!result.success) throw new ApiError('UNAVAILABLE', 503, true);
    return result.data;
  }
  async detail(principal: Principal, id: string): Promise<MatchResult> {
    if (!z.uuid().safeParse(id).success) throw new ApiError('INVALID_REQUEST', 400);
    try {
      const row = await this.db.transaction(async (tx) => {
        await requireActivePrincipal(tx, principal);
        return (await tx.query<ResultRow>(`${projection} WHERE p.user_id=$1 AND m.id=$2`, [principal.userId, id]))
          .rows[0];
      });
      if (!row) throw new ApiError('NOT_FOUND', 404);
      return this.view(principal, row);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('UNAVAILABLE', 503, true);
    }
  }
  async history(principal: Principal, raw: unknown) {
    const query = MatchHistoryQuerySchema.safeParse(raw);
    if (!query.success) throw new ApiError('INVALID_REQUEST', 400);
    let cursor: z.infer<typeof ChronologicalCursorSchema> | null = null;
    if (query.data.cursor)
      try {
        cursor = ChronologicalCursorSchema.parse(
          JSON.parse(Buffer.from(query.data.cursor, 'base64url').toString('utf8')),
        );
      } catch {
        throw new ApiError('INVALID_REQUEST', 400);
      }
    const limit = Number(query.data.limit ?? 20);
    try {
      const rows = await this.db.transaction(async (tx) => {
        await requireActivePrincipal(tx, principal);
        return (
          await tx.query<ResultRow>(
            `${projection} WHERE p.user_id=$1 AND o.match_id IS NOT NULL
          AND ($2::timestamptz IS NULL OR (m.completed_at,m.id)<($2,$3::uuid))
          ORDER BY m.completed_at DESC,m.id DESC LIMIT $4`,
            [principal.userId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
          )
        ).rows;
      });
      const page = rows.slice(0, limit),
        last = page.at(-1);
      return {
        userId: principal.userId,
        matches: page.map((row) => this.view(principal, row)),
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(JSON.stringify({ createdAt: last.cursor_time, id: last.id })).toString('base64url')
            : null,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('UNAVAILABLE', 503, true);
    }
  }
}
