import { expect, test } from 'vitest';
import { MODE_POLICY, rulesForMode, verifyModeRules } from '../config/modes';
import { resolveModeLineup, classifyModeOutcome } from '../packages/game-core/src/modes';
import { ModeRulesSchema } from '../packages/contracts/src/modes';
import { DEFAULT_DATA as data } from '../shared/data';
import { createMatch } from '../shared/match';

const lineup = ['p01', 'p02', 'p03', 'p04', 'p05'];
const levels = [1, 4, 7, 9, 10];
const owned = lineup.map((playerDefId, i) => ({ playerDefId, level: levels[i] }));
const final = {
  authority: 'server' as const,
  durable: true,
  accountsVerified: true,
  reason: 'goals' as const,
  winner: 0 as const,
};

test('mode policy and shared summaries are immutable and version checked', () => {
  expect(Object.isFrozen(MODE_POLICY.modes.friend)).toBe(true);
  const rules = rulesForMode(data, 'friend');
  expect(rules.fixedLevel).toBe(5);
  expect(rules.skillLevelAt).toEqual([1, 4, 7]);
  expect(ModeRulesSchema.parse(JSON.parse(JSON.stringify(rules)))).toEqual(rules);
  expect(verifyModeRules(data, rules)).toEqual(rules);
  for (const changed of [
    { ...rules, fixedLevel: 10 },
    { ...rules, gameDataVersion: 'old' },
    { ...rules, reconnectSeconds: 1 },
  ])
    expect(() => verifyModeRules(data, changed)).toThrow();
  expect(() => {
    rules.skillLevelAt[0] = 2;
  }).toThrow();
});

test('practice permits trial levels; friend and ranked freeze Lv5; growth uses server-owned levels', () => {
  expect(resolveModeLineup(data, rulesForMode(data, 'practice'), lineup, { levels }).levels).toEqual(levels);
  expect(resolveModeLineup(data, rulesForMode(data, 'friend'), lineup, { levels }).levels).toEqual([5, 5, 5, 5, 5]);
  expect(resolveModeLineup(data, rulesForMode(data, 'ranked'), lineup, { levels, owned }).levels).toEqual([
    5, 5, 5, 5, 5,
  ]);
  expect(
    resolveModeLineup(data, rulesForMode(data, 'growth'), lineup, { levels: [10, 10, 10, 10, 10], owned }).levels,
  ).toEqual(levels);
});

test('owned modes reject absent, duplicate, invalid and unsupported cards without mutating inputs', () => {
  const rules = rulesForMode(data, 'ranked');
  for (const cards of [undefined, owned.slice(1), [...owned, owned[0]], owned.map((c) => ({ ...c, level: 11 }))])
    expect(() => resolveModeLineup(data, rules, lineup, { owned: cards })).toThrow();
  for (const ids of [lineup.slice(1), Array(5).fill('p01'), ['__proto__', ...lineup.slice(1)]])
    expect(() => resolveModeLineup(data, rules, ids, { owned })).toThrow();
  const unsupported = Object.values(data.players).find(
    (p) => p.skill !== 'none' && !Object.hasOwn(data.skills, p.skill),
  )!;
  const ids = [unsupported.id, ...lineup.slice(1)];
  expect(() =>
    resolveModeLineup(data, rules, ids, { owned: ids.map((playerDefId) => ({ playerDefId, level: 5 })) }),
  ).toThrow();
  expect(owned.map((c) => c.level)).toEqual(levels);
});

test('normalized lineup levels enter the real match state for both sides', () => {
  const selection = resolveModeLineup(data, rulesForMode(data, 'friend'), lineup, { levels });
  for (const firstSide of [0, 1] as const) {
    const state = createMatch(data, [selection.lineup, selection.lineup], {
      seed: 42,
      firstSide,
      levels: [selection.levels, selection.levels],
    });
    expect(state.turn).toBe(firstSide);
    expect(state.pieces.map((p) => p.level)).toEqual(Array(10).fill(5));
  }
});

test('only durable server results with verified accounts enter their mode scope', () => {
  for (const mode of ['ranked', 'growth'] as const) {
    const rules = rulesForMode(data, mode);
    expect(classifyModeOutcome(rules, final)).toMatchObject({
      verdict: 'completed',
      ratingScope: mode,
      rewardScope: mode,
    });
    for (const evidence of [
      { ...final, authority: 'local' as const },
      { ...final, durable: false },
      { ...final, accountsVerified: false },
    ])
      expect(classifyModeOutcome(rules, evidence)).toMatchObject({ ratingScope: null, rewardScope: null });
  }
  for (const mode of ['practice', 'friend'] as const)
    expect(classifyModeOutcome(rulesForMode(data, mode), final)).toMatchObject({
      ratingScope: null,
      rewardScope: null,
    });
});

test('surrender and single disconnect allow a rating loss but never match rewards; faults void all scopes', () => {
  const rules = rulesForMode(data, 'ranked');
  for (const reason of ['surrender', 'disconnect'] as const)
    expect(classifyModeOutcome(rules, { ...final, reason })).toMatchObject({
      verdict: 'forfeit',
      ratingScope: 'ranked',
      rewardScope: null,
    });
  for (const reason of ['server-fault', 'both-disconnected', 'shot-limit'] as const)
    expect(classifyModeOutcome(rules, { ...final, reason })).toMatchObject({
      verdict: 'void',
      winner: -1,
      ratingScope: null,
      rewardScope: null,
    });
  expect(classifyModeOutcome(rules, { ...final, reason: 'unknown' })).toMatchObject({ verdict: 'void' });
  expect(() => classifyModeOutcome(rules, { ...final, winner: 9 as 0 })).toThrow();
});
