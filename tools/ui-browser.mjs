import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const directory = fileURLToPath(new URL('../docs/productization/reports/ui-assets/', import.meta.url));
mkdirSync(directory, { recursive: true });
const server = await createServer({
  configFile: fileURLToPath(new URL('../client/vite.config.ts', import.meta.url)),
  server: { host: '127.0.0.1', port: 0, open: false },
});
await server.listen();
const base = server.resolvedUrls.local[0],
  browser = await chromium.launch();
const report = {
  views: [],
  audioUserGesture: false,
  muted: false,
  retryAfterFailure: false,
  consoleErrorsAndWarnings: [],
};
try {
  const definitions = [
    { theme: 'light', font: '1', width: 1280, height: 900, dpr: 1 },
    { theme: 'dark', font: '1', width: 1280, height: 900, dpr: 1 },
    { theme: 'light', font: '2', width: 390, height: 844, dpr: 2 },
    { theme: 'dark', font: '2', width: 320, height: 568, dpr: 3 },
  ];
  for (const definition of definitions) {
    const context = await browser.newContext({
      viewport: { width: definition.width, height: definition.height },
      deviceScaleFactor: definition.dpr,
    });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (['error', 'warning'].includes(m.type())) report.consoleErrorsAndWarnings.push(m.text());
    });
    page.on('pageerror', (e) => report.consoleErrorsAndWarnings.push(e.message));
    await page.addInitScript(() => {
      window.__audioStarts = 0;
      window.__audioState = null;
      const original = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        const oscillator = original.call(this),
          start = oscillator.start.bind(oscillator);
        oscillator.start = (...args) => {
          window.__audioStarts++;
          window.__audioState = this.state;
          return start(...args);
        };
        return oscillator;
      };
    });
    await page.goto(new URL('ui-debug.html', base).href);
    await page.waitForFunction(() => window.__uiAudit?.sprites === 39);
    await page.locator('[name=theme]').selectOption(definition.theme);
    await page.locator('[name=font]').selectOption(definition.font);
    await page.waitForFunction(
      (d) => window.__uiAudit?.theme === d.theme && window.__uiAudit.fontScale === Number(d.font),
      definition,
    );
    await page.waitForFunction(() => [...document.querySelectorAll('.ui-tile canvas')].every((c) => c.width > 0));
    assert.equal(await page.locator('.ui-tile button').count(), 0);
    assert.equal(await page.locator('button.ui-tile:disabled').count(), 2);
    const primary = page.locator('button.ui-primary').first();
    await primary.click();
    assert.equal(await primary.getAttribute('aria-pressed'), 'true');
    await primary.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert.ok(
      await primary.evaluate((el) => el.matches(':focus-visible') || getComputedStyle(el).outlineStyle !== 'none'),
    );
    await primary.click();
    assert.equal(await primary.getAttribute('aria-pressed'), 'false');
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      clipped: [...document.querySelectorAll('.ui-tile')].some(
        (el) => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight,
      ),
      ...window.__uiAudit,
    }));
    assert.equal(layout.overflow, false);
    assert.equal(layout.clipped, false);
    if (definition.theme === 'light' && definition.font === '1') {
      assert.equal(await page.evaluate(() => window.__audioStarts), 0);
      await page.locator('[data-sound=goal]').click();
      await page.waitForFunction(() => window.__audioStarts === 4 && window.__audioState === 'running');
      report.audioUserGesture = true;
      await page.locator('[name=muted]').check();
      await page.locator('[data-sound=goal]').click();
      await page.waitForTimeout(450);
      assert.equal(await page.evaluate(() => window.__audioStarts), 4);
      report.muted = true;
    }
    await page.screenshot({ path: `${directory}${definition.theme}-${definition.font}x.png`, fullPage: true });
    report.views.push({ ...definition, ...layout });
    await context.close();
  }
  const page = await browser.newPage();
  await page.route('**/assets/ui/chrome-light.png', (r) => r.abort());
  await page.goto(new URL('ui-debug.html', base).href);
  await page.getByRole('button', { name: '重试', exact: true }).waitFor();
  await page.unroute('**/assets/ui/chrome-light.png');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.waitForFunction(() => window.__uiAudit?.sprites === 39);
  report.retryAfterFailure = true;
  await page.close();
  assert.equal(report.consoleErrorsAndWarnings.length, 0, report.consoleErrorsAndWarnings.join('\n'));
  const pack = JSON.parse(
    readFileSync(fileURLToPath(new URL('../client/public/assets/ui/pack.json', import.meta.url)), 'utf8'),
  );
  writeFileSync(`${directory}browser.json`, JSON.stringify({ version: pack.version, ...report }, null, 2) + '\n');
  console.log(
    `UI browser: ${report.views.length} theme/font/DPR views, 39 sprites, gesture audio, mute and image retry passed; no console errors/warnings`,
  );
} finally {
  await browser.close();
  await server.close();
}
