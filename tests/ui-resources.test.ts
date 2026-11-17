import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { verifyUiPack } from '../tools/ui-assets';
import rawTokens from '../config/ui-tokens.json';
import { UiTokensSchema, UiPackLayoutSchema } from '../packages/contracts/src/ui';
import { layoutUiPack, nineSlice } from '../packages/game-core/src/ui-resources';

test('UI package has complete light/dark surfaces, icons and five stadiums without baked text', () => {
  expect(UiTokensSchema.parse(rawTokens).touchTarget).toBeGreaterThanOrEqual(44);
  const pack = layoutUiPack();
  expect(pack.sprites.filter((s) => s.kind === 'surface')).toHaveLength(18);
  expect(pack.sprites.filter((s) => s.kind === 'icon')).toHaveLength(16);
  expect(pack.sprites.filter((s) => s.kind === 'stadium')).toHaveLength(5);
  expect(pack.pages).toHaveLength(3);
  expect(UiPackLayoutSchema.safeParse(pack).success).toBe(true);
  const bad = structuredClone(pack);
  bad.sprites[0].x = 0;
  expect(UiPackLayoutSchema.safeParse(bad).success).toBe(false);
  bad.sprites[0] = { ...pack.sprites[1], id: pack.sprites[0].id };
  expect(UiPackLayoutSchema.safeParse(bad).success).toBe(false);
});

test('exported UI pack hashes match images, tokens and all nine original procedural sounds', () => {
  expect(verifyUiPack().audio.ids).toHaveLength(9);
  expect(readFileSync('tools/ui-textures.mjs', 'utf8')).not.toMatch(/\b(?:fillText|strokeText)\s*\(/);
});

test('nine-slice preserves 16px caps at wide and large-font sizes and rejects invalid targets', () => {
  const source = { x: 2, y: 2, width: 64, height: 64, inset: 16 };
  for (const [width, height] of [
    [44, 44],
    [320, 56],
    [600, 160],
  ]) {
    const slices = nineSlice(source, width, height);
    expect(slices).toHaveLength(9);
    expect(slices[0].to).toEqual({ x: 0, y: 0, width: 16, height: 16 });
    expect(slices[8].to).toEqual({ x: width - 16, y: height - 16, width: 16, height: 16 });
    expect(slices.reduce((sum, s) => sum + s.to.width * s.to.height, 0)).toBe(width * height);
  }
  for (const width of [0, 31, NaN, Infinity]) expect(() => nineSlice(source, width, 44)).toThrow();
});
