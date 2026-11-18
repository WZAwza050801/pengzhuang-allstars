import type { SqlExecutor } from '../../packages/persistence/src/database';
import { MatchOutcomeRepository } from '../../packages/persistence/src/match-outcomes';
import { OutcomeIntentSchema } from '../../packages/contracts/src/match-results';
import { AssetOperationSchema } from '../../packages/contracts/src/economy-operations';
import { classifyModeOutcome } from '../../packages/game-core/src/modes';
import { assertSettlementConfiguration } from '../matches/outcomes';
import { outcomeHash } from '../matches/outcome-journal';
import { ApiError } from '../api/http';
import { fingerprint, type Finding } from './snapshot';

interface EventRow {
  id: string;
  payload: Record<string, unknown>;
  attempts: number;
  nextAttemptAt: string;
  processedAt: string | null;
  errorCode: string | null;
}
interface RewardRow {
  userId: string;
  eligible: boolean;
  coins: string;
  fragments: string;
  playerDefId: string | null;
  operationId: string | null;
  ledgerIds: string[];
  day: string;
}
export interface MatchAudit {
  database: string;
  matchId: string;
  mode: string;
  protocol: number;
  status: string;
  configurationHash: string | null;
  payloadHash: string | null;
  settledAt: string | null;
  rewardCount: number;
  fingerprint: string;
  findings: Finding[];
  event: {
    id: string;
    attempts: number;
    nextAttemptAt: string;
    processedAt: string | null;
    errorCode: string | null;
  } | null;
}
/** Does not expose recovery snapshots, RNG, credentials or unfiltered outbox payloads. */
export async function readMatchAudit(tx: SqlExecutor, matchId: string): Promise<MatchAudit> {
  const row = (
    await tx.query<{
      database: string;
      id: string;
      mode: string;
      protocol: number;
      status: string;
      configVersion: string;
      result: unknown;
    }>(
      'SELECT current_database() AS database,id,mode,protocol_version AS protocol,status,config_version AS "configVersion",result FROM matches WHERE id=$1',
      [matchId],
    )
  ).rows[0];
  if (!row) throw new ApiError('NOT_FOUND', 404);
  const repo = new MatchOutcomeRepository(tx),
    config = await repo.configuration(matchId),
    stored = await repo.outcome(matchId),
    participants = await repo.participants(matchId);
  const event =
    (
      await tx.query<EventRow>(
        `SELECT id,payload,attempts,
    to_char(next_attempt_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "nextAttemptAt",
    to_char(processed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "processedAt",error_code AS "errorCode"
    FROM outbox_events WHERE type='match.settle' AND aggregate_id=$1`,
        [matchId],
      )
    ).rows[0] ?? null;
  const rewards = (
    await tx.query<RewardRow>(
      'SELECT user_id AS "userId",eligible,coins::text,fragments::text,player_def_id AS "playerDefId",operation_id AS "operationId",ledger_ids AS "ledgerIds",day_key::text AS day FROM match_rewards WHERE match_id=$1 ORDER BY user_id',
      [matchId],
    )
  ).rows;
  const findings: Finding[] = [];
  const issue = (code: string, subject = matchId) => findings.push({ code, subject });
  const applicable = row.protocol === 2 && row.mode !== 'practice';
  if (applicable && row.status !== 'created' && !config) issue('settlement-configuration-missing');
  if (
    applicable &&
    row.status !== 'created' &&
    (participants.length !== 2 || participants.some((p, i) => p.side !== i))
  )
    issue('match-participants-invalid');
  if (!stored) {
    if (event || rewards.length || ['settlement-pending', 'settled', 'void'].includes(row.status))
      issue('match-outcome-missing');
  } else {
    const parsed = OutcomeIntentSchema.safeParse(stored.payload);
    if (!parsed.success || (parsed.success && outcomeHash(parsed.data) !== stored.payloadHash))
      issue('outcome-hash-mismatch');
    if (parsed.success) {
      const outcome = parsed.data;
      if (
        outcome.matchId !== matchId ||
        outcome.mode !== row.mode ||
        outcome.protocol !== row.protocol ||
        outcome.configVersion !== row.configVersion ||
        participants.length !== 2 ||
        participants.some(
          (p, i) => p.userId !== outcome.participants[i]?.userId || p.side !== outcome.participants[i]?.side,
        )
      )
        issue('outcome-binding-mismatch');
      if (fingerprint(row.result) !== fingerprint(outcome)) issue('match-result-mismatch');
      try {
        assertSettlementConfiguration(config, outcome);
        if (stored.settledAt) {
          const classification = classifyModeOutcome(config.rules, {
            authority: 'server',
            durable: true,
            accountsVerified: true,
            reason: outcome.reason,
            winner: outcome.winner,
          });
          if (row.status !== (classification.verdict === 'void' ? 'void' : 'settled')) issue('match-status-mismatch');
        }
      } catch {
        issue('settlement-configuration-invalid');
      }
    }
    if (!event) issue('settlement-event-missing');
    else {
      if (event.payload.payloadHash !== stored.payloadHash) issue('settlement-event-hash-mismatch');
      if (stored.settledAt && !event.processedAt) issue('settlement-event-unprocessed');
      if (!stored.settledAt && event.processedAt) issue('settlement-event-processed-early');
      if (!stored.settledAt && !event.processedAt && event.attempts >= 12) issue('settlement-exhausted');
      if (event.errorCode === 'outcome-conflict') issue('settlement-authority-conflict');
    }
    if (
      stored.settledAt &&
      (rewards.length !== 2 || participants.some((p) => !rewards.some((r) => r.userId === p.userId)))
    )
      issue('reward-missing');
    if (
      !stored.settledAt &&
      (rewards.length ||
        (
          await tx.query("SELECT 1 FROM asset_operations WHERE reason='match.reward' AND source_id=$1 LIMIT 1", [
            matchId,
          ])
        ).rowCount)
    )
      issue('settlement-partial-effects');
  }
  for (const reward of rewards) {
    const subject = `${matchId}:${reward.userId}`;
    if (!participants.some((p) => p.userId === reward.userId)) issue('reward-participant-invalid', subject);
    let valid = reward.ledgerIds.length <= 3 && new Set(reward.ledgerIds).size === reward.ledgerIds.length;
    const ledgers = valid
      ? (
          await tx.query<{
            id: string;
            userId: string;
            currency: string;
            delta: string;
            sourceId: string;
            operationKey: string;
            payloadHash: string;
          }>(
            'SELECT id,user_id AS "userId",currency,delta::text,source_id AS "sourceId",idempotency_key AS "operationKey",payload_hash AS "payloadHash" FROM asset_ledger WHERE id=ANY($1::uuid[])',
            [reward.ledgerIds],
          )
        ).rows
      : [];
    valid &&=
      ledgers.length === reward.ledgerIds.length &&
      ledgers.every(
        (l) => l.userId === reward.userId && l.sourceId === matchId && l.operationKey === reward.operationId,
      );
    valid &&=
      ledgers
        .filter((l) => l.currency === 'coins')
        .reduce((sum, l) => sum + BigInt(l.delta), 0n)
        .toString() === reward.coins &&
      ledgers
        .filter((l) => l.currency === 'fragments')
        .reduce((sum, l) => sum + BigInt(l.delta), 0n)
        .toString() === reward.fragments;
    if (reward.operationId) {
      const operation = (
        await tx.query<{ kind: string; reason: string; sourceId: string; payloadHash: string; result: unknown }>(
          'SELECT kind,reason,source_id AS "sourceId",payload_hash AS "payloadHash",result FROM asset_operations WHERE user_id=$1 AND operation_key=$2',
          [reward.userId, reward.operationId],
        )
      ).rows[0];
      const parsed = AssetOperationSchema.safeParse(operation?.result);
      valid &&=
        !!operation &&
        parsed.success &&
        operation.kind === 'grant' &&
        operation.reason === 'match.reward' &&
        operation.sourceId === matchId &&
        parsed.data.operationId === reward.operationId &&
        fingerprint([...parsed.data.ledgerIds].sort()) === fingerprint([...reward.ledgerIds].sort()) &&
        ledgers.every((l) => l.payloadHash === operation.payloadHash) &&
        parsed.data.economyVersion === config?.policy.version;
    } else
      valid &&=
        reward.coins === '0' &&
        reward.fragments === '0' &&
        reward.playerDefId === null &&
        reward.ledgerIds.length === 0;
    if (!valid) issue('reward-ledger-mismatch', subject);
    const day = (
      await tx.query<{
        coins: string;
        expectedCoins: string;
        qualified: string;
        expectedQualified: string;
        claimed: boolean;
        expectedClaimed: boolean;
      }>(
        `SELECT d.earned_coins::text AS coins,
      (SELECT COALESCE(sum(coins),0)::text FROM match_rewards WHERE user_id=$1 AND day_key=$2) AS "expectedCoins",d.qualified_matches::text AS qualified,
      (SELECT count(*)::text FROM match_rewards WHERE user_id=$1 AND day_key=$2 AND eligible) AS "expectedQualified",d.card_claimed AS claimed,
      EXISTS(SELECT 1 FROM match_rewards WHERE user_id=$1 AND day_key=$2 AND player_def_id IS NOT NULL) AS "expectedClaimed"
      FROM match_reward_days d WHERE user_id=$1 AND day_key=$2`,
        [reward.userId, reward.day],
      )
    ).rows[0];
    if (
      !day ||
      day.coins !== day.expectedCoins ||
      day.qualified !== day.expectedQualified ||
      day.claimed !== day.expectedClaimed
    )
      issue('reward-day-mismatch', subject);
  }
  const acceptedErrors = new Set(['rating-unavailable', 'account-restricted', 'processing-failed', 'outcome-conflict']);
  return {
    database: row.database,
    matchId,
    mode: row.mode,
    protocol: row.protocol,
    status: row.status,
    configurationHash: config?.hash ?? null,
    payloadHash: stored?.payloadHash ?? null,
    settledAt: stored?.settledAt?.toISOString() ?? null,
    event: event
      ? {
          id: event.id,
          attempts: event.attempts,
          nextAttemptAt: event.nextAttemptAt,
          processedAt: event.processedAt,
          errorCode:
            event.errorCode && acceptedErrors.has(event.errorCode)
              ? event.errorCode
              : event.errorCode
                ? 'unknown-error'
                : null,
        }
      : null,
    rewardCount: rewards.length,
    fingerprint: fingerprint({
      row,
      config,
      stored: stored
        ? { ...stored, createdAt: stored.createdAt.toISOString(), settledAt: stored.settledAt?.toISOString() ?? null }
        : null,
      participants,
      event,
      rewards,
    }),
    findings,
  };
}
