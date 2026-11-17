import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
function walk(directory) {
  if (!existsSync(path.join(root, directory))) return;
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) walk(name);
    else if (/\.(ts|mjs|json)$/.test(name)) files.push(name);
  }
}
for (const dir of ['config', 'tests', 'packages']) walk(dir);
files.push(
  'eslint.config.mjs',
  'vitest.config.ts',
  'tools/format.mjs',
  'tools/check-config.ts',
  'tools/check-toolchain.mjs',
  'tools/audit-assets.mjs',
  'tools/check-plan.mjs',
);
let bad = 0;
for (const name of files) {
  const full = path.join(root, name);
  const options = { ...(await prettier.resolveConfig(full)), filepath: full };
  const source = readFileSync(full, 'utf8');
  const formatted = await prettier.format(source, options);
  if (source !== formatted) {
    if (process.argv.includes('--write')) writeFileSync(full, formatted);
    else {
      console.error(`Format: ${name}`);
      bad++;
    }
  }
}
console.log(`Format checked ${files.length} owned code/config files; legacy gameplay formatting remains unchanged`);
process.exitCode = bad ? 1 : 0;
