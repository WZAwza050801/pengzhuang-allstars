import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { UpgradeIntentModel, upgradeIntentKey } from '../packages/client-model/src/upgrade-intent';
import type { AssetOperation } from '../packages/contracts/src/economy-operations';
const userId = randomUUID(),
  cardId = randomUUID();
const quote = {
  ownedCardId: cardId,
  playerDefId: 'p01',
  currentLevel: 1,
  nextLevel: 2,
  coins: '100',
  expectedRevision: 0,
  economyVersion: 'economy-2',
};
function storage() {
  const rows = new Map<string, string>();
  return {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
    removeItem: (key: string) => {
      rows.delete(key);
    },
  };
}
const success = (operationId: string) => ({
  ok: true as const,
  data: {
    operationId,
    kind: 'upgrade',
    economyVersion: 'economy-2',
    wallets: [],
    cards: [{ id: cardId, playerDefId: 'p01', status: 'active', level: 2, exp: '0', version: 1 }],
    ledgerIds: [],
  } as AssetOperation,
});
test('double submissions are locked synchronously and retain one pinned operation until acknowledged', async () => {
  const store = storage();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const model = new UpgradeIntentModel(
    userId,
    store,
    async (intent) => {
      calls++;
      await gate;
      return success(intent.operationId);
    },
    randomUUID,
  );
  const first = model.begin(quote);
  await model.begin(quote);
  expect(calls).toBe(1);
  expect(JSON.parse(store.getItem(upgradeIntentKey(userId))!).command).toEqual({
    expectedRevision: 0,
    expectedEconomyVersion: 'economy-2',
  });
  release();
  await first;
  expect(model.snapshot.intent).toBeNull();
  expect(store.getItem(upgradeIntentKey(userId))).toBeNull();
});
test('lost or malformed responses survive model recreation and retry the identical key and body', async () => {
  const store = storage();
  const sent: unknown[] = [];
  const first = new UpgradeIntentModel(
    userId,
    store,
    async (intent) => {
      sent.push(intent);
      return { ok: false, error: { code: 'NETWORK_ERROR', retryable: true } };
    },
    randomUUID,
  );
  await first.begin(quote);
  expect(first.snapshot.intent).not.toBeNull();
  await first.begin({ ...quote, expectedRevision: 1 });
  expect(sent).toHaveLength(1);
  const restored = new UpgradeIntentModel(
    userId,
    store,
    async (intent) => {
      sent.push(intent);
      return success(intent.operationId);
    },
    randomUUID,
  );
  await restored.retry();
  expect(sent[1]).toEqual(sent[0]);
  expect(restored.snapshot.intent).toBeNull();
});
test('another account cannot restore this record; account changes retain the original account intent', async () => {
  const store = storage();
  const model = new UpgradeIntentModel(
    userId,
    store,
    async () => ({ ok: false, error: { code: 'ACCOUNT_CHANGED', retryable: false } }),
    randomUUID,
  );
  await model.begin(quote);
  const other = new UpgradeIntentModel(randomUUID(), store, async (intent) => success(intent.operationId), randomUUID);
  expect(other.snapshot.intent).toBeNull();
  expect(model.snapshot.intent).not.toBeNull();
});
test('known rejection releases the intent; unavailable storage prevents sending any debit request', async () => {
  const store = storage();
  let calls = 0;
  const model = new UpgradeIntentModel(
    userId,
    store,
    async () => {
      calls++;
      return { ok: false, error: { code: 'INSUFFICIENT_FUNDS', retryable: false } };
    },
    randomUUID,
  );
  await model.begin(quote);
  expect(model.snapshot.intent).toBeNull();
  expect(model.snapshot.error).toBe('INSUFFICIENT_FUNDS');
  const blocked = new UpgradeIntentModel(
    userId,
    {
      ...store,
      setItem() {
        throw new Error('blocked');
      },
    },
    async (intent) => {
      calls++;
      return success(intent.operationId);
    },
    randomUUID,
  );
  await blocked.begin(quote);
  expect(blocked.snapshot.error).toBe('STORAGE_ERROR');
  expect(calls).toBe(1);
});
test('authorization and throttling failures do not discard an intent whose earlier result may be unknown', async () => {
  for (const code of ['FORBIDDEN', 'RATE_LIMITED', 'INVALID_RESPONSE', 'UNAVAILABLE', 'UNAUTHENTICATED'] as const) {
    const store = storage();
    const model = new UpgradeIntentModel(
      userId,
      store,
      async () => ({ ok: false, error: { code, retryable: true } }),
      randomUUID,
    );
    await model.begin(quote);
    expect(model.snapshot.intent).not.toBeNull();
    expect(store.getItem(upgradeIntentKey(userId))).not.toBeNull();
  }
});
test('corrupt stored JSON does not send a request or trap the user as a storage permission failure', () => {
  const store = storage();
  store.setItem(upgradeIntentKey(userId), '{broken');
  const model = new UpgradeIntentModel(userId, store, async (intent) => success(intent.operationId), randomUUID);
  expect(model.snapshot).toMatchObject({ intent: null, error: 'INVALID_SAVED_INTENT' });
});
test('a late acknowledgement cannot remove a newer operation stored by a remounted view', async () => {
  const store = storage();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const model = new UpgradeIntentModel(
    userId,
    store,
    async (intent) => {
      await gate;
      return success(intent.operationId);
    },
    randomUUID,
  );
  const request = model.begin(quote);
  const pending = JSON.parse(store.getItem(upgradeIntentKey(userId))!);
  const newer = { ...pending, operationId: randomUUID() };
  store.setItem(upgradeIntentKey(userId), JSON.stringify(newer));
  release();
  await request;
  expect(JSON.parse(store.getItem(upgradeIntentKey(userId))!).operationId).toBe(newer.operationId);
});
