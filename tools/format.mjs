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
  'client/src/fieldDebug.ts',
  'client/src/quality.ts',
  'client/src/aiService.ts',
  'client/src/aiWorker.ts',
  'client/src/aiDebug.ts',
  'tools/ai-browser.mjs',
  'tools/ai-latency.ts',
  'tools/mode-pairs.ts',
  'tools/balance-experiments.ts',
  'tools/card-atlas.ts',
  'tools/card-textures.mjs',
  'tools/card-browser.mjs',
  'tools/ui-textures.mjs',
  'tools/ui-assets.ts',
  'tools/ui-tokens.ts',
  'tools/asset-variants.ts',
  'tools/asset-packages.ts',
  'tools/assets-browser.mjs',
  'tools/asset-matrix.mjs',
  'tools/asset-readiness.ts',
  'client/src/assets.ts',
  'client/vite.config.ts',
  'tools/components-browser.mjs',
  'client/src/componentsDebug.ts',
  'client/src/workflowDebug.ts',
  'tools/workflow-browser.mjs',
  'client/src/ui/components.ts',
  'client/src/ui/semantics.ts',
  'tools/ui-browser.mjs',
  'client/src/uiSprites.ts',
  'client/src/uiDebug.ts',
  'client/src/cardDebug.ts',
  'client/src/cardSprites.ts',
  'tools/economy-simulation.ts',
  'tools/format.mjs',
  'tools/web-page-fixture.mjs',
  'tools/check-config.ts',
  'tools/validate-balance-data.ts',
  'tools/export-balance-mapping.ts',
  'tools/export-skill-rules.ts',
  'tools/check-toolchain.mjs',
  'tools/audit-assets.mjs',
  'tools/check-plan.mjs',
);
files.push(
  'client/src/accounts/context.tsx',
  'client/src/accounts/forms.tsx',
  'client/src/accounts/access-pages.tsx',
  'client/src/accounts/profile-page.tsx',
  'client/src/accounts/routes.tsx',
  'client/src/accounts/link-token.ts',
  'client/src/accounts/pages.module.css',
  'tools/field-capture.mjs',
  'tools/asset-catalog.ts',
  'tools/export-game-config.ts',
  'tools/migrate.ts',
  'tools/run-pg-tests.mjs',
  'tools/verify-wechat-login.ts',
);
let bad = 0;
files.push('tools/check-boundaries.mjs', 'tools/export-contracts.ts');
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
