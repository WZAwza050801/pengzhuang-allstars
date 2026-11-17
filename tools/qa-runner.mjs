import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const roundsArgument = process.argv.find((argument) => argument.startsWith('--rounds='));
const rounds = Number(roundsArgument?.slice('--rounds='.length) ?? 2);

if (!Number.isInteger(rounds) || rounds < 1) throw new Error('--rounds must be a positive integer');

function run(command, args, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code: code ?? 1, output }));
  });
}

function npmCommand(args) {
  if (process.platform !== 'win32') return { command: 'npm', args };
  return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', 'npm.cmd', ...args] };
}

async function requireSuccess(label, command, args, environment) {
  const result = await run(command, args, environment);
  if (result.code !== 0) throw new Error(`${label} failed (${result.code})\n${result.output.slice(-2000)}`);
  console.log(`PASS  ${label}`);
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function temporaryRoomStores() {
  return new Set(readdirSync(os.tmpdir()).filter((entry) => entry.startsWith('allstars-e2e-')));
}

async function verifyFailedRunCleanup(artifactRoot) {
  const blocker = http.createServer((_request, response) => response.end());
  await listen(blocker);
  const address = blocker.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve failure-test port');
  const before = temporaryRoomStores();
  try {
    const result = await run(process.execPath, ['tools/e2e-browser.mjs'], {
      E2E_ARTIFACT_DIR: path.join(artifactRoot, 'expected-failure'),
      E2E_WEB_PORT: String(address.port),
    });
    assert.notEqual(result.code, 0, 'Occupied E2E web port must fail with a non-zero status');
    assert.match(result.output, /静态托管测试客户端/, 'Expected the reserved web port to cause the E2E failure');
  } finally {
    await close(blocker);
  }
  assert.deepEqual(temporaryRoomStores(), before, 'Failed E2E run left a temporary room store behind');
  console.log('PASS  expected E2E failure exits non-zero and cleans processes/storage');
}

const artifactRoot = mkdtempSync(path.join(ROOT, 'work', 'qa-'));
try {
  for (let round = 1; round <= rounds; round += 1) {
    const unit = npmCommand(['run', 'test:unit']);
    const contract = npmCommand(['run', 'test:contract']);
    await requireSuccess(`unit suite round ${round}`, unit.command, unit.args);
    await requireSuccess(`contract suite round ${round}`, contract.command, contract.args);
    await Promise.all(
      [0, 1].map((instance) =>
        requireSuccess(
          `parallel E2E round ${round} instance ${instance + 1}`,
          process.execPath,
          ['tools/e2e-browser.mjs'],
          { E2E_ARTIFACT_DIR: path.join(artifactRoot, `round-${round}`, `instance-${instance + 1}`) },
        ),
      ),
    );
  }
  await verifyFailedRunCleanup(artifactRoot);
  console.log(`QA runner passed ${rounds} isolated round(s)`);
} finally {
  rmSync(artifactRoot, { recursive: true, force: true });
}
