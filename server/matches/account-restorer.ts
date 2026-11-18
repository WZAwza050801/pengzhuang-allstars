import type { ServerClock } from '../clock';
import { ApiError } from '../api/http';
import type { SettlementConfiguration } from '../../packages/persistence/src/match-outcomes';
import { OutcomeIntentSchema } from '../../packages/contracts/src/match-results';
import type { AccountCheckpoint } from './checkpoint';
import { checkpointHash } from './checkpoint';
import { MatchCheckpoints, CheckpointReadFailure, type CheckpointLease } from './checkpoint-store';
import {
  RecoveryJournal,
  RecoveryJournalCorrupt,
  RecoveryJournalConflict,
  terminalEntryHash,
  type TerminalEntry,
} from './recovery-journal';
import type { MatchOutcomes } from './outcomes';
import { outcomeHash } from './outcome-journal';

export interface RestoredAccountRoom {
  lease: CheckpointLease;
  record: AccountCheckpoint;
  configuration: SettlementConfiguration;
  requestedAt: number;
}
export interface AccountRestoreReport {
  legacyUnavailable: string | null;
  scanned: number;
  restored: number;
  terminal: number;
  busy: number;
  failed: number;
  foreign: number;
  pruned: number;
  blocked: number;
  cursor: string | null;
}
/** A bounded coordinator. It resolves terminal sources before exposing any recovered playing room. */
export class AccountRestorer {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<AccountRestoreReport> | undefined;
  private cursor: string | null = null;
  private journalCursor: string | null = null;
  private lastTransientLog = 0;
  private closing = false;
  private legacyUnavailable: string | null = null;
  private readonly blocked = new Map<string, string>();
  constructor(
    private readonly getStore: () => Promise<MatchCheckpoints>,
    private readonly journal: RecoveryJournal,
    private readonly outcomes: MatchOutcomes,
    private readonly clock: ServerClock,
    private readonly rooms: { has(code: string): boolean; install(input: RestoredAccountRoom): Promise<void> },
  ) {}
  private block(matchId: string, reason: string) {
    if (!this.blocked.has(matchId)) console.error(JSON.stringify({ event: 'match_recovery', code: reason, matchId }));
    this.blocked.set(matchId, reason);
  }
  async start() {
    if (!this.timer && !this.closing) {
      this.timer = setInterval(() => {
        void this.scan().catch(() =>
          console.error(JSON.stringify({ event: 'match_recovery', code: 'scan-unavailable' })),
        );
      }, 1000);
      this.timer.unref();
    }
    return this.scan();
  }
  scan(): Promise<AccountRestoreReport> {
    return (this.running ??= this.scanPage().finally(() => {
      this.running = undefined;
    }));
  }
  private async recorded(store: MatchCheckpoints, entry: TerminalEntry) {
    const state = await store.disposition(entry.record.matchId);
    if (!state?.payloadHash) return false;
    if (state.payloadHash !== outcomeHash(entry.record.terminal!)) {
      this.block(entry.record.matchId, 'terminal-result-conflict');
      return true;
    }
    await this.journal.remove(entry.record.matchId, terminalEntryHash(entry));
    return true;
  }
  private async deliver(store: MatchCheckpoints, recovered: RestoredAccountRoom, entry: TerminalEntry | null) {
    let record = recovered.record;
    if (!record.terminal && entry) {
      if (BigInt(entry.base.checkpoint) < BigInt(recovered.lease.checkpoint)) {
        await this.journal.quarantine(record.matchId);
        entry = null;
      } else if (
        entry.base.checkpoint !== recovered.lease.checkpoint ||
        entry.base.payloadHash !== checkpointHash(record) ||
        entry.base.storageId !== recovered.lease.storageId ||
        BigInt(entry.base.epoch) > BigInt(recovered.lease.epoch)
      ) {
        this.block(record.matchId, 'terminal-source-conflict');
        return 'blocked' as const;
      } else {
        recovered.lease = await store.write(recovered.lease, entry.record, 'terminal');
        record = entry.record;
      }
    }
    if (!record.terminal) return 'running' as const;
    if (entry && checkpointHash(record) !== checkpointHash(entry.record))
      this.block(record.matchId, 'terminal-cache-conflict');
    const receipt = await this.outcomes.record(record.terminal);
    if (entry && receipt.recorded && outcomeHash(record.terminal) === outcomeHash(entry.record.terminal!))
      await this.journal.remove(record.matchId, terminalEntryHash(entry));
    return 'terminal' as const;
  }
  private async scanPage(): Promise<AccountRestoreReport> {
    const report: AccountRestoreReport = {
      legacyUnavailable: this.legacyUnavailable,
      scanned: 0,
      restored: 0,
      terminal: 0,
      busy: 0,
      failed: 0,
      foreign: 0,
      pruned: 0,
      blocked: this.blocked.size,
      cursor: this.cursor,
    };
    if (this.closing) return report;
    const store = await this.getStore();
    if (this.legacyUnavailable === null) {
      const legacy = await store.legacy();
      this.legacyUnavailable = legacy.total;
      if (legacy.total !== '0')
        console.error(
          JSON.stringify({
            event: 'match_recovery',
            code: 'legacy-checkpoint-missing',
            count: legacy.total,
            examples: legacy.examples,
          }),
        );
    }
    // Clean up already-recorded local candidates separately from the bounded active-head page.
    const ids = (await this.journal.ids()).filter((id) => this.journalCursor === null || id > this.journalCursor);
    const journalPage = ids.slice(0, 20);
    this.journalCursor = ids.length > 20 ? journalPage.at(-1)! : null;
    for (const id of journalPage) {
      if (this.closing) break;
      if (this.blocked.has(id)) continue;
      try {
        const entry = await this.journal.read(id);
        await this.recorded(store, entry);
      } catch (error) {
        if (error instanceof RecoveryJournalCorrupt || error instanceof RecoveryJournalConflict)
          this.block(id, 'terminal-journal-unavailable');
        report.failed++;
      }
    }
    const page = await store.pending(this.cursor);
    this.cursor = page.nextCursor;
    for (const candidate of page.items) {
      if (this.closing) break;
      report.scanned++;
      if (this.blocked.has(candidate.matchId) || this.rooms.has(candidate.code)) continue;
      if (candidate.storageId !== store.storageId) {
        report.foreign++;
        continue;
      }
      let lease: CheckpointLease | undefined,
        installed = false;
      try {
        const requestedAt = this.clock.nowMs(),
          recovered = await store.claim(candidate.matchId);
        if (!recovered) {
          report.busy++;
          continue;
        }
        lease = recovered.lease;
        const input: RestoredAccountRoom = { ...recovered, requestedAt },
          entry = await this.journal.peek(candidate.matchId);
        const disposition = await this.deliver(store, input, entry);
        if (disposition === 'blocked') {
          report.failed++;
          continue;
        }
        if (disposition === 'terminal') {
          report.terminal++;
          continue;
        }
        if (BigInt(candidate.ageMs) > 24n * 60n * 60n * 1000n) {
          const record = structuredClone(recovered.record);
          record.revision++;
          record.savedAt = Math.max(record.savedAt, this.clock.wallMs());
          record.match.over = true;
          record.match.winner = -1;
          record.match.endReason = 'server-fault';
          record.clocks = { ...record.clocks, matchMs: 0, turnMs: null, playbackMs: 0, reconnectMs: [null, null] };
          record.terminal = OutcomeIntentSchema.parse({
            schemaVersion: 1,
            protocol: 2,
            matchId: record.matchId,
            mode: recovered.configuration.rules.mode,
            configurationHash: record.configurationHash,
            configVersion: record.configVersion,
            finalSeq: record.seq,
            score: record.match.score,
            winner: -1,
            reason: 'server-fault',
            elapsedSeconds: Math.floor(record.clocks.elapsedMs / 1000),
            endedAt: new Date(this.clock.wallMs()).toISOString(),
            participants: record.seats.map((seat, side) => ({
              userId: seat.userId,
              side,
              actions: record.receipts.filter((receipt) => receipt.actorId === seat.userId).length,
            })),
          });
          input.lease = await store.write(input.lease, record, 'terminal');
          input.record = record;
          await this.deliver(store, input, null);
          report.terminal++;
          continue;
        }
        if (!this.closing) {
          await this.rooms.install(input);
          installed = true;
          report.restored++;
        }
      } catch (error) {
        if (error instanceof CheckpointReadFailure) this.block(candidate.matchId, error.reason);
        else if (error instanceof RecoveryJournalCorrupt || error instanceof RecoveryJournalConflict)
          this.block(candidate.matchId, 'terminal-journal-unavailable');
        else if (error instanceof ApiError && error.code === 'CONFLICT') {
          const state = await store.disposition(candidate.matchId).catch(() => null);
          if (state?.status === 'playing') this.block(candidate.matchId, 'checkpoint-conflict');
        } else if (this.clock.wallMs() - this.lastTransientLog > 10000) {
          this.lastTransientLog = this.clock.wallMs();
          console.error(JSON.stringify({ event: 'match_recovery', code: 'checkpoint-storage-unavailable' }));
        }
        report.failed++;
      } finally {
        if (lease && !installed) await store.release(lease).catch(() => undefined);
      }
    }
    if (!this.closing) report.pruned = (await store.pruneSettled()) + (await store.pruneAborted());
    return { ...report, legacyUnavailable: this.legacyUnavailable, blocked: this.blocked.size, cursor: this.cursor };
  }
  stop() {
    this.closing = true;
    clearInterval(this.timer);
  }
  async close() {
    this.stop();
    await this.running;
  }
}
