import type { GameData } from '../../../shared/data';
import type { ModeRules } from '../../contracts/src/modes';
import { resolveModeLineup } from './modes';
import { pieceStats } from './balance';

export interface LineupCard {
  id: string;
  playerDefId: string;
  level: number;
  version: number;
  status: 'active' | 'disabled';
}
export class InvalidOwnedLineup extends Error {
  constructor() {
    super('Invalid owned lineup');
  }
}
export function validateOwnedFormation(data: GameData, cards: readonly LineupCard[]): void {
  if (
    cards.length !== data.rules.formation.length ||
    new Set(cards.map((card) => card.id)).size !== cards.length ||
    new Set(cards.map((card) => card.playerDefId)).size !== cards.length
  )
    throw new InvalidOwnedLineup();
  // Legacy placement accepts any roster position in any of the five formation slots.
  for (const card of cards) {
    const player = Object.hasOwn(data.players, card.playerDefId) ? data.players[card.playerDefId] : null;
    if (
      !player ||
      card.status !== 'active' ||
      !Number.isInteger(card.level) ||
      card.level < 1 ||
      card.level > data.rules.levels.max
    )
      throw new InvalidOwnedLineup();
  }
}
export function buildOwnedLineupCards(data: GameData, rules: ModeRules, cards: readonly LineupCard[]) {
  validateOwnedFormation(data, cards);
  let selection: ReturnType<typeof resolveModeLineup>;
  try {
    selection = resolveModeLineup(
      data,
      rules,
      cards.map((card) => card.playerDefId),
      { owned: cards },
    );
  } catch {
    throw new InvalidOwnedLineup();
  }
  return cards.map((card, slot) => ({
    slot,
    slotRole: data.rules.formation[slot].role,
    cardPosition: data.players[card.playerDefId].position,
    ownedCardId: card.id,
    playerDefId: card.playerDefId,
    cardVersion: card.version,
    ownedLevel: card.level,
    level: selection.levels[slot],
    stats: pieceStats(data, card.playerDefId, selection.levels[slot]),
  }));
}
