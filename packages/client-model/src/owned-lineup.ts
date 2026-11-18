import type { z } from 'zod';
import type { OwnedCardSchema } from '../../contracts/src/player-data';
import { DEFAULT_DATA } from '../../../shared/data';
export type OwnedCardView = z.infer<typeof OwnedCardSchema>;
export type LineupDraft = readonly (string | null)[];
export const canUseOwnedCard = (card: OwnedCardView) =>
  card.status === 'active' && Object.hasOwn(DEFAULT_DATA.players, card.playerDefId);
export function canSaveOwnedLineup(draft: LineupDraft, cards: readonly OwnedCardView[]): draft is readonly string[] {
  const active = new Set(cards.filter(canUseOwnedCard).map((card) => card.id));
  return draft.length === 5 && new Set(draft).size === 5 && draft.every((id) => id !== null && active.has(id));
}
export function placeOwnedCard(
  draft: LineupDraft,
  slot: number,
  cardId: string,
  cards: readonly OwnedCardView[],
): LineupDraft | null {
  if (
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot >= 5 ||
    !cards.some((card) => card.id === cardId && canUseOwnedCard(card))
  )
    return null;
  const next = Array.from({ length: 5 }, (_, index) => draft[index] ?? null);
  const old = next.indexOf(cardId);
  if (old >= 0) next[old] = next[slot];
  next[slot] = cardId;
  return next;
}
export function resolveLineupSave(
  server: { ownedCardIds: readonly string[]; revision: number },
  intent: { ownedCardIds: readonly string[]; expectedRevision: number },
): 'saved' | 'unchanged' | 'conflict' {
  const same =
    server.ownedCardIds.length === intent.ownedCardIds.length &&
    server.ownedCardIds.every((id, index) => id === intent.ownedCardIds[index]);
  return same && server.revision > intent.expectedRevision
    ? 'saved'
    : server.revision === intent.expectedRevision
      ? 'unchanged'
      : 'conflict';
}
