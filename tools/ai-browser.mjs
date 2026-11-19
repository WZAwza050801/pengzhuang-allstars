import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const child = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    '--config',
    'client/vite.config.ts',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let startup = '';
child.stdout.on('data', (b) => {
  startup += b;
});
child.stderr.on('data', (b) => {
  startup += b;
});
let browser;
try {
  const url = `http://127.0.0.1:${port}/ai-debug.html`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Vite failed: ${startup.slice(-1000)}`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__aiAudit, null, { timeout: 30000 });
  const result = await page.evaluate(() => window.__aiAudit);
  if (result.status !== 'passed' || errors.length) throw new Error(JSON.stringify({ result, errors }));
  const out = path.resolve('docs/productization/reports/ai-runtime');
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'browser.json'), JSON.stringify({ ...result, errors }, null, 2) + '\n');
  console.log(
    `AI browser: infinite-worker deadline ${result.timeout.elapsedMs.toFixed(1)}ms, ${result.timeout.framesDuringBlocked} RAFs and click responsive; real AI ${result.realWorker.jobMs.toFixed(1)}ms; ${result.created}/${result.terminated} workers released`,
  );
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null) {
    const stopped = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await stopped;
  }
}
