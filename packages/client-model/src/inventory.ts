import type { z } from 'zod';
import type { CardPageSchema, WalletListSchema } from '../../contracts/src/player-data';
import type { LineupPageSchema, SavedLineupSchema } from '../../contracts/src/lineups';
import type { AccountResponse } from './account';
import type { OwnedCardView } from './owned-lineup';
export type SavedLineup = z.infer<typeof SavedLineupSchema>;
export interface InventoryData {
  cards: OwnedCardView[];
  lineups: SavedLineup[];
  wallets: z.infer<typeof WalletListSchema>['wallets'];
}
interface Port {
  inventoryCards(userId: string, cursor?: string): Promise<AccountResponse<z.infer<typeof CardPageSchema>>>;
  inventoryLineups(userId: string, cursor?: string): Promise<AccountResponse<z.infer<typeof LineupPageSchema>>>;
  inventoryWallets(userId: string): Promise<AccountResponse<z.infer<typeof WalletListSchema>>>;
}
const invalid = { ok: false as const, error: { code: 'INVALID_RESPONSE' as const, retryable: false } };
async function pages<T extends { id: string }>(
  read: (cursor?: string) => Promise<AccountResponse<{ items: T[]; nextCursor: string | null }>>,
): Promise<AccountResponse<T[]>> {
  const items: T[] = [],
    ids = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await read(cursor);
    if (!result.ok) return result;
    for (const item of result.data.items) {
      if (ids.has(item.id)) return invalid;
      ids.add(item.id);
      items.push(item);
    }
    if (!result.data.nextCursor) return { ok: true, data: items };
    if (cursors.has(result.data.nextCursor)) return invalid;
    cursors.add(result.data.nextCursor);
    cursor = result.data.nextCursor;
  }
  return invalid;
}
export async function readInventory(port: Port, userId: string): Promise<AccountResponse<InventoryData>> {
  const [cards, lineups, wallets] = await Promise.all([
    pages(async (cursor) => {
      const result = await port.inventoryCards(userId, cursor);
      return result.ok ? { ok: true, data: { items: result.data.cards, nextCursor: result.data.nextCursor } } : result;
    }),
    pages(async (cursor) => {
      const result = await port.inventoryLineups(userId, cursor);
      return result.ok
        ? { ok: true, data: { items: result.data.lineups, nextCursor: result.data.nextCursor } }
        : result;
    }),
    port.inventoryWallets(userId),
  ]);
  if (!cards.ok) return cards;
  if (!lineups.ok) return lineups;
  if (!wallets.ok) return wallets;
  return { ok: true, data: { cards: cards.data, lineups: lineups.data, wallets: wallets.data.wallets } };
}
