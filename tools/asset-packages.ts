import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetCatalogSchema, type AssetCatalog } from '../packages/contracts/src/assets';
import { canonicalJson } from '../packages/game-core/src/snapshot';
import { createAssetCatalog, runtimeReferencedPaths } from './asset-catalog';
const root = fileURLToPath(new URL('../', import.meta.url));
export function createAssetPackage(
  catalog: AssetCatalog = createAssetCatalog(),
  references: ReadonlySet<string> = runtimeReferencedPaths(),
  release = false,
) {
  const targets = new Set(catalog.aliases.map((a) => a.target));
  const assets = catalog.assets.filter(
    (a) => a.priority === 'critical' || targets.has(a.id) || (!!a.path && references.has(a.path)),
  );
  if (release && assets.some((a) => !a.releaseAllowed))
    throw new Error('Release requires verified rights for every included resource');
  const payload = {
    schemaVersion: 1 as const,
    minProtocol: catalog.minProtocol,
    maxProtocol: catalog.maxProtocol,
    assets,
    aliases: catalog.aliases,
  };
  const manifest = AssetCatalogSchema.parse({
    ...payload,
    version: `assets-${createHash('sha256').update(canonicalJson(payload)).digest('hex').slice(0, 16)}`,
  });
  const groups: Record<string, string[]> = { boot: [], lobby: [], matchCommon: [], matchLow: [], matchHigh: [] };
  for (const asset of assets) {
    if (!asset.path) continue;
    const group =
      asset.priority === 'critical'
        ? 'boot'
        : asset.priority === 'lobby'
          ? 'lobby'
          : asset.path.startsWith('/assets/fields/low/')
            ? 'matchLow'
            : asset.path.startsWith('/assets/fields/') && !asset.path.includes('spring_corner')
              ? 'matchHigh'
              : 'matchCommon';
    groups[group].push(asset.id);
  }
  const packages = Object.entries(groups).map(([id, ids]) => ({
    id,
    ids,
    bytes: ids.reduce((sum, id) => sum + assets.find((a) => a.id === id)!.bytes, 0),
    decodedRgbaBytes: ids.reduce((sum, id) => {
      const a = assets.find((a) => a.id === id)!;
      return sum + (a.kind === 'image' ? a.width! * a.height! * 4 : 0);
    }, 0),
  }));
  const removed = catalog.assets
    .filter((a) => !assets.includes(a))
    .map((a) => ({ id: a.id, path: a.path, bytes: a.bytes, reason: 'not-referenced' }));
  return {
    manifest,
    report: {
      schemaVersion: 1,
      sourceVersion: catalog.version,
      version: manifest.version,
      scope: 'public resources; application JS/CSS measured by build report',
      packages,
      totalBytes: packages.reduce((sum, p) => sum + p.bytes, 0),
      removedBytes: removed.reduce((sum, a) => sum + a.bytes, 0),
      removed,
      releaseApproved: assets.filter((a) => a.releaseAllowed).length,
    },
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = createAssetPackage(undefined, undefined, process.argv.includes('--release')),
    target = path.join(root, 'docs/productization/reports/asset-packages.json'),
    content = JSON.stringify(result.report, null, 2) + '\n';
  if (process.argv.includes('--write')) writeFileSync(target, content);
  else if (!existsSync(target) || readFileSync(target, 'utf8') !== content)
    throw new Error('Asset package report stale');
  console.log(
    `Public assets: ${result.report.totalBytes} bytes; removed ${result.report.removed.length} unreferenced files / ${result.report.removedBytes} bytes`,
  );
}
