import { expect, test } from 'vitest';
import { fieldArtMapping, worldToView, fieldViewport, fieldPosts } from '@pengzhuang/game-core';
import { DEFAULT_DATA, FIELD_SKINS } from '../shared/data';
const g = DEFAULT_DATA.geometry;
test('crop/rotation transforms invert for every skin mapping and every quarter turn; source corner anchors land on the same geometry', () => {
  for (const skin of FIELD_SKINS.filter((s) => s.artCrop))
    for (const rotation of [0, 90, 180, 270]) {
      const mapping = fieldArtMapping(g, { ...skin, artRotate: rotation });
      const [l, t, r, b] = skin.artCrop!;
      for (const source of [
        { x: l, y: t },
        { x: r, y: b },
        { x: (l + r) / 2, y: (t + b) / 2 },
      ]) {
        const world = mapping.sourceToWorld(source),
          round = mapping.worldToSource(world);
        expect(Math.hypot(source.x - round.x, source.y - round.y)).toBeLessThan(1e-9);
        expect(Math.abs(world.x)).toBeLessThanOrEqual(g.width / 2);
        expect(Math.abs(world.y)).toBeLessThanOrEqual(g.length / 2);
      }
      for (const side of [0, 1] as const) {
        const c = fieldViewport(g, { width: 390, height: 844, dpr: 3, side, scene: mapping.sceneBox }).camera;
        for (const post of fieldPosts(g)) {
          const direct = worldToView(post, c),
            fromSource = worldToView(mapping.sourceToWorld(mapping.worldToSource(post)), c);
          expect(Math.hypot(direct.x - fromSource.x, direct.y - fromSource.y)).toBeLessThan(1e-6);
        }
      }
    }
});
test('invalid crop/rotation fails and full-scene mapping removes the legacy 4.52mm lower-line drift', () => {
  const skin = FIELD_SKINS.find((s) => s.id === 'scene_01')!;
  const m = fieldArtMapping(g, skin);
  expect(m.sourceToWorld({ x: skin.artCrop![2], y: skin.artCrop![3] })).toEqual({ x: 3, y: 4.89 });
  for (const bad of [{ artRotate: 45 }, { artCrop: [0, 0, 0, 2] }, { sceneSize: [1, 1] }])
    expect(() => fieldArtMapping(g, { ...skin, ...bad })).toThrow();
});
