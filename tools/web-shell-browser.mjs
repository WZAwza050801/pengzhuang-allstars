import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startWebPageFixture } from './web-page-fixture.mjs';

const reportDirectory = fileURLToPath(new URL('../docs/productization/reports/', import.meta.url));
const reportPath = `${reportDirectory}UI-02-browser.json`;
const server = await startWebPageFixture();
const base = server.base;

const browser = await chromium.launch({ headless: true });
const report = { base, views: [], recoveredMountFailure: false, consoleErrors: [] };

try {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '碰撞全明星', exact: true }).waitFor();

    const initialLayout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      navigationDirection: getComputedStyle(document.querySelector('nav')).flexDirection,
    }));
    assert.equal(initialLayout.overflow, false, `horizontal overflow at ${viewport.width}px`);
    assert.equal(initialLayout.navigationDirection, viewport.width >= 780 ? 'column' : 'row');

    await page.getByRole('button', { name: '好友约战', exact: true }).click();
    await page.getByText('该功能尚未开放。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '关闭提示', exact: true }).click();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.getByRole('button', { name: '开始练习', exact: true }).click();
      await page.waitForURL(/\/match\?mode=practice$/);
      await page.waitForSelector('.game canvas');
      assert.equal(await page.locator('.game').count(), 1, 'only one canvas host may remain mounted');

      await page.locator('.menu-btn').click();
      await page.locator('.menu .exit').click();
      await page.getByRole('heading', { name: '碰撞全明星', exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('.game') && !('__pz' in window));
    }

    report.views.push({ viewport, ...initialLayout });
    report.consoleErrors.push(...errors.map((error) => ({ viewport, error })));
    await context.close();
  }

  const recoveryContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const recoveryPage = await recoveryContext.newPage();
  const recoveryErrors = [];
  recoveryPage.on('console', (message) => {
    if (message.type() === 'error') recoveryErrors.push(message.text());
  });
  recoveryPage.on('pageerror', (error) => recoveryErrors.push(error.message));
  await recoveryPage.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.addEventListener;
    let pointerDownRegistrations = 0;
    HTMLCanvasElement.prototype.addEventListener = function (type, ...args) {
      if (type === 'pointerdown' && ++pointerDownRegistrations === 2) {
        throw new Error('Injected Canvas mount failure');
      }
      return original.call(this, type, ...args);
    };
  });
  await recoveryPage.goto(base, { waitUntil: 'networkidle' });
  await recoveryPage.getByRole('button', { name: '开始练习', exact: true }).click();
  await recoveryPage.getByRole('heading', { name: '无法进入练习赛', exact: true }).waitFor();
  await recoveryPage.getByRole('button', { name: '重试', exact: true }).click();
  await recoveryPage.waitForSelector('.game canvas');
  await recoveryPage.locator('.menu-btn').click();
  await recoveryPage.locator('.menu .exit').click();
  await recoveryPage.waitForFunction(() => !document.querySelector('.game') && !('__pz' in window));
  report.recoveredMountFailure = true;
  report.consoleErrors.push(...recoveryErrors.map((error) => ({ viewport: { width: 390, height: 844 }, error })));
  await recoveryContext.close();

  assert.equal(report.consoleErrors.length, 0, report.consoleErrors.map(({ error }) => error).join('\n'));
  mkdirSync(reportDirectory, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Web shell browser: ${report.views.length} desktop/mobile views and repeated mount teardown passed`);
} finally {
  await browser.close();
  await server.close();
}
