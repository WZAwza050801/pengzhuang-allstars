import { ApiError } from '../api/http';
import type { ServerClock } from '../clock';
import { checkpointHash, CheckpointSchema, type AccountCheckpoint } from './checkpoint';
import { MatchCheckpoints, type CheckpointEvent, type CheckpointLease } from './checkpoint-store';
import { RecoveryJournal, terminalEntryHash, type TerminalEntry } from './recovery-journal';
import type { MatchOutcomes, SettlementReceipt } from './outcomes';
import { outcomeHash } from './outcome-journal';

/** One live room's ownership and terminal delivery. Inputs are server snapshots, never player request bodies. */
export class LiveCheckpoints {
  private lease: CheckpointLease | undefined;
  private saved: AccountCheckpoint | undefined;
  private validUntil = 0;
  private lost = false;
  private pulse: NodeJS.Timeout | undefined;
  private renewing: Promise<void> | undefined;
  private terminal: TerminalEntry | undefined;
  private durableTerminal = false;
  constructor(
    private readonly store: MatchCheckpoints,
    private readonly journal: RecoveryJournal,
    private readonly outcomes: Pick<MatchOutcomes, 'record'>,
    private readonly clock: ServerClock,
    private readonly onLost: () => void,
  ) {}
  bind(lease: CheckpointLease, record: AccountCheckpoint, requestedAt: number) {
    if (this.lease || lease.storageId !== this.store.storageId || lease.ownerId !== this.store.ownerId)
      throw new ApiError('CONFLICT', 409);
    this.lease = { ...lease };
    this.saved = structuredClone(record);
    // Request start is conservative: network/SQL waiting can never extend local authority beyond the DB lease.
    this.validUntil = requestedAt + this.store.leaseMs;
    this.pulse = setInterval(
      () => {
        if (!this.renewing)
          this.renewing = this.renew().finally(() => {
            this.renewing = undefined;
          });
      },
      Math.max(100, Math.floor(this.store.leaseMs / 3)),
    );
    this.pulse.unref();
  }
  active() {
    return !!this.lease && !this.lost && this.clock.nowMs() < this.validUntil;
  }
  private failOwnership() {
    if (this.lost) return;
    this.lost = true;
    clearInterval(this.pulse);
    this.onLost();
  }
  private async renew() {
    if (!this.lease || this.lost) return;
    const began = this.clock.nowMs();
    try {
      if (!(await this.store.renew(this.lease))) {
        this.failOwnership();
        return;
      }
      this.validUntil = Math.max(this.validUntil, began + this.store.leaseMs);
    } catch {
      if (!this.active()) this.failOwnership();
    }
  }
  async save(value: AccountCheckpoint, event: CheckpointEvent): Promise<void> {
    if (!this.lease || this.lost) throw new ApiError('UNAVAILABLE', 503, true);
    const record = CheckpointSchema.parse(value),
      began = this.clock.nowMs();
    const lease = await this.store.write(this.lease, record, event);
    this.lease = lease;
    this.saved = record;
    this.validUntil = Math.max(this.validUntil, began + this.store.leaseMs);
  }
  hasDurableTerminal() {
    return this.durableTerminal;
  }
  async recordTerminal(value: AccountCheckpoint): Promise<SettlementReceipt> {
    const record = CheckpointSchema.parse(value);
    if (!record.terminal || !this.lease || !this.saved) throw new ApiError('CONFLICT', 409);
    if (!this.terminal)
      this.terminal = { format: 1, base: { ...this.lease, payloadHash: checkpointHash(this.saved) }, record };
    const entry = this.terminal;
    if (outcomeHash(entry.record.terminal!) !== outcomeHash(record.terminal)) throw new ApiError('CONFLICT', 409);
    if (!this.durableTerminal) {
      const attempts = await Promise.allSettled([
        this.save(entry.record, 'terminal').then(() => true),
        (async () => {
          if (!this.active()) return false;
          const previous = await this.journal.peek(record.matchId);
          // A prior epoch's file that was absent at takeover cannot represent an acknowledged old result.
          if (previous && BigInt(previous.base.epoch) < BigInt(entry.base.epoch))
            await this.journal.quarantine(record.matchId);
          await this.journal.put(entry);
          return this.active();
        })(),
      ]);
      this.durableTerminal = attempts.some((result) => result.status === 'fulfilled' && result.value);
    }
    if (!this.durableTerminal) return { status: 'pending', recorded: false, recoverable: false };
    // An epoch-fenced SQL checkpoint OR a journal published within our lease is already a durable outcome source.
    const receipt = await this.outcomes.record(entry.record.terminal!);
    if (receipt.recorded) {
      try {
        await this.journal.remove(entry.record.matchId, terminalEntryHash(entry));
      } catch {
        console.error(
          JSON.stringify({ event: 'match_recovery', code: 'terminal-cleanup-failed', matchId: entry.record.matchId }),
        );
      }
    }
    return { ...receipt, recoverable: true };
  }
  async close() {
    this.lost = true;
    clearInterval(this.pulse);
    await this.renewing;
    if (this.lease) await this.store.release(this.lease);
  }
}
