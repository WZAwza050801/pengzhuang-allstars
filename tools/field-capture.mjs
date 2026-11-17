import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd(),
  out = path.resolve(process.argv[2] ?? 'docs/productization/reports/field-calibration');
await mkdir(out, { recursive: true });
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
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
);
let startup = '';
child.stdout.on('data', (b) => {
  startup += String(b);
});
child.stderr.on('data', (b) => {
  startup += String(b);
});
let browser;
try {
  const url = `http://127.0.0.1:${port}/field-debug.html`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* server not listening yet */
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Vite did not start: ${startup.slice(-1000)}`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 840, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__fieldCalibration?.ready, null, { timeout: 30000 });
  const result = await page.evaluate(() => window.__fieldCalibration);
  result.rows.sort((a, b) => a.skin.localeCompare(b.skin, 'en') || a.side - b.side);
  if (result.rows.length !== 18 || result.rows.some((r) => r.maxErrorM >= 1e-6) || errors.length)
    throw new Error(`Calibration failed: ${JSON.stringify({ result, errors })}`);
  await page.screenshot({ path: path.join(out, 'skins-both-sides.png'), fullPage: true });
  await writeFile(
    path.join(out, 'anchors.json'),
    JSON.stringify(
      { ...result, errors, note: 'Transform error, not a new independent measurement of the original artwork' },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Field calibration: ${result.rows.length} skin/side captures, max transform error ${Math.max(...result.rows.map((r) => r.maxErrorM))}m, 0 JS errors`,
  );
} finally {
  if (browser) await browser.close();
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await stopped;
  }
}
