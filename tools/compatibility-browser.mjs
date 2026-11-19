import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const ROOT = process.cwd();
const CLIENT = path.join(ROOT, 'work', 'test-client');
const REPORT = path.resolve(
  process.env.COMPATIBILITY_REPORT || path.join(ROOT, 'work', 'compatibility', 'browser.json'),
);
const engines = { chromium, firefox, webkit };
const viewports = [
  {
    name: 'desktop-1280',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  { name: 'mobile-390', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
];

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
      if (!file.startsWith(CLIENT)) return response.writeHead(403).end();
      if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(CLIENT, 'index.html');
      response.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
      response.end(readFileSync(file));
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function runCase(browser, base, profile) {
  const context = await browser.newContext(profile);
  const page = await context.newPage();
  const errors = [];
  const warnings = [];
  page.on('console', (message) => {
    const detail = `${message.type()}: ${message.text()}`;
    if (message.type() === 'error') errors.push(detail);
    if (message.type() === 'warning') {
      warnings.push(detail);
      if (!message.location().url.startsWith('chrome://juggler/')) errors.push(detail);
    }
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  try {
    await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 });
    await page.getByRole('heading', { name: '碰撞全明星', exact: true }).waitFor();
    await page.getByRole('button', { name: '开始练习', exact: true }).click();
    await page.waitForURL(/\/match\?mode=practice$/);
    await page.waitForSelector('.game canvas');
    const repeatedEntry = await page.evaluate(() => {
      const entries = new Set([...document.querySelectorAll('script[type="module"][src]')].map((script) => script.src));
      return [...document.querySelectorAll('link[rel="modulepreload"]')].some((link) => entries.has(link.href));
    });
    assert.equal(repeatedEntry, false, 'The loaded document entry must not be preloaded again by a lazy route');
    await page.locator('.menu-btn').click();
    await page.locator('.menu .exit').click();
    await page.getByRole('heading', { name: '碰撞全明星', exact: true }).waitFor();
    assert.deepEqual(errors, [], errors.join('\n'));
    return { viewport: profile.name, status: 'pass', errors, warnings };
  } catch (error) {
    return {
      viewport: profile.name,
      status: 'fail',
      errors,
      warnings,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await context.close();
  }
}

if (!existsSync(path.join(CLIENT, 'index.html')))
  throw new Error('缺少 work/test-client；请通过 npm run test:compatibility 启动。');

const server = await startWeb();
const address = server.address();
if (!address || typeof address === 'string') throw new Error('兼容性静态服务未提供端口');
const base = `http://127.0.0.1:${address.port}/`;
const report = { environment: { server: '127.0.0.1:ephemeral', browsers: {} }, cases: [] };

try {
  for (const [name, engine] of Object.entries(engines)) {
    let browser;
    try {
      browser = await engine.launch({ headless: true });
      report.environment.browsers[name] = await browser.version();
      for (const profile of viewports) report.cases.push({ engine: name, ...(await runCase(browser, base, profile)) });
    } catch (error) {
      report.cases.push({
        engine: name,
        viewport: 'launch',
        status: 'fail',
        errors: [],
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await browser?.close();
    }
  }
  const failed = report.cases.filter((result) => result.status !== 'pass');
  mkdirSync(path.dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  assert.equal(
    failed.length,
    0,
    failed
      .map((result) => `${result.engine}/${result.viewport}: ${result.detail ?? result.errors.join('; ')}`)
      .join('\n'),
  );
  console.log(
    `Compatibility browser: ${report.cases.length} representative cases passed across ${Object.keys(engines).length} engines`,
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
