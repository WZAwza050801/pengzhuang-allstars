import portraitMap from '../../data/portrait_map.json';

const byId = new Map<string, string>();
for (const e of portraitMap.entries) byId.set(e.id, e.portraitId);

/**
 * Disc face. Players in the original map use the 1.5.5 head icon.
 * The eleven without a source portrait (p06–p16) keep their existing file.
 */
export function portraitUrl(playerId: string): string {
  const portraitId = byId.get(playerId);
  if (portraitId) return `/assets/players_original/${portraitId}.png`;
  return `/assets/players/${playerId}_avatar.png`;
}
