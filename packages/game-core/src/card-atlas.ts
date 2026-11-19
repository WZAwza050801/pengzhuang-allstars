import {
  CARD_QUALITIES,
  CARD_STATES,
  CardAtlasLayoutSchema,
  PlayerCardIdentitySchema,
  type CardAtlasLayout,
} from '../../contracts/src/card-atlas';

export interface CardIdentityInput {
  id: string;
  name: string;
  position: string;
  quality: string;
  rarity?: number | null;
}
export function layoutCardAtlas(roster: readonly CardIdentityInput[]): CardAtlasLayout {
  const players = roster
    .map((player) =>
      PlayerCardIdentitySchema.parse({
        id: player.id,
        name: player.name,
        position: player.position,
        quality: player.quality,
        rarity: player.rarity ?? null,
      }),
    )
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  if (!players.length || new Set(players.map((p) => p.id)).size !== players.length)
    throw new Error('Invalid roster identity');
  const gutter = 2;
  const atlas: CardAtlasLayout = {
    schemaVersion: 1,
    generatorVersion: 'card-textures-1',
    source: 'procedural-placeholder',
    gutter,
    pages: [],
    portraits: [],
    frames: [],
  };
  for (let start = 0; start < players.length; start += 64) {
    const group = players.slice(start, start + 64),
      id = `portraits-${start / 64}`,
      stride = 132;
    atlas.pages.push({
      id,
      path: `/assets/cards/${id}.png`,
      width: Math.min(8, group.length) * stride,
      height: Math.ceil(group.length / 8) * stride,
    });
    group.forEach((player, index) =>
      atlas.portraits.push({
        playerId: player.id,
        name: player.name,
        position: player.position,
        quality: player.quality,
        rarity: player.rarity,
        pageId: id,
        x: (index % 8) * stride + gutter,
        y: Math.floor(index / 8) * stride + gutter,
        width: 128,
        height: 128,
      }),
    );
  }
  atlas.pages.push({ id: 'card-frames', path: '/assets/cards/card-frames.png', width: 4 * 164, height: 5 * 228 });
  for (const quality of CARD_QUALITIES)
    for (const state of CARD_STATES) {
      const index = atlas.frames.length;
      atlas.frames.push({
        quality,
        state,
        pageId: 'card-frames',
        x: (index % 4) * 164 + gutter,
        y: Math.floor(index / 4) * 228 + gutter,
        width: 160,
        height: 224,
      });
    }
  return CardAtlasLayoutSchema.parse(atlas);
}
export function validateCardBindings(atlas: CardAtlasLayout, roster: readonly CardIdentityInput[]): true {
  const expected = layoutCardAtlas(roster);
  if (
    JSON.stringify(atlas.portraits) !== JSON.stringify(expected.portraits) ||
    JSON.stringify(atlas.frames) !== JSON.stringify(expected.frames)
  )
    throw new Error('Atlas identity or region binding mismatch');
  return true;
}
