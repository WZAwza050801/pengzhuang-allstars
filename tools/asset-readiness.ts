import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAssetPackage } from './asset-packages';
const root = fileURLToPath(new URL('../', import.meta.url));
export function assetReadiness() {
  const { manifest, report } = createAssetPackage();
  const built = JSON.parse(readFileSync(path.join(root, 'dist/client/asset-package-report.json'), 'utf8'));
  if (built.version !== manifest.version) throw new Error('Rebuild the current client before exporting readiness');
  const applicationBytes = built.applicationFiles.reduce(
    (sum: number, file: string) => sum + readFileSync(path.join(root, 'dist/client', file)).length,
    0,
  );
  if (applicationBytes !== built.applicationBytes) throw new Error('Built application byte total differs');
  const approved = manifest.assets.filter((a) => a.releaseAllowed && a.rights === 'verified' && !!a.rightsEvidence);
  return {
    schemaVersion: 1,
    sourceVersion: report.sourceVersion,
    packageVersion: manifest.version,
    commercialReady: approved.length === manifest.assets.length,
    license: {
      approved: approved.map((a) => a.id),
      excludedFromRelease: manifest.assets
        .filter((a) => !approved.includes(a))
        .map((a) => ({
          id: a.id,
          path: a.path,
          category: a.category,
          rights: a.rights,
          reason: 'No verified release approval',
        })),
      source: 'client/public/assets/catalog.json; config/asset-sources.json',
    },
    web: {
      scope:
        'Filesystem JS/CSS/worker and public-resource totals; not measured first-screen transfer or device GPU memory',
      applicationBytes,
      publicBytes: report.totalBytes,
      catalogBytes: readFileSync(path.join(root, 'dist/client/assets/catalog.json')).length,
      packages: report.packages.map((p) => ({ id: p.id, bytes: p.bytes, decodedRgbaBytes: p.decodedRgbaBytes })),
    },
    wechat: {
      reviewedOn: '2026-11-17',
      source: 'https://developers.weixin.qq.com/minigame/dev/guide/base-ability/subPackage/useSubPackage.html',
      officialLimits: {
        main: '4M',
        total: '30M',
        independentSubpackage: '4M',
        ordinarySubpackage: 'No separate limit',
      },
      actualBuildMeasured: false,
      budgetAccepted: false,
      note: 'Web scene indexes are not WeChat subpackages; review actual game.json and upload output in WX tasks',
    },
    physicalDevices: {
      status: 'deferred-by-user',
      available: ['iPhone 15 Pro (OS/browser version unverified)'],
      unavailable: ['Android'],
      validated: [],
      note: 'No device session or device evidence collected; desktop WebKit is not iOS Safari',
    },
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = assetReadiness(),
    target = path.join(root, 'docs/productization/reports/asset-readiness.json'),
    content = JSON.stringify(report, null, 2) + '\n';
  if (process.argv.includes('--write')) writeFileSync(target, content);
  else if (!existsSync(target) || readFileSync(target, 'utf8') !== content)
    throw new Error('Asset readiness report stale');
  console.log(
    `Asset readiness: ${report.license.approved.length} approved, ${report.license.excludedFromRelease.length} excluded from release; physical acceptance deferred`,
  );
}
