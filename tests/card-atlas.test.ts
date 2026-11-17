import { expect, test } from 'vitest';
import { CardAtlasSchema } from '../packages/contracts/src/card-atlas';
import { layoutCardAtlas, validateCardBindings } from '../packages/game-core/src/card-atlas';
import { verifyCardAtlas } from '../tools/card-atlas';
import { DEFAULT_DATA } from '../shared/data';

const roster = Array.from({ length: 117 }, (_, i) => ({
  id: `p${String(i + 1).padStart(2, '0')}`,
  name: `球员${i + 1}`,
  position: 'FW',
  quality: 'blue',
}));

test('117 portraits and 15 reusable frames pack with gutters, fixed aspect and no overlapping or unused pages', () => {
  const atlas = layoutCardAtlas(roster);
  expect(atlas.portraits).toHaveLength(117);
  expect(atlas.frames).toHaveLength(15);
  expect(atlas.pages).toHaveLength(3);
  expect(atlas.pages.every((page) => page.width <= 2048 && page.height <= 2048)).toBe(true);
  expect(atlas.portraits.every((region) => region.width === 128 && region.height === 128)).toBe(true);
  expect(atlas.frames.every((region) => region.width === 160 && region.height === 224)).toBe(true);
  expect(validateCardBindings(atlas, roster)).toBe(true);
});

test('atlas contract rejects identity drift, overlaps, unsafe paths, oversized pages and missing states', () => {
  const original = layoutCardAtlas(roster);
  const complete = {
    ...original,
    version: 'cards-test',
    generatorSha256: 'a'.repeat(64),
    generatorEngine: 'chromium-test',
    pages: original.pages.map((page) => ({ ...page, bytes: 1, sha256: 'a'.repeat(64) })),
  };
  expect(CardAtlasSchema.safeParse(complete).success).toBe(true);
  for (const mutate of [
    (a: typeof original) => {
      a.portraits[0].playerId = a.portraits[1].playerId;
    },
    (a: typeof original) => {
      a.portraits[0].x = a.portraits[1].x;
    },
    (a: typeof original) => {
      a.pages[0].path = '/assets/cards/../secret.png';
    },
    (a: typeof original) => {
      a.pages[0].width = 4096;
    },
    (a: typeof original) => {
      a.frames.pop();
    },
    (a: typeof original) => {
      a.portraits[0].x = 0;
    },
  ]) {
    const bad = structuredClone(original);
    mutate(bad);
    expect(
      CardAtlasSchema.safeParse({
        ...bad,
        version: 'cards-test',
        generatorSha256: 'a'.repeat(64),
        generatorEngine: 'chromium-test',
        pages: bad.pages.map((page) => ({ ...page, bytes: 1, sha256: 'a'.repeat(64) })),
      }).success,
    ).toBe(false);
  }
  const mismatch = structuredClone(original);
  mismatch.portraits[0].name = '错人';
  expect(() => validateCardBindings(mismatch, roster)).toThrow('identity');
  expect(() => layoutCardAtlas([...roster, roster[0]])).toThrow();
  expect(() => layoutCardAtlas([{ ...roster[0], quality: 'invalid' }])).toThrow();
});

test('delivered page hashes, dimensions and all runtime player identities match the exported manifest', () => {
  const atlas = verifyCardAtlas();
  expect(atlas.portraits.map((p) => p.playerId).sort()).toEqual(Object.keys(DEFAULT_DATA.players).sort());
  expect(atlas.pages.every((p) => p.bytes > 0 && p.width <= 2048 && p.height <= 2048)).toBe(true);
});
