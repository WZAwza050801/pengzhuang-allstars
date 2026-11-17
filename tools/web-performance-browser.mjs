import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const CLIENT = path.join(ROOT, 'work', 'test-client');
const REPORT_DIR = path.join(ROOT, 'docs', 'productization', 'reports', 'web-04');
const REPORT = path.join(REPORT_DIR, 'browser.json');
const MiB = 1024 * 1024;

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html';
  if (file.endsWith('.js')) return 'text/javascript';
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.webp')) return 'image/webp';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

async function startWeb() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      let file = path.resolve(CLIENT, `.${decodeURIComponent(url.pathname)}`);
      if (!file.startsWith(CLIENT)) {
        response.writeHead(403).end();
        return;
      }
      if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(CLIENT, 'index.html');
      response.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
      response.end(readFileSync(file));
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function heap(cdp) {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined);
  return cdp.send('Runtime.getHeapUsage');
}

async function enterPractice(page) {
  await page.getByRole('button', { name: '开始练习', exact: true }).click();
  await page.waitForURL(/\/match\?mode=practice$/);
  await page.waitForSelector('.game canvas');
}

async function exitPractice(page) {
  await page.locator('.menu-btn').click();
  await page.locator('.menu .exit').click();
  await page.getByRole('heading', { name: '碰撞全明星', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.game') && !('__pz' in window));
}

if (!existsSync(path.join(CLIENT, 'index.html'))) throw new Error('缺少 work/test-client；请通过 npm run test:web-performance 启动。');
const matchChunk = readdirSync(path.join(CLIENT, 'assets')).find((file) => /^matchScreen-.*\.js$/.test(file));
assert.ok(matchChunk, '练习赛必须作为独立动态 chunk，不能进入大厅首屏包');

const server = await startWeb();
const address = server.address();
if (!address || typeof address === 'string') throw new Error('静态测试服务未提供端口');
const base = `http://127.0.0.1:${address.port}/`;
const report = {
  environment: {
    browser: 'Chromium headless',
    viewport: { width: 390, height: 844, deviceScaleFactor: 3 },
    weakNetwork: { latencyMs: 150, downloadBytesPerSecond: 204800, uploadBytesPerSecond: 102400 },
  },
  bundle: { matchChunk, matchChunkBytes: statSync(path.join(CLIENT, 'assets', matchChunk)).size, initialResourceBytes: 0, matchChunkLoadedBeforeNavigation: false, fieldResourceLoadedBeforeNavigation: false },
  firstScreen: null,
  frames: null,
  tenMatches: null,
  consoleErrors: [],
};
let browser;

try {
  browser = await chromium.launch({ headless: true, args: ['--js-flags=--expose-gc'] });
  const weakContext = await browser.newContext({ viewport: report.environment.viewport });
  const weakPage = await weakContext.newPage();
  weakPage.on('console', (message) => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  weakPage.on('pageerror', (error) => report.consoleErrors.push(error.message));
  const weakCdp = await weakContext.newCDPSession(weakPage);
  await weakCdp.send('Network.enable');
  await weakCdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: report.environment.weakNetwork.latencyMs,
    downloadThroughput: report.environment.weakNetwork.downloadBytesPerSecond,
    uploadThroughput: report.environment.weakNetwork.uploadBytesPerSecond,
    connectionType: 'cellular3g',
  });
  const firstStart = performance.now();
  await weakPage.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await weakPage.getByRole('button', { name: '开始练习', exact: true }).waitFor({ timeout: 15000 });
  report.firstScreen = { interactiveMs: Math.round(performance.now() - firstStart) };
  const initialResources = await weakPage.evaluate(() => performance.getEntriesByType('resource').map((entry) => ({ name: entry.name, transferSize: entry.transferSize })));
  report.bundle.initialResourceBytes = initialResources.reduce((total, entry) => total + entry.transferSize, 0);
  report.bundle.matchChunkLoadedBeforeNavigation = initialResources.some((entry) => new URL(entry.name).pathname.endsWith(`/assets/${matchChunk}`));
  report.bundle.fieldResourceLoadedBeforeNavigation = initialResources.some((entry) => new URL(entry.name).pathname.includes('/assets/fields/'));
  assert.ok(report.firstScreen.interactiveMs < 15000, `弱网首屏 ${report.firstScreen.interactiveMs}ms 超过 15s`);
  assert.equal(report.bundle.matchChunkLoadedBeforeNavigation, false, '大厅首屏不应预取比赛 chunk');
  assert.equal(report.bundle.fieldResourceLoadedBeforeNavigation, false, '大厅首屏不应预取比赛场地资源');
  await weakCdp.detach();
  await weakContext.close();

  const context = await browser.newContext({ viewport: report.environment.viewport });
  const page = await context.newPage();
  page.on('console', (message) => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => report.consoleErrors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '碰撞全明星', exact: true }).waitFor();
  const cdp = await context.newCDPSession(page);

  await enterPractice(page);
  const frameTimes = await page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    let previous = performance.now();
    const frame = (now) => {
      samples.push(now - previous);
      previous = now;
      if (samples.length === 180) resolve(samples);
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }));
  report.frames = { samples: frameTimes.length, p50Ms: Number(percentile(frameTimes, 0.5).toFixed(2)), p95Ms: Number(percentile(frameTimes, 0.95).toFixed(2)), maxMs: Number(Math.max(...frameTimes).toFixed(2)) };
  assert.ok(report.frames.p95Ms <= 50, `p95 帧间隔 ${report.frames.p95Ms}ms 超过 50ms`);
  await exitPractice(page);

  await enterPractice(page);
  await exitPractice(page);
  const warm = await heap(cdp);
  for (let index = 0; index < 10; index += 1) {
    await enterPractice(page);
    await exitPractice(page);
  }
  const after = await heap(cdp);
  report.tenMatches = { baselineHeapBytes: warm.usedSize, afterHeapBytes: after.usedSize, growthBytes: after.usedSize - warm.usedSize };
  assert.ok(report.tenMatches.growthBytes <= 6 * MiB, `10 局后堆增长 ${report.tenMatches.growthBytes}B 超过 6MiB`);
  await cdp.detach();
  await context.close();

  assert.equal(report.consoleErrors.length, 0, report.consoleErrors.join('\n'));
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Web performance: first screen ${report.firstScreen.interactiveMs}ms, p95 ${report.frames.p95Ms}ms, ten-match heap ${report.tenMatches.growthBytes}B`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
