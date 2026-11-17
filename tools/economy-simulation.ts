import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ECONOMY_POLICY } from '../config/economy';
import { EconomyPolicySchema, type EconomyPolicy } from '../packages/contracts/src/economy';
import { DEFAULT_DATA } from '../shared/data';
import { makeRng, canonicalJson } from '../packages/game-core/src';
import {
  changeWallet,
  grantStarter,
  grantCard,
  upgradeCard,
  craftCard,
  quoteCraft,
  quoteUpgrade,
  quoteMatchReward,
  quoteParticipationCard,
  economyCardPool,
  economyPricingSnapshot,
  type EconomyProjection,
} from '../packages/game-core/src/economy';

/** Test/simulation ledger only. SQL idempotency, ownership and transactions belong to DAT-04. */
export class EconomySimulationLedger {
  private current: EconomyProjection = Object.freeze({
    wallet: Object.freeze({ coins: 0n, fragments: 0n }),
    cards: Object.freeze([]),
  });
  private receipts = new Set<string>();
  readonly entries: {
    operationId: string;
    kind: string;
    configVersion: string;
    coinsDelta: string;
    fragmentsDelta: string;
    cardCount: number;
  }[] = [];
  constructor(readonly policy: EconomyPolicy = ECONOMY_POLICY) {}
  get state() {
    return this.current;
  }
  applyOnce(operationId: string, kind: string, apply: (state: EconomyProjection) => EconomyProjection) {
    if (!operationId || !this.policy.ledgerKinds.includes(kind as (typeof this.policy.ledgerKinds)[number]))
      throw new Error('Invalid simulated ledger command');
    if (this.receipts.has(operationId)) return false;
    const before = this.current,
      next = apply(before);
    changeWallet(next.wallet, {});
    this.current = Object.freeze({
      wallet: changeWallet(next.wallet, {}),
      cards: Object.freeze(next.cards.map((card) => Object.freeze({ ...card }))),
    });
    this.receipts.add(operationId);
    this.entries.push({
      operationId,
      kind,
      configVersion: this.policy.version,
      coinsDelta: (next.wallet.coins - before.wallet.coins).toString(),
      fragmentsDelta: (next.wallet.fragments - before.wallet.fragments).toString(),
      cardCount: next.cards.length,
    });
    return true;
  }
  starter() {
    return this.applyOnce(
      this.policy.starter.grantId,
      'account.starter',
      (state) => grantStarter(this.policy, DEFAULT_DATA, state).state,
    );
  }
}
export function simulateEconomy(
  policy: EconomyPolicy,
  matchesPerDay: number,
  days: number,
  seed: number,
  winRate = 0.5,
) {
  if (
    !Number.isInteger(matchesPerDay) ||
    matchesPerDay < 0 ||
    matchesPerDay > 1000 ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 365 ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    !Number.isFinite(winRate) ||
    winRate < 0 ||
    winRate > 0.9
  )
    throw new Error('Invalid economy simulation scenario');
  const ledger = new EconomySimulationLedger(policy);
  ledger.starter();
  const rng = makeRng(seed),
    daily = [],
    raw = [];
  let participationProgress = 0,
    qualifiedDays = 0,
    totalMatchCoins = 0n,
    totalUpgradeCoins = 0n,
    totalDuplicateFragments = 0n,
    totalCraftFragments = 0n,
    qualifiedMatches = 0;
  const evidence = {
    trustedMatch: true,
    modeAllowsRewards: true,
    actionsByUser: 3,
    elapsedSeconds: 90,
    termination: 'completed' as const,
  };
  for (let day = 1; day <= days; day++) {
    let earned = 0n,
      eligible = 0;
    const outcomes = { win: 0, draw: 0, loss: 0 };
    for (let match = 0; match < matchesPerDay; match++) {
      const roll = rng.next(),
        result = roll < winRate ? 'win' : roll < winRate + 0.1 ? 'draw' : 'loss';
      outcomes[result]++;
      const quote = quoteMatchReward(policy, result, earned, evidence);
      if (quote.eligible) {
        eligible++;
        qualifiedMatches++;
      }
      if (
        ledger.applyOnce(`match:${day}:${match}`, 'match.reward', (state) => ({
          ...state,
          wallet: changeWallet(state.wallet, { coins: quote.coins }),
        }))
      ) {
        earned += quote.coins;
        totalMatchCoins += quote.coins;
      }
    }
    const participation = quoteParticipationCard(policy, DEFAULT_DATA, {
      progressBefore: participationProgress,
      addedQualifiedMatches: eligible,
      claimedToday: false,
      claimIndex: qualifiedDays,
    });
    participationProgress = participation.progressAfter;
    const rewardId = participation.cardId;
    if (rewardId) {
      const before = ledger.state.wallet.fragments;
      ledger.applyOnce(
        `participation:${day}`,
        'participation.card',
        (state) => grantCard(policy, DEFAULT_DATA, state, rewardId).state,
      );
      totalDuplicateFragments += ledger.state.wallet.fragments - before;
      qualifiedDays++;
    }
    // Declared proxy policy: upgrade the selected starter five evenly; collect new cards without changing lineup.
    for (let guard = 0; guard < 100; guard++) {
      const card = ledger.state.cards
        .filter((c) => policy.starter.playerDefIds.includes(c.playerDefId) && c.level < policy.maxLevel)
        .sort((a, b) => a.level - b.level || (a.playerDefId < b.playerDefId ? -1 : 1))[0];
      if (!card) break;
      const quote = quoteUpgrade(policy, card.level);
      if (quote.coins > ledger.state.wallet.coins) break;
      ledger.applyOnce(`upgrade:${card.playerDefId}:${card.level}`, 'card.upgrade', (state) =>
        upgradeCard(policy, DEFAULT_DATA, state, card.playerDefId),
      );
      totalUpgradeCoins += quote.coins;
    }
    // Spend only earned fragments on the cheapest new supported definition; never craft an owned card.
    for (let guard = 0; guard < 100; guard++) {
      const choices = economyCardPool(DEFAULT_DATA)
        .filter((def) => !ledger.state.cards.some((c) => c.playerDefId === def.id))
        .map((def) => ({ id: def.id, price: quoteCraft(policy, DEFAULT_DATA, def.id).fragments }))
        .sort((a, b) => (a.price === b.price ? (a.id < b.id ? -1 : 1) : a.price < b.price ? -1 : 1));
      const choice = choices[0];
      if (!choice || choice.price > ledger.state.wallet.fragments) break;
      ledger.applyOnce(`craft:${choice.id}`, 'card.craft', (state) =>
        craftCard(policy, DEFAULT_DATA, state, choice.id),
      );
      totalCraftFragments += choice.price;
    }
    const row = {
      day,
      matches: matchesPerDay,
      outcomes,
      qualifiedMatches: eligible,
      participationProgress,
      matchCoins: earned.toString(),
      wallet: { coins: ledger.state.wallet.coins.toString(), fragments: ledger.state.wallet.fragments.toString() },
      collection: ledger.state.cards.length,
      lineupLevels: policy.starter.playerDefIds.map((id) => ({
        playerDefId: id,
        level: ledger.state.cards.find((c) => c.playerDefId === id)!.level,
      })),
    };
    daily.push(row);
  }
  raw.push(...ledger.entries);
  if (
    BigInt(policy.starter.coins) + totalMatchCoins - totalUpgradeCoins !== ledger.state.wallet.coins ||
    BigInt(policy.starter.fragments) + totalDuplicateFragments - totalCraftFragments !== ledger.state.wallet.fragments
  )
    throw new Error('Economy conservation failed');
  if (ledger.state.cards.length !== new Set(ledger.state.cards.map((c) => c.playerDefId)).size)
    throw new Error('Duplicate owned definition');
  return {
    matchesPerDay,
    days,
    seed,
    winRate,
    qualifiedMatches,
    sources: {
      starterCoins: policy.starter.coins,
      matchCoins: totalMatchCoins.toString(),
      duplicateFragments: totalDuplicateFragments.toString(),
    },
    sinks: { upgradeCoins: totalUpgradeCoins.toString(), craftFragments: totalCraftFragments.toString() },
    day7: daily.find((d) => d.day === 7),
    day30: daily.find((d) => d.day === 30),
    daily,
    entries: raw,
  };
}
function report() {
  const baseline = [1, 3, 10, 20].map((n) => simulateEconomy(ECONOMY_POLICY, n, 30, 42));
  const sensitivities = [80, 120].map((base) => {
    const policy = EconomyPolicySchema.parse({
      ...ECONOMY_POLICY,
      version: `economy-sensitivity-cost-${base}`,
      upgrade: { ...ECONOMY_POLICY.upgrade, baseCoins: String(base) },
    });
    const r = simulateEconomy(policy, 10, 30, 42);
    return { change: `upgrade base ${base}`, day7: r.day7, day30: r.day30, sources: r.sources, sinks: r.sinks };
  });
  for (const rate of [0.35, 0.65]) {
    const r = simulateEconomy(ECONOMY_POLICY, 10, 30, 42, rate);
    sensitivities.push({
      change: `win rate ${rate}`,
      day7: r.day7,
      day30: r.day30,
      sources: r.sources,
      sinks: r.sinks,
    });
  }
  for (const percent of [80, 120]) {
    const scale = (value: string) => ((BigInt(value) * BigInt(percent)) / 100n).toString();
    const policy = EconomyPolicySchema.parse({
      ...ECONOMY_POLICY,
      version: `economy-sensitivity-reward-${percent}`,
      matchRewards: Object.fromEntries(
        Object.entries(ECONOMY_POLICY.matchRewards).map(([key, value]) => [key, scale(value)]),
      ),
    });
    const r = simulateEconomy(policy, 10, 30, 42);
    sensitivities.push({
      change: `match rewards/cap ${percent}%`,
      day7: r.day7,
      day30: r.day30,
      sources: r.sources,
      sinks: r.sinks,
    });
  }
  const priceTable = Array.from({ length: ECONOMY_POLICY.maxLevel - 1 }, (_, i) => ({
    from: i + 1,
    to: i + 2,
    coins: quoteUpgrade(ECONOMY_POLICY, i + 1).coins.toString(),
  }));
  const references = ['reward', 'cupMatchReward', 'shop_gold', 'shop_contract'].map((name) => {
    const filename = new URL(
        `../materials/pengzhuang_rebuild/02_players_and_data/reference_tables/1.5.5/${name}.json`,
        import.meta.url,
      ),
      bytes = readFileSync(filename),
      value = JSON.parse(bytes.toString('utf8'));
    return {
      name,
      path: `materials/pengzhuang_rebuild/02_players_and_data/reference_tables/1.5.5/${name}.json`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      rows: value.rows.length,
      usedAsCurrentPrices: false,
    };
  });
  return {
    schemaVersion: 1,
    status: 'engineering-default-not-commercial-approval',
    economyVersion: ECONOMY_POLICY.version,
    gameDataVersion: DEFAULT_DATA.version,
    policySha256: createHash('sha256').update(canonicalJson(ECONOMY_POLICY)).digest('hex'),
    pricingSha256: createHash('sha256')
      .update(canonicalJson(economyPricingSnapshot(ECONOMY_POLICY, DEFAULT_DATA)))
      .digest('hex'),
    paymentsEnabled: false,
    priceTable,
    fullCardUpgradeCoins: priceTable.reduce((sum, r) => sum + BigInt(r.coins), 0n).toString(),
    supportedCardDefinitions: economyCardPool(DEFAULT_DATA).length,
    references,
    assumptions: {
      outcomes: 'fixed seed42, win .5/draw .1/loss .4; sensitivity rates declared',
      evidence: 'every simulated match is authoritative, allowed mode, completed, 3 actions/user, 90sec',
      upgrade: 'balance starter lineup five by lowest level then id',
      craft: 'cheapest supported not-yet-owned definition',
      scope: 'in-memory simulation only, not SQL/account authority',
    },
    baseline,
    sensitivities,
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = report(),
    text = JSON.stringify(value, null, 2) + '\n',
    target = new URL('../docs/productization/reports/economy.json', import.meta.url);
  const manifest = {
    schemaVersion: 1,
    economyVersion: ECONOMY_POLICY.version,
    gameDataVersion: DEFAULT_DATA.version,
    sha256: value.policySha256,
    pricingSha256: value.pricingSha256,
  };
  const manifestFile = new URL('../config/bundled-economy-manifest.json', import.meta.url),
    manifestText = JSON.stringify(manifest, null, 2) + '\n';
  if (process.argv.includes('--write')) {
    const old = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : null;
    if (
      old &&
      old.economyVersion === manifest.economyVersion &&
      (old.sha256 !== manifest.sha256 || old.pricingSha256 !== manifest.pricingSha256)
    )
      throw new Error('Bump economy version before changing its content hash');
    writeFileSync(target, text);
    writeFileSync(manifestFile, manifestText);
  } else if (
    !existsSync(target) ||
    readFileSync(target, 'utf8') !== text ||
    !existsSync(manifestFile) ||
    readFileSync(manifestFile, 'utf8') !== manifestText
  )
    throw new Error('Economy report/manifest stale; review before regenerating');
  console.log(
    `Economy simulation: ${value.baseline.length} activity profiles, 7/30 days, ${value.sensitivities.length} sensitivities, ${value.supportedCardDefinitions} available definitions, all integer/conservation guards passed`,
  );
}
