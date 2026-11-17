import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const directory = fileURLToPath(new URL('../docs/productization/reports/components/', import.meta.url));
mkdirSync(directory, { recursive: true });
const server = await createServer({
  configFile: fileURLToPath(new URL('../client/vite.config.ts', import.meta.url)),
  server: { host: '127.0.0.1', port: 0, open: false },
});
await server.listen();
const base = server.resolvedUrls.local[0],
  browser = await chromium.launch(),
  report = {
    views: [],
    dialogFocus: false,
    retry: false,
    pagination: false,
    cardSelection: false,
    consoleErrorsAndWarnings: [],
  };
try {
  for (const d of [
    { theme: 'light', font: '1', width: 1280, height: 900, dpr: 1 },
    { theme: 'dark', font: '2', width: 390, height: 844, dpr: 2 },
    { theme: 'light', font: '2', width: 320, height: 568, dpr: 3 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: d.width, height: d.height },
      deviceScaleFactor: d.dpr,
    });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (['error', 'warning'].includes(m.type())) report.consoleErrorsAndWarnings.push(m.text());
    });
    page.on('pageerror', (e) => report.consoleErrorsAndWarnings.push(e.message));
    await page.goto(new URL('components-debug.html', base).href);
    await page.waitForFunction(() => window.__componentsAudit?.components === 19);
    await page.locator('[name=theme]').selectOption(d.theme);
    await page.locator('[name=font]').selectOption(d.font);
    const buttons = page.locator('[data-component=PrimaryButton]');
    const ready = buttons.locator('[data-sample-state=ready]');
    await ready.click();
    assert.equal(await buttons.locator('[data-result=actions]').textContent(), '操作次数 1');
    for (const state of ['ready', 'selected', 'disabled', 'loading', 'empty', 'error']) {
      const dom = buttons.locator(`[data-sample-state=${state}]`),
        canvas = page.locator(`canvas[data-state=${state}]`),
        can = state === 'ready' || state === 'selected';
      assert.equal(await dom.isEnabled(), can);
      assert.equal(await canvas.getAttribute('data-can-activate'), String(can));
      const sameColors = await dom.evaluate((el, state) => {
        const theme = document.documentElement.dataset.uiTheme;
        const css = getComputedStyle(el),
          probe = document.createElement('span');
        const root = getComputedStyle(document.documentElement),
          disabled = state !== 'ready' && state !== 'selected';
        probe.style.color = root.getPropertyValue(disabled ? '--ui-disabledInk' : '--ui-accentInk');
        el.append(probe);
        const ink = getComputedStyle(probe).color;
        probe.remove();
        return { theme, same: ink === css.color };
      }, state);
      assert.equal(sameColors.same, true);
      const webFill = await dom.evaluate((el) => getComputedStyle(el).backgroundColor);
      const canvasFill = await canvas.evaluate((el) => {
        const pixel = el
          .getContext('2d')
          .getImageData(Math.floor(el.width / 2), Math.floor((8 * el.width) / 260), 1, 1).data;
        return `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
      });
      assert.equal(canvasFill, webFill);
    }
    await ready.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await ready.evaluate((el) => el.matches(':focus-visible')), true);
    const opener = page.getByRole('button', { name: '打开确认框', exact: true });
    await opener.click();
    await page.getByRole('dialog').waitFor();
    assert.equal(
      await page.getByRole('button', { name: '取消', exact: true }).evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press('Shift+Tab');
    assert.equal(
      await page.getByRole('button', { name: '确认离开', exact: true }).evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press('Tab');
    assert.equal(
      await page.getByRole('button', { name: '取消', exact: true }).evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog').open);
    await page.waitForFunction(() => document.activeElement?.textContent === '打开确认框');
    await opener.click();
    await page.getByRole('button', { name: '确认离开', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-result=dialog]').textContent === '已确认');
    assert.equal(await opener.evaluate((el) => el === document.activeElement), true);
    report.dialogFocus = true;
    await page.locator('[data-component=ErrorState]').getByRole('button', { name: '重试', exact: true }).click();
    await page.getByText('重试成功（演示）', { exact: true }).waitFor();
    report.retry = true;
    const pagination = page.locator('[data-component=Pagination]');
    assert.equal(await pagination.getByRole('button', { name: '上一页' }).isDisabled(), true);
    await pagination.getByRole('button', { name: '下一页' }).click();
    assert.ok((await pagination.textContent()).includes('2 / 3'));
    report.pagination = true;
    const active = page.locator('[data-card-active]');
    await active.click();
    assert.equal(await page.locator('[data-card-active]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.pz-player-card:disabled').count(), 1);
    report.cardSelection = true;
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      clippedButtons: [...document.querySelectorAll('.pz-button')]
        .filter((e) => e.getClientRects().length)
        .some((e) => e.scrollWidth > e.clientWidth + 2 || e.scrollHeight > e.clientHeight + 2),
      ...window.__componentsAudit,
    }));
    assert.equal(layout.overflow, false);
    assert.equal(layout.clippedButtons, false);
    await page.screenshot({ path: `${directory}${d.theme}-${d.width}.png`, fullPage: true });
    await page
      .locator('[data-component=CanvasState]')
      .screenshot({ path: `${directory}canvas-${d.theme}-${d.width}.png` });
    report.views.push({ ...d, ...layout });
    await context.close();
  }
  assert.deepEqual(report.consoleErrorsAndWarnings, []);
  writeFileSync(`${directory}browser.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(
    'Components: 19 samples, 6 shared states, 3 viewport/DPR views, actions/card/retry/dialog/pagination passed; no console errors/warnings',
  );
} finally {
  await browser.close();
  await server.close();
}
