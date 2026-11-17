import { expect, test } from 'vitest';
import { DEFAULT_DATA as data } from '../shared/data';
import { rulesForMode } from '../config/modes';
import { buildOwnedLineupCards, validateOwnedFormation, type LineupCard } from '../packages/game-core/src/lineups';

const cards: LineupCard[] = data.rules.defaultLineup.map((playerDefId, i) => ({
  id: `card-${i}`,
  playerDefId,
  level: [1, 4, 7, 9, 10][i],
  version: 0,
  status: 'active',
}));
test('owned formation preserves five unique slots and the existing freedom to place cards across positions', () => {
  expect(() => validateOwnedFormation(data, cards)).not.toThrow();
  for (const invalid of [
    cards.slice(1),
    cards.map((card, i) => (i === 4 ? cards[3] : card)),
    cards.map((card, i) => (i === 0 ? { ...card, playerDefId: '__proto__' } : card)),
  ])
    expect(() => validateOwnedFormation(data, invalid)).toThrow();
  expect(() => validateOwnedFormation(data, [cards[3], ...cards.slice(1, 3), cards[0], cards[4]])).not.toThrow();
  for (const change of [{ status: 'disabled' as const }, { level: 0 }, { level: 11 }, { level: 1.5 }])
    expect(() =>
      validateOwnedFormation(
        data,
        cards.map((card, i) => (i === 0 ? { ...card, ...change } : card)),
      ),
    ).toThrow();
});
test('participation cards keep owned and effective levels separate under the authoritative mode rules', () => {
  const growth = buildOwnedLineupCards(data, rulesForMode(data, 'growth'), cards);
  const ranked = buildOwnedLineupCards(data, rulesForMode(data, 'ranked'), cards);
  const friend = buildOwnedLineupCards(data, rulesForMode(data, 'friend'), cards);
  expect(growth.map((card) => card.level)).toEqual([1, 4, 7, 9, 10]);
  expect(ranked.map((card) => card.ownedLevel)).toEqual([1, 4, 7, 9, 10]);
  for (const list of [ranked, friend]) expect(list.map((card) => card.level)).toEqual([5, 5, 5, 5, 5]);
  expect(cards.map((card) => card.level)).toEqual([1, 4, 7, 9, 10]);
  expect(growth.map((card) => card.slotRole)).toEqual(['DC', 'CM', 'CM', 'ST', 'ST']);
  expect(growth.map((card) => card.cardPosition)).toEqual(['GK', 'DF', 'DF', 'FW', 'FW']);
});
test('unsupported owned skills can be saved for friend play but cannot enter an official mode', () => {
  const sourceOnly = Object.values(data.players).find(
    (player) => player.position === 'FW' && player.skill === 'unimplemented',
  )!;
  expect(sourceOnly).toBeDefined();
  const selected = cards.map((card, i) => (i === 4 ? { ...card, playerDefId: sourceOnly.id } : card));
  expect(() => validateOwnedFormation(data, selected)).not.toThrow();
  expect(() => buildOwnedLineupCards(data, rulesForMode(data, 'friend'), selected)).not.toThrow();
  for (const mode of ['ranked', 'growth'] as const)
    expect(() => buildOwnedLineupCards(data, rulesForMode(data, mode), selected)).toThrow();
});
