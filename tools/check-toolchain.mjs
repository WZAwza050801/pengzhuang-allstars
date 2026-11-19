import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const node = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim();
const nvm = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();
const npm = pkg.packageManager?.match(/^npm@(\d+\.\d+\.\d+)$/)?.[1];
const npmInvocation =
  process.platform === 'win32'
    ? { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', 'npm.cmd', '--version'] }
    : { command: 'npm', args: ['--version'] };
const actualNpm = spawnSync(npmInvocation.command, npmInvocation.args, {
  cwd: root,
  encoding: 'utf8',
});
const errors = [];
if (node !== nvm || pkg.engines.node !== node) errors.push('Node pins in .node-version, .nvmrc and engines must agree');
if (!npm || pkg.engines.npm !== npm) errors.push('npm engines and packageManager must agree');
if (process.versions.node !== node) errors.push(`Node ${node} required; running ${process.versions.node}`);
if (actualNpm.status !== 0 || actualNpm.stdout.trim() !== npm)
  errors.push(`npm ${npm} required; could not verify matching npm`);
if (errors.length) {
  for (const error of errors) console.error(`Toolchain: ${error}`);
  process.exitCode = 1;
} else console.log(`PASS toolchain Node ${node}, npm ${npm}`);
