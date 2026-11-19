import type { EconomyPolicy } from '../../contracts/src/economy';
import type { GameData, PlayerDef } from '../../../shared/data';
export const MAX_CURRENCY_AMOUNT = 9223372036854775807n;
export interface EconomyWallet {
  readonly coins: bigint;
  readonly fragments: bigint;
}
export interface EconomyCard {
  readonly playerDefId: string;
  readonly level: number;
}
export interface EconomyProjection {
  readonly wallet: EconomyWallet;
  readonly cards: readonly EconomyCard[];
}
export class EconomyRuleError extends Error {
  constructor(
    readonly code:
      | 'INVALID_AMOUNT'
      | 'OVERFLOW'
      | 'INSUFFICIENT_FUNDS'
      | 'MAX_LEVEL'
      | 'INVALID_LEVEL'
      | 'NOT_OWNED'
      | 'ALREADY_OWNED'
      | 'CARD_UNAVAILABLE'
      | 'INVALID_STATE',
  ) {
    super(code);
  }
}
const amount = (value: bigint) => {
  if (typeof value !== 'bigint' || value < 0n) throw new EconomyRuleError('INVALID_AMOUNT');
  if (value > MAX_CURRENCY_AMOUNT) throw new EconomyRuleError('OVERFLOW');
  return value;
};
export function changeWallet(wallet: EconomyWallet, delta: { coins?: bigint; fragments?: bigint }): EconomyWallet {
  amount(wallet.coins);
  amount(wallet.fragments);
  const coins = wallet.coins + (delta.coins ?? 0n),
    fragments = wallet.fragments + (delta.fragments ?? 0n);
  if (coins < 0n || fragments < 0n) throw new EconomyRuleError('INSUFFICIENT_FUNDS');
  return Object.freeze({ coins: amount(coins), fragments: amount(fragments) });
}
function projection(wallet: EconomyWallet, cards: readonly EconomyCard[]): EconomyProjection {
  return Object.freeze({
    wallet: changeWallet(wallet, {}),
    cards: Object.freeze(cards.map((card) => Object.freeze({ ...card }))),
  });
}
export function quoteUpgrade(policy: EconomyPolicy, level: number) {
  if (!Number.isInteger(level) || level < 1 || level > policy.maxLevel) throw new EconomyRuleError('INVALID_LEVEL');
  if (level === policy.maxLevel) throw new EconomyRuleError('MAX_LEVEL');
  const exponent = BigInt(level - 1),
    den = BigInt(policy.upgrade.growthDenominator) ** exponent;
  const coins =
    (BigInt(policy.upgrade.baseCoins) * BigInt(policy.upgrade.growthNumerator) ** exponent + den / 2n) / den;
  return Object.freeze({
    currentLevel: level,
    nextLevel: level + 1,
    coins: amount(coins),
    configVersion: policy.version,
  });
}
type Definitions = Pick<GameData, 'players' | 'skills' | 'rules'>;
export function economyAvailable(definition: PlayerDef | undefined, definitions: Definitions): definition is PlayerDef {
  return !!definition && (definition.skill === 'none' || Object.hasOwn(definitions.skills, definition.skill));
}
export function economyCardPool(definitions: Definitions) {
  return Object.values(definitions.players)
    .filter((d) => economyAvailable(d, definitions))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function definitionFor(definitions: Definitions, id: string) {
  const definition = definitions.players[id];
  if (!economyAvailable(definition, definitions)) throw new EconomyRuleError('CARD_UNAVAILABLE');
  return definition;
}
function validateProjection(state: EconomyProjection, policy: EconomyPolicy, definitions: Definitions) {
  amount(state.wallet.coins);
  amount(state.wallet.fragments);
  if (state.cards.some((card) => !Object.hasOwn(definitions.players, card.playerDefId)))
    throw new EconomyRuleError('INVALID_STATE');
  if (
    new Set(state.cards.map((c) => c.playerDefId)).size !== state.cards.length ||
    state.cards.some((c) => !Number.isInteger(c.level) || c.level < 1 || c.level > policy.maxLevel)
  )
    throw new EconomyRuleError('INVALID_STATE');
}
export function quoteDuplicateFragments(policy: EconomyPolicy, definition: PlayerDef) {
  const tier =
    definition.rarity ??
    policy.rebuiltRarityByQuality[definition.quality as keyof typeof policy.rebuiltRarityByQuality];
  const value = policy.duplicateFragments[String(tier) as keyof typeof policy.duplicateFragments];
  if (value === undefined) throw new EconomyRuleError('CARD_UNAVAILABLE');
  return amount(BigInt(value));
}
export function grantCard(policy: EconomyPolicy, definitions: Definitions, state: EconomyProjection, id: string) {
  validateProjection(state, policy, definitions);
  const definition = definitionFor(definitions, id);
  if (state.cards.some((c) => c.playerDefId === id))
    return {
      state: projection(
        changeWallet(state.wallet, { fragments: quoteDuplicateFragments(policy, definition) }),
        state.cards,
      ),
      duplicate: true,
    };
  return { state: projection(state.wallet, [...state.cards, { playerDefId: id, level: 1 }]), duplicate: false };
}

export function grantStarter(policy: EconomyPolicy, definitions: Definitions, state: EconomyProjection) {
  validateProjection(state, policy, definitions);
  let next: EconomyProjection = {
    wallet: changeWallet(state.wallet, {
      coins: BigInt(policy.starter.coins),
      fragments: BigInt(policy.starter.fragments),
    }),
    cards: state.cards,
  };
  for (const id of policy.starter.playerDefIds) next = grantCard(policy, definitions, next, id).state;
  return { grantId: policy.starter.grantId, state: projection(next.wallet, next.cards) };
}
export function upgradeCard(
  policy: EconomyPolicy,
  definitions: Definitions,
  state: EconomyProjection,
  id: string,
): EconomyProjection {
  validateProjection(state, policy, definitions);
  definitionFor(definitions, id);
  const card = state.cards.find((c) => c.playerDefId === id);
  if (!card) throw new EconomyRuleError('NOT_OWNED');
  const quote = quoteUpgrade(policy, card.level),
    wallet = changeWallet(state.wallet, { coins: -quote.coins });
  return projection(
    wallet,
    state.cards.map((c) => (c === card ? { ...card, level: quote.nextLevel } : c)),
  );
}
export function quoteCraft(policy: EconomyPolicy, definitions: Definitions, id: string) {
  return Object.freeze({
    fragments: amount(
      quoteDuplicateFragments(policy, definitionFor(definitions, id)) * BigInt(policy.craft.costMultiplier),
    ),
    configVersion: policy.version,
  });
}
export function craftCard(
  policy: EconomyPolicy,
  definitions: Definitions,
  state: EconomyProjection,
  id: string,
): EconomyProjection {
  validateProjection(state, policy, definitions);
  const quote = quoteCraft(policy, definitions, id);
  if (state.cards.some((c) => c.playerDefId === id)) throw new EconomyRuleError('ALREADY_OWNED');
  const wallet = changeWallet(state.wallet, { fragments: -quote.fragments });
  return grantCard(policy, definitions, { wallet, cards: state.cards }, id).state;
}
export interface RewardEvidence {
  readonly trustedMatch: boolean;
  readonly modeAllowsRewards: boolean;
  readonly actionsByUser: number;
  readonly elapsedSeconds: number;
  readonly termination: 'completed' | 'forfeit' | 'abandoned' | 'server-fault';
}
export function qualifiesForReward(policy: EconomyPolicy, evidence: RewardEvidence) {
  if (
    !Number.isInteger(evidence.actionsByUser) ||
    evidence.actionsByUser < 0 ||
    !Number.isFinite(evidence.elapsedSeconds) ||
    evidence.elapsedSeconds < 0
  )
    throw new EconomyRuleError('INVALID_STATE');
  return (
    evidence.trustedMatch &&
    evidence.modeAllowsRewards &&
    evidence.termination === 'completed' &&
    evidence.actionsByUser >= policy.qualification.minActionsByUser &&
    evidence.elapsedSeconds >= policy.qualification.minDurationSeconds
  );
}
export function quoteMatchReward(
  policy: EconomyPolicy,
  result: 'win' | 'draw' | 'loss',
  earnedToday: bigint,
  evidence: RewardEvidence,
) {
  amount(earnedToday);
  const eligible = qualifiesForReward(policy, evidence),
    cap = BigInt(policy.matchRewards.dailyCoinsCap),
    base = BigInt(policy.matchRewards[result]);
  const remaining = earnedToday >= cap ? 0n : cap - earnedToday;
  return Object.freeze({
    eligible,
    coins: eligible ? (base < remaining ? base : remaining) : 0n,
    capReached: remaining === 0n,
    configVersion: policy.version,
  });
}
export function participationCard(
  policy: EconomyPolicy,
  definitions: Definitions,
  qualifiedMatches: number,
  qualifiedDayIndex: number,
) {
  if (
    !Number.isInteger(qualifiedMatches) ||
    qualifiedMatches < 0 ||
    !Number.isInteger(qualifiedDayIndex) ||
    qualifiedDayIndex < 0
  )
    throw new EconomyRuleError('INVALID_STATE');
  if (qualifiedMatches < policy.participationCard.qualifiedMatches) return null;
  const pool = economyCardPool(definitions);
  if (!pool.length) throw new EconomyRuleError('CARD_UNAVAILABLE');
  return pool[qualifiedDayIndex % pool.length].id;
}
/** economy-1 has documented daily progress; later versions must declare their progress scope. */
export function quoteParticipationCard(
  policy: EconomyPolicy,
  definitions: Definitions,
  state: { progressBefore: number; addedQualifiedMatches: number; claimedToday: boolean; claimIndex: number },
) {
  if (
    !Number.isSafeInteger(state.progressBefore) ||
    state.progressBefore < 0 ||
    state.progressBefore >= policy.participationCard.qualifiedMatches ||
    !Number.isSafeInteger(state.addedQualifiedMatches) ||
    state.addedQualifiedMatches < 0 ||
    !Number.isSafeInteger(state.claimIndex) ||
    state.claimIndex < 0
  )
    throw new EconomyRuleError('INVALID_STATE');
  if (state.claimedToday) return { cardId: null, progressAfter: state.progressBefore };
  const previous = policy.participationCard.progressScope === 'carry-until-claim' ? state.progressBefore : 0;
  const progress = Math.min(policy.participationCard.qualifiedMatches, previous + state.addedQualifiedMatches);
  const cardId =
    state.addedQualifiedMatches > 0 ? participationCard(policy, definitions, progress, state.claimIndex) : null;
  return Object.freeze({ cardId, progressAfter: cardId ? 0 : progress });
}
export function economyDayKey(policy: EconomyPolicy, epochMs: number) {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0 || epochMs > Date.UTC(9999, 11, 30))
    throw new EconomyRuleError('INVALID_STATE');
  return new Date(epochMs + policy.dailyResetOffsetMinutes * 60000).toISOString().slice(0, 10);
}
export function validateEconomyReferences(policy: EconomyPolicy, definitions: Definitions) {
  if (
    policy.maxLevel !== definitions.rules.levels.max ||
    policy.starter.playerDefIds.length < definitions.rules.formation.length ||
    definitions.rules.defaultLineup.some((id) => !policy.starter.playerDefIds.includes(id))
  )
    throw new EconomyRuleError('INVALID_STATE');
  for (const id of policy.starter.playerDefIds) definitionFor(definitions, id);
  for (const card of economyCardPool(definitions)) quoteCraft(policy, definitions, card.id);
}

/** Price identity includes availability/rarity-derived quotes, not unrelated physics or display names. */
export function economyPricingSnapshot(policy: EconomyPolicy, definitions: Definitions) {
  return {
    policy,
    cards: Object.values(definitions.players)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((definition) => ({
        id: definition.id,
        available: economyAvailable(definition, definitions),
        duplicateFragments: economyAvailable(definition, definitions)
          ? quoteDuplicateFragments(policy, definition).toString()
          : null,
        craftFragments: economyAvailable(definition, definitions)
          ? quoteCraft(policy, definitions, definition.id).fragments.toString()
          : null,
      })),
  };
}
