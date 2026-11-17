import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { AssetCatalogSchema } from '@pengzhuang/contracts';
import { createAssetCatalog, imageSize } from '../tools/asset-catalog';

test('catalog scans actual runtime resources and all player/field/audio bindings with provenance and dimensions', () => {
  const c = createAssetCatalog();
  expect(c.aliases.filter((a) => a.usage === 'portrait')).toHaveLength(117);
  expect(c.aliases.filter((a) => a.usage === 'field-scene')).toHaveLength(5);
  expect(c.aliases.filter((a) => a.usage === 'audio')).toHaveLength(9);
  expect(c.aliases.filter((a) => a.usage === 'card-portrait')).toHaveLength(117);
  expect(c.aliases.filter((a) => a.usage === 'card-frame')).toHaveLength(15);
  expect(c.aliases.filter((a) => a.usage === 'ui-surface')).toHaveLength(18);
  expect(c.aliases.filter((a) => a.usage === 'ui-icon')).toHaveLength(16);
  expect(c.aliases.filter((a) => a.usage === 'ui-stadium')).toHaveLength(5);
  const mapping = c.assets.find((a) => a.path === '/assets/cards/atlas.json');
  expect(mapping).toMatchObject({ kind: 'data', width: null, height: null, priority: 'lobby' });
  for (const a of c.assets) {
    expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(a.source.evidence.length).toBeGreaterThan(0);
    expect(a.releaseAllowed).toBe(false);
    if (a.kind === 'image')
      expect(imageSize(readFileSync(`client/public${a.path}`))).toEqual({ width: a.width, height: a.height });
  }
  const file = JSON.parse(readFileSync('client/public/assets/catalog.json', 'utf8'));
  expect(file).toEqual(c);
});
test('schema rejects duplicate IDs, unresolved aliases, unsafe paths, invalid anchors and fabricated release approval', () => {
  const c = createAssetCatalog();
  const image = c.assets.find((a) => a.kind === 'image')!;
  const metadata = c.assets.find((a) => a.kind === 'data')!;
  for (const bad of [
    { ...c, assets: [...c.assets, c.assets[0]] },
    { ...c, aliases: [...c.aliases, c.aliases[0]] },
    { ...c, aliases: [{ id: 'x', target: 'missing', usage: 'portrait' }] },
    { ...c, assets: [{ ...image, path: '/materials/secret.png' }] },
    { ...c, assets: [{ ...image, anchors: { bad: { x: 2, y: 1, space: 'normalized' } } }] },
    { ...c, assets: [{ ...image, releaseAllowed: true }] },
    { ...c, assets: [{ ...metadata, path: null }] },
    { ...c, assets: [{ ...metadata, width: 128 }] },
  ])
    expect(AssetCatalogSchema.safeParse(bad).success).toBe(false);
  expect(() => imageSize(Buffer.from('corrupt'))).toThrow();
});
