import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startWebPageFixture } from './web-page-fixture.mjs';

const reportDirectory = fileURLToPath(new URL('../docs/productization/reports/web-01/', import.meta.url));
const server = await startWebPageFixture();
const base = server.base;

const browser = await chromium.launch({ headless: true });
const report = { views: [], keyboard: null, consoleErrors: [] };
const viewports = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

try {
  mkdirSync(reportDirectory, { recursive: true });
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '碰撞全明星', exact: true }).waitFor();
    const layout = await page.evaluate(() => {
      const action = document.querySelector('button.pz-primary');
      const aside = document.querySelector('[data-lobby-aside]');
      const preview = document.querySelector('[data-stadium-preview]');
      const navigation = document.querySelector('nav');
      const actionBox = action?.getBoundingClientRect();
      const navigationBox = navigation?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        actionVisible: !!actionBox && actionBox.width > 0 && actionBox.bottom <= window.innerHeight,
        navigationVisible: !!navigationBox && navigationBox.height > 0 && navigationBox.bottom <= window.innerHeight,
        asideVisible: aside instanceof HTMLElement && getComputedStyle(aside).display !== 'none',
        previewVisible: preview instanceof HTMLElement && preview.getBoundingClientRect().height > 0,
      };
    });
    assert.equal(layout.overflow, false, `horizontal overflow at ${viewport.width}px`);
    assert.equal(layout.actionVisible, true, `primary action clipped at ${viewport.width}px`);
    assert.equal(layout.navigationVisible, true, `main navigation clipped at ${viewport.width}px`);
    assert.equal(layout.previewVisible, true, `stadium preview missing at ${viewport.width}px`);
    assert.equal(layout.asideVisible, viewport.width >= 1024, `desktop aside mismatch at ${viewport.width}px`);
    await page.screenshot({ path: `${reportDirectory}${viewport.width}x${viewport.height}.png` });
    report.views.push({ viewport, ...layout });
    report.consoleErrors.push(...errors.map((error) => ({ viewport, error })));
    await context.close();
  }

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await mobile.newPage();
  const mobileErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') mobileErrors.push(message.text());
  });
  page.on('pageerror', (error) => mobileErrors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.documentElement.style.setProperty('--web-font-scale', '1.4'));
  await page.getByRole('button', { name: '开始练习', exact: true }).scrollIntoViewIfNeeded();
  const largeFont = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    actionBottom: document.querySelector('button.pz-primary')?.getBoundingClientRect().bottom ?? Infinity,
  }));
  assert.equal(largeFont.overflow, false, 'large-font mobile view overflowed');
  assert.ok(largeFont.actionBottom <= 844, 'large-font primary action is clipped');
  await page.screenshot({ path: `${reportDirectory}390x844-large-font.png` });

  report.keyboard = await page.evaluate(() => {
    document.documentElement.style.setProperty('--web-viewport-height', '420px');
    document.querySelector('button.pz-primary')?.scrollIntoView({ block: 'center' });
    const action = document.querySelector('button.pz-primary')?.getBoundingClientRect();
    const nav = document.querySelector('nav')?.getBoundingClientRect();
    return { actionBottom: action?.bottom ?? Infinity, navBottom: nav?.bottom ?? Infinity };
  });
  assert.ok(report.keyboard.actionBottom <= 420, 'keyboard viewport clips the primary action');
  assert.ok(report.keyboard.navBottom <= 420, 'keyboard viewport clips main navigation');
  report.consoleErrors.push(...mobileErrors.map((error) => ({ viewport: { width: 390, height: 844, mode: 'large-font-and-keyboard' }, error })));
  await mobile.close();

  assert.equal(report.consoleErrors.length, 0, report.consoleErrors.map(({ error }) => error).join('\n'));
  writeFileSync(`${reportDirectory}browser.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`Web layout: ${report.views.length} standard views plus large-font and keyboard viewport passed`);
} finally {
  await browser.close();
  await server.close();
}
