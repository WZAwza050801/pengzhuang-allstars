import { z } from 'zod';
import { UpgradeSchema } from '../../contracts/src/http';
import { UpgradeQuoteSchema, AssetOperationSchema, type AssetOperation } from '../../contracts/src/economy-operations';
import type { AccountResponse, AccountFailure } from './account';
const IntentSchema = z.strictObject({
  version: z.literal(1),
  userId: z.uuid(),
  ownedCardId: z.uuid(),
  operationId: z.uuid(),
  command: UpgradeSchema,
});
export type UpgradeIntent = z.infer<typeof IntentSchema>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Error = AccountFailure['code'] | 'STORAGE_ERROR' | 'INVALID_SAVED_INTENT';
interface Snapshot {
  intent: UpgradeIntent | null;
  busy: boolean;
  error: Error | null;
  result: AssetOperation | null;
}
export const upgradeIntentKey = (userId: string) => `pz-upgrade-intent-v1:${userId}`;
const definite = new Set(['INVALID_REQUEST', 'CONFLICT', 'INSUFFICIENT_FUNDS', 'NOT_FOUND']);

/** Persist before sending; unknown outcomes are replayed only with the same key and original command. */
export class UpgradeIntentModel {
  private value: Readonly<Snapshot>;
  private readonly listeners = new Set<() => void>();
  constructor(
    readonly userId: string,
    private readonly storage: Storage,
    private readonly send: (intent: UpgradeIntent) => Promise<AccountResponse<AssetOperation>>,
    private readonly uuid: () => string,
  ) {
    this.value = Object.freeze({ ...this.read(), busy: false, result: null });
  }
  get snapshot() {
    return this.value;
  }
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly getSnapshot = () => this.value;
  private set(next: Snapshot) {
    this.value = Object.freeze(next);
    for (const listener of this.listeners) listener();
  }
  private read(): { intent: UpgradeIntent | null; error: Error | null } {
    let raw: string | null;
    try {
      raw = this.storage.getItem(upgradeIntentKey(this.userId));
    } catch {
      return { intent: null, error: 'STORAGE_ERROR' };
    }
    try {
      if (raw === null) return { intent: null, error: null };
      const parsed = raw.length <= 2048 ? IntentSchema.safeParse(JSON.parse(raw)) : null;
      if (parsed?.success && parsed.data.userId === this.userId) return { intent: parsed.data, error: null };
      return { intent: null, error: 'INVALID_SAVED_INTENT' };
    } catch {
      return { intent: null, error: 'INVALID_SAVED_INTENT' };
    }
  }
  async begin(quote: unknown) {
    if (this.value.busy || this.value.intent) return;
    const prior = this.read();
    if (prior.intent || prior.error === 'STORAGE_ERROR') {
      this.set({ ...this.value, ...prior });
      return;
    }
    const price = UpgradeQuoteSchema.safeParse(quote);
    if (!price.success) {
      this.set({ ...this.value, error: 'INVALID_REQUEST' });
      return;
    }
    const intent = IntentSchema.parse({
      version: 1,
      userId: this.userId,
      ownedCardId: price.data.ownedCardId,
      operationId: this.uuid(),
      command: { expectedRevision: price.data.expectedRevision, expectedEconomyVersion: price.data.economyVersion },
    });
    try {
      this.storage.setItem(upgradeIntentKey(this.userId), JSON.stringify(intent));
    } catch {
      this.set({ ...this.value, error: 'STORAGE_ERROR' });
      return;
    }
    await this.execute(intent);
  }
  async retry() {
    if (this.value.intent && !this.value.busy) await this.execute(this.value.intent);
  }
  private clear(intent: UpgradeIntent): boolean {
    try {
      const raw = this.storage.getItem(upgradeIntentKey(this.userId));
      if (raw !== null && IntentSchema.parse(JSON.parse(raw)).operationId === intent.operationId)
        this.storage.removeItem(upgradeIntentKey(this.userId));
      return true;
    } catch {
      return false;
    }
  }
  private async execute(intent: UpgradeIntent) {
    this.set({ intent, busy: true, error: null, result: null });
    let response: AccountResponse<AssetOperation>;
    try {
      response = await this.send(IntentSchema.parse(intent));
    } catch {
      response = { ok: false, error: { code: 'NETWORK_ERROR', retryable: true } };
    }
    const parsed = response.ok ? AssetOperationSchema.safeParse(response.data) : null;
    if (
      response.ok &&
      (!parsed?.success ||
        parsed.data.kind !== 'upgrade' ||
        parsed.data.operationId !== intent.operationId ||
        !parsed.data.cards.some((card) => card.id === intent.ownedCardId))
    )
      response = { ok: false, error: { code: 'INVALID_RESPONSE', retryable: false } };
    if (response.ok || definite.has(response.error.code)) {
      const cleared = this.clear(intent);
      this.set({
        intent: cleared ? null : intent,
        busy: false,
        result: response.ok ? response.data : null,
        error: cleared ? (response.ok ? null : response.error.code) : 'STORAGE_ERROR',
      });
    } else this.set({ intent, busy: false, result: null, error: response.error.code });
  }
}
