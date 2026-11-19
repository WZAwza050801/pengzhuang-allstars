import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startWebPageFixture } from './web-page-fixture.mjs';

const server = await startWebPageFixture();
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.base}match?mode=practice`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.stage canvas', { timeout: 30000 });
  await page.locator('.menu-btn').click();
  const select = page.locator('.ai-level');
  await select.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await select.inputValue(), 'normal', 'practice defaults to normal difficulty');
  await select.selectOption('hard');
  assert.equal(await page.evaluate(() => localStorage.getItem('pz_ai_level')), 'hard', 'difficulty choice persists');
  assert.match(await page.locator('.t1 .tname').textContent(), /困难/, 'bot seat label reflects hard difficulty');
  // Background/foreground must suspend/resume without errors (AI computation pauses).
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await page.locator('.menu .close').click();
  await page.waitForSelector('.stage canvas', { timeout: 10000 });
  assert.deepEqual(errors, [], 'no page errors across difficulty change and background/foreground');
  console.log('AI PRACTICE BROWSER PASS | difficulty selector + persistence + background/foreground');
} finally {
  await browser.close();
  await server.close();
}