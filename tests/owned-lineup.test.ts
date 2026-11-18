import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { placeOwnedCard, canSaveOwnedLineup, resolveLineupSave } from '../packages/client-model/src/owned-lineup';
const cards = Array.from({ length: 6 }, (_, index) => ({
  id: randomUUID(),
  playerDefId: `p0${index + 1}`,
  status: 'active' as const,
  level: 1,
  version: 0,
  exp: '0',
}));
const slots = cards.slice(0, 5).map((card) => card.id);
test('point selection swaps an existing card without duplicates and preserves slot order', () => {
  expect(placeOwnedCard(slots, 0, slots[4], cards)).toEqual([slots[4], slots[1], slots[2], slots[3], slots[0]]);
  expect(slots[0]).toBe(cards[0].id);
  expect(placeOwnedCard(slots, 2, cards[5].id, cards)).toEqual([slots[0], slots[1], cards[5].id, slots[3], slots[4]]);
});
test('unknown, disabled and invalid slots cannot be placed; occupation is not a formation hard limit', () => {
  for (const slot of [-1, 5, 0.5]) expect(placeOwnedCard(slots, slot, cards[0].id, cards)).toBeNull();
  expect(placeOwnedCard(slots, 0, randomUUID(), cards)).toBeNull();
  expect(placeOwnedCard(slots, 0, cards[0].id, [{ ...cards[0], status: 'disabled' }, ...cards.slice(1)])).toBeNull();
  expect(canSaveOwnedLineup(slots, cards)).toBe(true);
});
test('saving requires five distinct currently active owned cards', () => {
  for (const draft of [
    slots.slice(0, 4),
    [...slots.slice(0, 4), null],
    [...slots.slice(0, 4), slots[0]],
    [...slots.slice(0, 4), randomUUID()],
  ])
    expect(canSaveOwnedLineup(draft, cards)).toBe(false);
  expect(
    canSaveOwnedLineup(
      slots,
      cards.map((card, index) => (index === 2 ? { ...card, status: 'disabled' as const } : card)),
    ),
  ).toBe(false);
});
test('an owned card whose definition is absent from this client cannot be placed or saved as usable', () => {
  const unknown = [{ ...cards[0], playerDefId: 'p9999' }, ...cards.slice(1)];
  expect(canSaveOwnedLineup(slots, unknown)).toBe(false);
  expect(placeOwnedCard(slots, 0, cards[0].id, unknown)).toBeNull();
});
test('unknown save outcomes are resolved from the server without resubmitting or overwriting a conflicting draft', () => {
  const input = { ownedCardIds: slots, expectedRevision: 2 };
  expect(resolveLineupSave({ ownedCardIds: slots, revision: 3 }, input)).toBe('saved');
  expect(resolveLineupSave({ ownedCardIds: slots, revision: 2 }, input)).toBe('unchanged');
  expect(resolveLineupSave({ ownedCardIds: [...slots].reverse(), revision: 4 }, input)).toBe('conflict');
});
