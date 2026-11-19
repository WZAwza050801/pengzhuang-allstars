import { expect, test } from 'vitest';
import { ECONOMY_POLICY as p, createBundledEconomyConfiguration } from '../config/economy';
import { EconomyPolicySchema } from '@pengzhuang/contracts';
import { DEFAULT_DATA as data } from '../shared/data';
import {
  changeWallet,
  quoteUpgrade,
  quoteMatchReward,
  grantCard,
  upgradeCard,
  craftCard,
  quoteCraft,
  economyCardPool,
  economyDayKey,
  quoteParticipationCard,
  MAX_CURRENCY_AMOUNT,
  type RewardEvidence,
} from '@pengzhuang/game-core';
import { EconomySimulationLedger, simulateEconomy } from '../tools/economy-simulation';
const evidence: RewardEvidence = {
  trustedMatch: true,
  modeAllowsRewards: true,
  actionsByUser: 3,
  elapsedSeconds: 90,
  termination: 'completed',
};
test('starter grants are complete and the simulation receipt prevents replay; bundled policy is immutable and verified', () => {
  const ledger = new EconomySimulationLedger();
  expect(ledger.starter()).toBe(true);
  const before = ledger.state;
  expect(ledger.starter()).toBe(false);
  expect(ledger.state).toBe(before);
  expect(ledger.entries).toHaveLength(1);
  const another = new EconomySimulationLedger();
  another.starter();
  expect(another.state.wallet.coins).toBe(300n);
  expect(ledger.state.wallet).toEqual({ coins: 300n, fragments: 0n });
  expect(ledger.state.cards.map((c) => c.playerDefId)).toEqual(p.starter.playerDefIds);
  expect(new Set(ledger.state.cards.map((c) => c.playerDefId)).size).toBe(8);
  expect(economyCardPool(data)).toHaveLength(35);
  const bundle = createBundledEconomyConfiguration();
  expect(bundle.policy).toEqual(p);
  expect(Object.isFrozen(bundle.policy.starter)).toBe(true);
  expect(p.paymentsEnabled).toBe(false);
});
test('upgrade prices are exact integers, max level and malformed/overflow policies fail', () => {
  const prices = Array.from({ length: 9 }, (_, i) => quoteUpgrade(p, i + 1).coins);
  expect(prices).toEqual([100n, 150n, 225n, 338n, 506n, 759n, 1139n, 1709n, 2563n]);
  expect(prices.reduce((a, b) => a + b, 0n)).toBe(7489n);
  expect(() => quoteUpgrade(p, 10)).toThrow('MAX_LEVEL');
  for (const bad of [0, 11, 1.5, NaN]) expect(() => quoteUpgrade(p, bad)).toThrow('INVALID_LEVEL');
  for (const invalid of [
    { ...p, paymentsEnabled: true },
    { ...p, maxLevel: 11 },
    { ...p, starter: { ...p.starter, playerDefIds: ['p01', 'p01', 'p02', 'p03', 'p04'] } },
    { ...p, upgrade: { ...p.upgrade, growthDenominator: 0 } },
    ...['abc', '0', '-1', '1.5', '9223372036854775808'].map((baseCoins) => ({
      ...p,
      upgrade: { ...p.upgrade, baseCoins },
    })),
    { ...p, upgrade: { ...p.upgrade, baseCoins: MAX_CURRENCY_AMOUNT.toString(), growthNumerator: 1000 } },
  ])
    expect(EconomyPolicySchema.safeParse(invalid).success).toBe(false);
});
test('qualified rewards respect partial daily caps; practice/forfeit/short/abandoned matches cannot claim and server-day keys use UTC+8', () => {
  expect(quoteMatchReward(p, 'win', 290n, evidence).coins).toBe(10n);
  expect(quoteMatchReward(p, 'win', 300n, evidence).coins).toBe(0n);
  expect(quoteMatchReward(p, 'win', 350n, evidence).coins).toBe(0n);
  for (const bad of [
    { trustedMatch: false },
    { modeAllowsRewards: false },
    { actionsByUser: 1 },
    { elapsedSeconds: 29 },
    { termination: 'forfeit' as const },
    { termination: 'abandoned' as const },
    { termination: 'server-fault' as const },
  ])
    expect(quoteMatchReward(p, 'win', 0n, { ...evidence, ...bad }).coins).toBe(0n);
  expect(() => quoteMatchReward(p, 'win', -1n, evidence)).toThrow('INVALID_AMOUNT');
  expect(() => quoteMatchReward(p, 'win', 0n, { ...evidence, elapsedSeconds: NaN })).toThrow('INVALID_STATE');
  expect(economyDayKey(p, Date.parse('2026-11-17T15:59:59Z'))).toBe('2026-11-17');
  expect(economyDayKey(p, Date.parse('2026-11-17T16:00:00Z'))).toBe('2026-11-18');
  expect(() => economyDayKey(p, Infinity)).toThrow();
});
test('duplicate definitions convert once per grant id; failed upgrades do not debit or consume receipts', () => {
  const ledger = new EconomySimulationLedger();
  ledger.starter();
  const award = () => ledger.applyOnce('award-1', 'card.duplicate', (state) => grantCard(p, data, state, 'p94').state);
  expect(award()).toBe(true);
  expect(award()).toBe(false);
  expect(ledger.state.wallet.fragments).toBe(5n);
  expect(ledger.state.cards).toHaveLength(8);
  for (const level of [1, 2])
    ledger.applyOnce(`upgrade-${level}`, 'card.upgrade', (state) => upgradeCard(p, data, state, 'p94'));
  const before = ledger.state;
  expect(() => ledger.applyOnce('upgrade-3', 'card.upgrade', (state) => upgradeCard(p, data, state, 'p94'))).toThrow(
    'INSUFFICIENT_FUNDS',
  );
  expect(ledger.state).toBe(before);
  ledger.applyOnce('test-credit', 'mail.reward', (state) => ({
    ...state,
    wallet: changeWallet(state.wallet, { coins: 200n }),
  }));
  expect(ledger.applyOnce('upgrade-3', 'card.upgrade', (state) => upgradeCard(p, data, state, 'p94'))).toBe(true);
  expect(ledger.state.wallet.coins).toBe(25n);
  expect(ledger.state.cards.find((c) => c.playerDefId === 'p94')?.level).toBe(4);
});
test('crafting checks ownership and funds before debit, unsupported cards and bigint overflow fail without state mutation', () => {
  const ledger = new EconomySimulationLedger();
  ledger.starter();
  const original = ledger.state;
  const state = { ...original, wallet: { coins: 300n, fragments: 100n } },
    choice = economyCardPool(data).find(
      (def) => !state.cards.some((c) => c.playerDefId === def.id) && quoteCraft(p, data, def.id).fragments <= 100n,
    )!;
  const crafted = craftCard(p, data, state, choice.id);
  expect(crafted.cards.length).toBe(9);
  expect(state.wallet.fragments).toBe(100n);
  expect(crafted.wallet.fragments).toBe(100n - quoteCraft(p, data, choice.id).fragments);
  expect(() => craftCard(p, data, crafted, choice.id)).toThrow('ALREADY_OWNED');
  expect(() => craftCard(p, data, original, choice.id)).toThrow('INSUFFICIENT_FUNDS');
  expect(() => grantCard(p, data, original, 'p17')).toThrow('CARD_UNAVAILABLE');
  expect(() => changeWallet({ coins: MAX_CURRENCY_AMOUNT, fragments: 0n }, { coins: 1n })).toThrow('OVERFLOW');
  expect(() => changeWallet({ coins: 0n, fragments: 0n }, { coins: -1n })).toThrow('INSUFFICIENT_FUNDS');
  expect(ledger.state).toBe(original);
});
test('7/30-day forecasts conserve all currency and daily caps with reproducible integer ledgers', () => {
  const report = simulateEconomy(p, 20, 30, 42);
  expect(report.day7?.lineupLevels.map((c) => c.level)).toEqual([3, 3, 4, 3, 3, 3, 3, 3]);
  expect(report.day30?.lineupLevels.map((c) => c.level).sort()).toEqual([5, 5, 5, 6, 6, 6, 6, 6]);
  expect(report.day30?.wallet.coins).toBe('266');
  expect(report.sources.matchCoins).toBe('9000');
  expect(report.daily.every((day) => BigInt(day.matchCoins) <= 300n)).toBe(true);
  expect(new Set(report.entries.map((e) => e.operationId)).size).toBe(report.entries.length);
  expect(simulateEconomy(p, 20, 30, 42)).toEqual(report);
  expect(() => simulateEconomy(p, -1, 30, 42)).toThrow();
});

test('casual progress carries across days, a successful claim resets it, and a daily receipt prevents extra claims', () => {
  let progress = 0,
    claims = 0;
  for (let day = 1; day <= 30; day++) {
    const quote = quoteParticipationCard(p, data, {
      progressBefore: progress,
      addedQualifiedMatches: 1,
      claimedToday: false,
      claimIndex: claims,
    });
    progress = quote.progressAfter;
    if (quote.cardId) claims++;
  }
  expect(claims).toBe(10);
  expect(progress).toBe(0);
  expect(
    quoteParticipationCard(p, data, {
      progressBefore: 0,
      addedQualifiedMatches: 20,
      claimedToday: true,
      claimIndex: 0,
    }),
  ).toEqual({ cardId: null, progressAfter: 0 });
  const casual = simulateEconomy(p, 1, 30, 42);
  expect(casual.day30!.collection).toBeGreaterThan(5);
});
