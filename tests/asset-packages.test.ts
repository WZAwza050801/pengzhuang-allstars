import { expect, test } from 'vitest';
import { createAssetCatalog, runtimeReferencedPaths, imageSize } from '../tools/asset-catalog';
import { createAssetPackage } from '../tools/asset-packages';
import { verifyAssetVariants } from '../tools/asset-variants';
import { readFileSync } from 'node:fs';
test('low field textures retain the entire source aspect ratio, have correct headers, and reduce decoded memory', () => {
  const variants = verifyAssetVariants();
  expect(variants.variants).toHaveLength(10);
  for (const v of variants.variants) {
    expect(imageSize(readFileSync(`client/public${v.path}`))).toEqual({ width: v.width, height: v.height });
    expect(v.width * v.height).toBeLessThan(v.sourceWidth * v.sourceHeight);
  }
});
test('filtered build keeps every alias and explicit runtime reference, removes unreferenced art, and gates commercial release', () => {
  const source = createAssetCatalog(),
    refs = runtimeReferencedPaths(),
    { manifest, report } = createAssetPackage(source, refs);
  expect(manifest.assets.some((a) => a.path?.startsWith('/art/'))).toBe(false);
  expect(manifest.assets.filter((a) => a.path?.startsWith('/assets/skills/'))).toHaveLength(69);
  for (const frame of ['01', '02', '03', '04']) expect(refs.has(`/assets/orig_ui/Box_Quality_${frame}.png`)).toBe(true);
  for (const path of refs)
    expect(
      manifest.assets.some((a) => a.path === path),
      path,
    ).toBe(true);
  for (const alias of manifest.aliases) expect(manifest.assets.some((a) => a.id === alias.target)).toBe(true);
  const ids = report.packages.flatMap((p) => p.ids);
  expect(new Set(ids).size).toBe(ids.length);
  expect(report.removedBytes).toBeGreaterThan(0);
  expect(report.packages.find((p) => p.id === 'matchLow')!.bytes).toBeLessThan(
    report.packages.find((p) => p.id === 'matchHigh')!.bytes,
  );
  expect(() => createAssetPackage(source, refs, true)).toThrow('verified rights');
});
