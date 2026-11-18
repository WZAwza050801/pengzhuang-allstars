import type { QueueCommand, QueueEntry, QueueOptions, QueueStatus } from '../../contracts/src/matchmaking';
import type { AccountFailure, AccountResponse } from './account';

export interface QueuePort {
  queueOptions(): Promise<AccountResponse<QueueOptions>>;
  queueStatus(userId: string): Promise<AccountResponse<QueueStatus>>;
  enterQueue(userId: string, command: QueueCommand): Promise<AccountResponse<QueueStatus>>;
  cancelQueue(userId: string, id: string): Promise<AccountResponse<QueueStatus>>;
}
export const queueActive = (entry: QueueEntry | null | undefined) =>
  entry?.state === 'queued' || entry?.state === 'matched';
export interface QueueSnapshot {
  data: QueueStatus | null;
  options: QueueOptions | null;
  loading: boolean;
  busy: boolean;
  pending: 'entry' | 'cancel' | null;
  problem: AccountFailure | null;
  notice: string;
  observedAt: number;
}
/** Owns request ordering and original-intent retry; views never optimistically announce cancellation. */
export class QueueStateModel {
  private value: QueueSnapshot = Object.freeze({
    data: null,
    options: null,
    loading: true,
    busy: false,
    pending: null,
    problem: null,
    notice: '',
    observedAt: 0,
  });
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private reading: Promise<void> | undefined;
  private command: QueueCommand | null = null;
  private cancelId: string | null = null;
  private disposed = false;
  constructor(
    private readonly api: QueuePort,
    private readonly userId: string,
    private readonly isCurrent: () => boolean = () => true,
  ) {}
  get snapshot() {
    return this.value;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private alive() {
    return !this.disposed && this.isCurrent();
  }
  private set(patch: Partial<QueueSnapshot>) {
    this.value = Object.freeze({ ...this.value, ...patch });
    for (const listener of this.listeners) listener();
  }
  refresh(forceOptions = false): Promise<void> {
    if (!this.alive() || this.value.busy) return Promise.resolve();
    if (this.reading) return this.reading;
    const generation = this.generation;
    const loadOptions = forceOptions || !this.value.options;
    this.set({ loading: !this.value.data || !this.value.options });
    const job = (async () => {
      const [status, options] = await Promise.all([
        this.api.queueStatus(this.userId),
        loadOptions ? this.api.queueOptions() : Promise.resolve(null),
      ]);
      if (!this.alive() || generation !== this.generation) return;
      if (!status.ok) {
        this.set({
          loading: false,
          problem: status.error,
        });
        return;
      }
      let pending = this.value.pending;
      if (pending === 'entry' && status.data.entry?.intentId === this.command?.intentId) pending = null;
      if (pending === 'cancel' && status.data.entry?.id === this.cancelId && status.data.entry.state !== 'queued')
        pending = null;
      if (!pending) {
        this.command = null;
        this.cancelId = null;
      }
      this.set({
        data: status.data,
        options: options?.ok ? options.data : this.value.options,
        loading: false,
        pending,
        problem: options && !options.ok ? options.error : pending ? this.value.problem : null,
        observedAt: Date.now(),
      });
    })();
    const flight = job.finally(() => {
      if (this.reading === flight) this.reading = undefined;
    });
    this.reading = flight;
    return flight;
  }
  enter(command: QueueCommand) {
    if (!this.alive() || this.value.busy || this.value.pending || queueActive(this.value.data?.entry))
      return Promise.resolve();
    this.command = structuredClone(command);
    return this.perform('entry');
  }
  cancel() {
    if (!this.alive() || this.value.busy || this.value.pending || this.value.data?.entry?.state !== 'queued')
      return Promise.resolve();
    this.cancelId = this.value.data.entry.id;
    return this.perform('cancel');
  }
  retry() {
    return this.value.pending ? this.perform(this.value.pending) : Promise.resolve();
  }
  private async perform(kind: 'entry' | 'cancel') {
    if (!this.alive() || this.value.busy || (kind === 'entry' ? !this.command : !this.cancelId)) return;
    const generation = ++this.generation;
    this.reading = undefined;
    this.set({ busy: true, loading: false, pending: kind, problem: null, notice: '' });
    const result = await (kind === 'entry'
      ? this.api.enterQueue(this.userId, this.command!)
      : this.api.cancelQueue(this.userId, this.cancelId!));
    if (!this.alive() || generation !== this.generation) return;
    if (result.ok) {
      this.command = null;
      this.cancelId = null;
      this.set({
        data: result.data,
        busy: false,
        pending: null,
        problem: null,
        observedAt: Date.now(),
        notice:
          kind === 'cancel' && result.data.entry?.state === 'matched'
            ? '已先完成配对，取消未生效。请进入本场比赛。'
            : '',
      });
      return;
    }
    const uncertain = result.error.retryable || result.error.code === 'NETWORK_ERROR';
    if (!uncertain) {
      this.command = null;
      this.cancelId = null;
    }
    this.set({ busy: false, pending: uncertain ? kind : null, problem: result.error });
    if (result.error.code === 'CONFLICT') {
      await this.refresh(true);
      if (this.alive() && !queueActive(this.value.data?.entry)) this.set({ problem: result.error });
    }
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.listeners.clear();
  }
}
