import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_DATA } from '../shared/data';
import { PROTOCOL_VERSION } from '../shared/protocol';
import { canonicalJson } from '../packages/game-core/src/snapshot';

const filename = new URL('../config/bundled-game-manifest.json', import.meta.url);
const next = {
  schemaVersion: 1,
  protocol: PROTOCOL_VERSION,
  dataVersion: DEFAULT_DATA.version,
  sha256: createHash('sha256').update(canonicalJson(DEFAULT_DATA)).digest('hex'),
};
const content = JSON.stringify(next, null, 2) + '\n';
if (process.argv.includes('--write')) {
  const previous: { dataVersion?: string; sha256?: string } = existsSync(filename)
    ? JSON.parse(readFileSync(filename, 'utf8'))
    : {};
  if (previous.dataVersion === next.dataVersion && previous.sha256 !== next.sha256)
    throw new Error('Bump the changed component version before updating its content hash');
  writeFileSync(filename, content);
} else if (!existsSync(filename) || readFileSync(filename, 'utf8') !== content) {
  console.error('Bundled game configuration manifest is stale');
  process.exitCode = 1;
}
