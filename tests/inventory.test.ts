import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readInventory } from '../packages/client-model/src/inventory';
const card = (id = randomUUID()) => ({
  id,
  playerDefId: 'p01',
  level: 1,
  version: 0,
  exp: '0',
  status: 'active' as const,
});
test('inventory consumes every owned-card page while other resources load independently', async () => {
  const first = card(),
    last = card();
  let reads = 0;
  const result = await readInventory(
    {
      inventoryCards: async (_id, cursor) => {
        reads++;
        return { ok: true, data: { cards: [cursor ? last : first], nextCursor: cursor ? null : first.id } };
      },
      inventoryLineups: async () => ({ ok: true, data: { lineups: [], nextCursor: null } }),
      inventoryWallets: async () => ({ ok: true, data: { wallets: [] } }),
    },
    randomUUID(),
  );
  expect(result.ok && result.data.cards.map((item) => item.id)).toEqual([first.id, last.id]);
  expect(reads).toBe(2);
});
test('repeated pagination cursors or duplicate card IDs fail closed instead of looping', async () => {
  const item = card();
  const result = await readInventory(
    {
      inventoryCards: async () => ({ ok: true, data: { cards: [item], nextCursor: item.id } }),
      inventoryLineups: async () => ({ ok: true, data: { lineups: [], nextCursor: null } }),
      inventoryWallets: async () => ({ ok: true, data: { wallets: [] } }),
    },
    randomUUID(),
  );
  expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE' } });
});
