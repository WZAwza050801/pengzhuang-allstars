import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const policy = JSON.parse(readFileSync(path.join(root, 'config/asset-sources.json'), 'utf8'));
const target = path.join(root, 'docs/productization/asset-inventory.json');
const entries = [];
function inspect(name) {
  if (policy.excludePrefixes.some((prefix) => name.startsWith(prefix))) return;
  const full = path.join(root, name);
  const stat = lstatSync(full);
  if (stat.isSymbolicLink()) throw new Error(`Asset symlinks require explicit review: ${name}`);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(full).sort()) inspect(`${name}/${entry}`);
    return;
  }
  if (!stat.isFile()) return;
  const rule = policy.rules.find((r) => name.startsWith(r.prefix));
  if (!rule) throw new Error(`No provenance rule: ${name}`);
  entries.push({
    path: name, bytes: stat.size, sha256: createHash('sha256').update(readFileSync(full)).digest('hex'),
    usage: name.startsWith('client/public/') || name.startsWith('data/') ? 'runtime' : 'source-reference',
    category: rule.category, sourceEvidence: rule.evidence,
    rights: 'unverified', releaseAllowed: false,
    releaseReason: 'No verifiable commercial redistribution grant in the repository; owner review/replacement required',
  });
}
for (const directory of policy.roots) inspect(directory);
entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const inventory = { schemaVersion: 1, policyVersion: policy.version, entries };
const content = `${JSON.stringify(inventory, null, 2)}\n`;
if (process.argv.includes('--write')) writeFileSync(target, content);
else if (!existsSync(target) || readFileSync(target, 'utf8') !== content) {
  console.error('Asset inventory is stale; review changes, then run node tools/audit-assets.mjs --write');
  process.exitCode = 1;
}
const categories = {};
for (const entry of entries) categories[entry.category] = (categories[entry.category] ?? 0) + 1;
console.log(JSON.stringify({ files: entries.length, runtime: entries.filter((e) => e.usage === 'runtime').length, categories, releaseApproved: 0 }));
