import { createHash, randomUUID } from 'node:crypto';
import type { Database, SqlExecutor } from '../../packages/persistence/src/database';
import {
  MatchOutcomeRepository,
  type SettlementConfiguration,
  type SettlementEvent,
} from '../../packages/persistence/src/match-outcomes';
import { AssetRepository } from '../../packages/persistence/src/assets';
import { retryTransaction } from '../../packages/persistence/src/transactions';
import {
  OutcomeIntentSchema,
  type OutcomeIntent,
  type SettlementStatus,
} from '../../packages/contracts/src/match-results';
import { EconomyPolicySchema, type EconomyPolicy } from '../../packages/contracts/src/economy';
import type { ModeRules } from '../../packages/contracts/src/modes';
import { freezeSnapshot, canonicalJson } from '../../packages/game-core/src/snapshot';
import {
  validateEconomyReferences,
  quoteMatchReward,
  quoteParticipationCard,
  economyDayKey,
} from '../../packages/game-core/src/economy';
import { verifyModeRules } from '../../config/modes';
import { classifyModeOutcome } from '../../packages/game-core/src/modes';
import type { GameData } from '../../shared/data';
import type { Assets } from '../accounts/assets';
import { OutcomeConflict, JournalIntegrityError, OutcomeJournal, outcomeHash } from './outcome-journal';
import { MatchResults } from './results';

export interface SettlementReceipt {
  status: SettlementStatus;
  recorded: boolean;
  recoverable: boolean;
}
export interface MatchRatings {
  applyInTransaction(tx: SqlExecutor, outcome: OutcomeIntent, rules: ModeRules): Promise<void>;
}
class RatingUnavailable extends Error {}
class AccountRestricted extends Error {}
export interface OutcomeOptions {
  db: Database;
  assets: Assets;
  policy(): EconomyPolicy;
  journal: OutcomeJournal;
  ratings?: MatchRatings;
  onEvent?(event: { code: string; matchId?: string }): void;
}
const configurationHash = (data: GameData, policy: EconomyPolicy, rules: ModeRules) =>
  createHash('sha256').update(canonicalJson({ data, policy, rules })).digest('hex');
/** The consumer and maintenance checks must validate the same immutable configuration binding. */
export function assertSettlementConfiguration(config: SettlementConfiguration | null, outcome: OutcomeIntent): asserts config is SettlementConfiguration {
  if (!config || config.hash !== outcome.configurationHash || config.data.version !== outcome.configVersion ||
      config.rules.mode !== outcome.mode || config.hash !== configurationHash(config.data, config.policy, config.rules)) throw new OutcomeConflict();
  verifyModeRules(config.data, config.rules);
  EconomyPolicySchema.parse(config.policy);
}
/** Persistent result delivery and SQL-only award transactions. This port is never bound to player request JSON. */
export class MatchOutcomes {
  get journalDirectory() { return this.options.journal.root; }
  readonly results: MatchResults;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private closing = false;
  private listeners = new Map<string, Set<(receipt: SettlementReceipt) => void>>();
  private known = new Map<string, SettlementReceipt>();
  private pendingMemory = new Map<
    string,
    { outcome: OutcomeIntent; attempts: number; nextAttemptAt: number; error: string }
  >();
  private dbReachable: boolean | undefined;
  constructor(private readonly options: OutcomeOptions) {
    this.results = new MatchResults(options.db, options.journal, (id) => this.pendingMemory.get(id));
  }
  private event(code: string, matchId?: string) {
    try {
      (this.options.onEvent ?? ((event) => console.error(JSON.stringify({ event: 'match_settlement', ...event }))))({
        code,
        ...(matchId ? { matchId } : {}),
      });
    } catch {
      /* Logging cannot change an accepted result. */
    }
  }
  subscribe(id: string, listener: (receipt: SettlementReceipt) => void) {
    const entries = this.listeners.get(id) ?? new Set();
    entries.add(listener);
    this.listeners.set(id, entries);
    return () => {
      entries.delete(listener);
      if (!entries.size) {
        this.listeners.delete(id);
        this.known.delete(id);
      }
    };
  }
  private publish(id: string, receipt: SettlementReceipt): SettlementReceipt {
    const prior = this.known.get(id);
    const accepted =
      prior?.status === 'settled' ||
      (prior?.recorded && !receipt.recorded) ||
      (prior?.recoverable && !receipt.recoverable)
        ? prior
        : receipt;
    if (this.listeners.has(id)) this.known.set(id, accepted);
    for (const listener of this.listeners.get(id) ?? [])
      try {
        listener(accepted);
      } catch {
        this.event('listener-failed', id);
      }
    return accepted;
  }
  async openInTransaction(tx: SqlExecutor, matchId: string, data: GameData, rules: ModeRules): Promise<string> {
    const policy = freezeSnapshot(EconomyPolicySchema.parse(this.options.policy())),
      frozenData = freezeSnapshot(data);
    const verified = verifyModeRules(frozenData, rules);
    validateEconomyReferences(policy, frozenData);
    const hash = configurationHash(frozenData, policy, verified);
    if (!(await new MatchOutcomeRepository(tx).pin(matchId, { hash, data: frozenData, policy, rules: verified })))
      throw new OutcomeConflict();
    return hash;
  }
  private async persist(outcome: OutcomeIntent): Promise<SettlementReceipt> {
    return retryTransaction(this.options.db, async (tx) => {
      const repo = new MatchOutcomeRepository(tx),
        match = await repo.lockMatch(outcome.matchId);
      if (
        !match ||
        match.mode !== outcome.mode ||
        match.config_version !== outcome.configVersion ||
        match.protocol_version !== outcome.protocol
      )
        throw new OutcomeConflict();
      const config = await repo.configuration(outcome.matchId);
      assertSettlementConfiguration(config, outcome);
      const participants = await repo.participants(outcome.matchId);
      if (
        participants.length !== 2 ||
        participants.some(
          (participant, i) =>
            participant.userId !== outcome.participants[i].userId || participant.side !== outcome.participants[i].side,
        )
      )
        throw new OutcomeConflict();
      const previous = await repo.outcome(outcome.matchId, true),
        digest = outcomeHash(outcome);
      if (previous) {
        if (
          previous.payloadHash !== digest ||
          outcomeHash(OutcomeIntentSchema.parse(previous.payload)) !== previous.payloadHash
        )
          throw new OutcomeConflict();
        if (previous.settledAt) return { status: 'settled', recorded: true, recoverable: true };
        const event = (
          await tx.query<{ attempts: number }>(
            "SELECT attempts FROM outbox_events WHERE type='match.settle' AND aggregate_id=$1",
            [outcome.matchId],
          )
        ).rows[0];
        return { status: event?.attempts >= 12 ? 'failed' : 'recorded', recorded: true, recoverable: true };
      }
      await repo.record(outcome, digest);
      return { status: 'recorded', recorded: true, recoverable: true };
    });
  }
  async record(value: unknown): Promise<SettlementReceipt> {
    const outcome = OutcomeIntentSchema.parse(value);
    const pending = this.pendingMemory.get(outcome.matchId);
    if (pending && outcomeHash(pending.outcome) !== outcomeHash(outcome)) throw new OutcomeConflict();
    let journaled = false;
    try {
      await this.options.journal.putAsync(outcome);
      journaled = true;
    } catch (error) {
      if (error instanceof OutcomeConflict || error instanceof JournalIntegrityError) {
        this.event('journal-conflict', outcome.matchId);
        throw error;
      }
      this.event('journal-unavailable', outcome.matchId);
    }
    try {
      const receipt = await this.persist(outcome);
      this.pendingMemory.delete(outcome.matchId);
      if (receipt.status === 'settled') this.removeJournal(outcome.matchId);
      return this.publish(outcome.matchId, receipt);
    } catch (error) {
      if (error instanceof OutcomeConflict) {
        if (journaled)
          try {
            this.options.journal.quarantine(outcome.matchId);
          } catch {
            this.event('journal-quarantine-failed', outcome.matchId);
          }
        this.event('outcome-conflict', outcome.matchId);
        throw error;
      }
      this.event('outcome-storage-unavailable', outcome.matchId);
      if (!journaled) {
        if (!pending && this.pendingMemory.size >= 1024)
          throw new Error('Outcome recovery capacity exhausted', { cause: error });
        if (!pending)
          this.pendingMemory.set(outcome.matchId, {
            outcome,
            attempts: 0,
            nextAttemptAt: Date.now() + 1000,
            error: 'storage-unavailable',
          });
      } else this.pendingMemory.delete(outcome.matchId);
      return this.publish(outcome.matchId, { status: 'pending', recorded: false, recoverable: journaled });
    }
  }
  private removeJournal(id: string) {
    try {
      this.options.journal.remove(id);
    } catch {
      this.event('journal-cleanup-failed', id);
    }
  }
  private async replayJournal(limit: number) {
    let ids: string[];
    try {
      ids = this.options.journal.ids();
    } catch {
      this.event('journal-scan-failed');
      return;
    }
    let attempted = 0;
    for (const id of ids) {
      if (this.closing || attempted >= limit) break;
      try {
        const retry = this.options.journal.retry(id);
        if (retry.attempts >= 12 || retry.nextAttemptAt > Date.now()) continue;
        attempted++;
        const outcome = this.options.journal.read(id),
          receipt = await this.persist(outcome);
        this.publish(id, receipt);
        if (receipt.status === 'settled') this.removeJournal(id);
      } catch (error) {
        if (error instanceof OutcomeConflict || error instanceof JournalIntegrityError) {
          this.event('journal-replay-conflict', id);
          try {
            this.options.journal.quarantine(id);
          } catch {
            this.event('journal-quarantine-failed', id);
          }
          this.publish(id, { status: 'failed', recorded: false, recoverable: false });
        } else {
          try {
            const retry = this.options.journal.defer(id, 'storage-unavailable');
            if (retry.attempts >= 12) this.publish(id, { status: 'failed', recorded: false, recoverable: true });
          } catch {
            this.event('journal-retry-state-failed', id);
          }
        }
      }
    }
  }
  private async replayMemory(limit: number) {
    if (!this.pendingMemory.size) return;
    let reachable = true;
    try {
      await this.options.db.query('SELECT 1');
    } catch {
      reachable = false;
    }
    if (reachable && this.dbReachable === false)
      for (const pending of this.pendingMemory.values())
        if (pending.error !== 'outcome-conflict') {
          pending.attempts = 0;
          pending.nextAttemptAt = 0;
        }
    this.dbReachable = reachable;
    let attempted = 0;
    for (const [id, pending] of this.pendingMemory) {
      if (this.closing || attempted >= limit) break;
      if (pending.attempts >= 12 || pending.nextAttemptAt > Date.now()) continue;
      attempted++;
      try {
        const receipt = await this.record(pending.outcome);
        if (receipt.recoverable) continue;
      } catch (error) {
        if (error instanceof OutcomeConflict || error instanceof JournalIntegrityError) {
          pending.error = 'outcome-conflict';
          pending.attempts = 11;
        }
      }
      pending.attempts = Math.min(12, pending.attempts + 1);
      pending.nextAttemptAt = Date.now() + Math.min(300000, 1000 * 2 ** pending.attempts);
      if (pending.attempts >= 12) this.publish(id, { status: 'failed', recorded: false, recoverable: false });
    }
  }
  private async consumeOne(): Promise<boolean> {
    let selected: SettlementEvent | null = null,
      finished: OutcomeIntent | null = null;
    try {
      const consumed = await retryTransaction(this.options.db, async (tx) => {
        const repo = new MatchOutcomeRepository(tx),
          event = await repo.nextEvent();
        if (!event) return false;
        selected = event;
        await repo.lockMatch(event.matchId);
        const stored = await repo.outcome(event.matchId, true);
        if (!stored || stored.payloadHash !== event.payload.payloadHash) throw new OutcomeConflict();
        const outcome = OutcomeIntentSchema.parse(stored.payload),
          config = await repo.configuration(event.matchId);
        if (outcomeHash(outcome) !== stored.payloadHash) throw new OutcomeConflict();
        assertSettlementConfiguration(config, outcome);
        const classification = classifyModeOutcome(config.rules, {
          authority: 'server',
          durable: true,
          accountsVerified: true,
          reason: outcome.reason,
          winner: outcome.winner,
        });
        if (!stored.settledAt) {
          if (classification.ratingScope && !this.options.ratings) throw new RatingUnavailable();
          const accounts = new AssetRepository(tx);
          const statuses = new Map<string, string>();
          for (const participant of [...outcome.participants].sort((a, b) => a.userId.localeCompare(b.userId))) {
            const user = await accounts.lockUser(participant.userId);
            if (!user) throw new AccountRestricted();
            statuses.set(participant.userId, user.status);
          }
          for (const participant of outcome.participants) {
            const day = economyDayKey(config.policy, Date.parse(outcome.endedAt)),
              budget = await repo.rewardDay(participant.userId, day);
            const termination =
              outcome.reason === 'goals' || outcome.reason === 'time'
                ? 'completed'
                : outcome.reason === 'surrender' || outcome.reason === 'disconnect'
                  ? 'forfeit'
                  : outcome.reason === 'abandoned'
                    ? 'abandoned'
                    : 'server-fault';
            const result = outcome.winner === -1 ? 'draw' : outcome.winner === participant.side ? 'win' : 'loss';
            const quote = quoteMatchReward(config.policy, result, BigInt(budget.coins), {
              trustedMatch: true,
              modeAllowsRewards: classification.rewardScope !== null,
              actionsByUser: participant.actions,
              elapsedSeconds: outcome.elapsedSeconds,
              termination,
            });
            let card: string | null = null,
              operationId: string | null = null,
              ledgerIds: string[] = [],
              fragments = '0';
            if (quote.eligible) {
              if (statuses.get(participant.userId) !== 'active') throw new AccountRestricted();
              const progress = await repo.progress(participant.userId, config.policy.version);
              const reward = quoteParticipationCard(config.policy, config.data, {
                progressBefore:
                  config.policy.participationCard.progressScope === 'carry-until-claim' ? progress.progress : 0,
                addedQualifiedMatches:
                  config.policy.participationCard.progressScope === 'carry-until-claim'
                    ? 1
                    : budget.qualifiedMatches + 1,
                claimedToday: budget.cardClaimed,
                claimIndex: Number(progress.claimIndex),
              });
              card = reward.cardId;
              await repo.advanceProgress(
                participant.userId,
                config.policy.version,
                reward.progressAfter,
                card !== null,
              );
            }
            if (quote.coins > 0n || card) {
              operationId = randomUUID();
              const grant = await this.options.assets.grantInTransaction(
                tx,
                {
                  userId: participant.userId,
                  operationId,
                  reason: 'match.reward',
                  sourceId: outcome.matchId,
                  coins: quote.coins.toString(),
                  fragments: '0',
                  playerDefIds: card ? [card] : [],
                },
                { data: config.data, policy: config.policy },
              );
              ledgerIds = grant.ledgerIds;
              fragments = (
                await tx.query<{ amount: string }>(
                  "SELECT COALESCE(sum(delta),0)::text AS amount FROM asset_ledger WHERE user_id=$1 AND id=ANY($2::uuid[]) AND currency='fragments'",
                  [participant.userId, ledgerIds],
                )
              ).rows[0].amount;
            }
            await repo.recordReward({
              matchId: outcome.matchId,
              userId: participant.userId,
              eligible: quote.eligible,
              coins: quote.coins.toString(),
              fragments,
              playerDefId: card,
              operationId,
              ledgerIds,
              day,
            });
          }
          if (classification.ratingScope) await this.options.ratings!.applyInTransaction(tx, outcome, config.rules);
        }
        await repo.settled(outcome, event.id, classification.verdict === 'void');
        finished = outcome;
        return true;
      });
      if (consumed && finished) {
        const outcome = finished as OutcomeIntent;
        this.publish(outcome.matchId, { status: 'settled', recorded: true, recoverable: true });
        this.removeJournal(outcome.matchId);
      }
      return consumed;
    } catch (error) {
      const event = selected as SettlementEvent | null;
      const code =
        error instanceof OutcomeConflict
          ? 'outcome-conflict'
          : error instanceof RatingUnavailable
            ? 'rating-unavailable'
            : error instanceof AccountRestricted
              ? 'account-restricted'
              : 'processing-failed';
      this.event(code, event?.matchId);
      if (event)
        try {
          const attempts = await new MatchOutcomeRepository(this.options.db).failEvent(event.id, code);
          if (attempts !== undefined)
            this.publish(event.matchId, {
              status: attempts >= 12 ? 'failed' : 'recorded',
              recorded: true,
              recoverable: true,
            });
        } catch {
          this.event('retry-state-unavailable', event.matchId);
        }
      return event !== null;
    }
  }
  drain(limit = 16): Promise<void> {
    if (this.running) return this.running;
    return (this.running = (async () => {
      await this.replayMemory(limit);
      await this.replayJournal(limit);
      for (let i = 0; i < limit && !this.closing; i++) if (!(await this.consumeOne())) break;
    })().finally(() => {
      this.running = null;
    }));
  }
  async start() {
    this.closing = false;
    await this.drain();
    if (!this.timer && !this.closing) {
      this.timer = setInterval(() => void this.drain().catch(() => this.event('worker-failed')), 1000);
      this.timer.unref();
    }
  }
  async close() {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }
}
