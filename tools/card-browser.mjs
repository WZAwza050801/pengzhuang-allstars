import { createServer } from 'vite';
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'docs/productization/reports/card-atlas');
const manifest = JSON.parse(readFileSync(path.join(root, 'client/public/assets/cards/atlas.json'), 'utf8'));
const players = JSON.parse(readFileSync(path.join(root, 'data/players.json'), 'utf8')).players;
const originals = JSON.parse(readFileSync(path.join(root, 'data/portrait_map.json'), 'utf8')).entries;
const errors = [],
  views = [];
const server = await createServer({
  configFile: path.join(root, 'client/vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: true },
  logLevel: 'error',
});
let browser;
let gutterChecks = 0,
  legacyLoaded = 0;
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No preview port');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
  mkdirSync(out, { recursive: true });
  for (const [width, height, dpr, limit] of [
    [1440, 900, 1, 117],
    [390, 844, 2, 6],
    [320, 568, 3, 6],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
    try {
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
      });
      await page.goto(`${origin}/card-debug.html?limit=${limit}`);
      await page.waitForFunction(() => window.__cardAudit);
      const audit = await page.evaluate(() => window.__cardAudit);
      assert.equal(audit.portraits, 117);
      assert.equal(audit.frames, 15);
      assert.equal(audit.pages, 3);
      assert.equal(audit.drawn, limit);
      assert.equal(audit.dpr, dpr);
      assert.equal(await page.locator('.frame-grid canvas').count(), 15);
      const identities = await page
        .locator('.player-sample')
        .evaluateAll((nodes) => nodes.map((n) => n.dataset.player));
      assert.deepEqual(
        identities,
        manifest.portraits.slice(0, limit).map((p) => p.playerId),
      );
      assert.ok(
        await page
          .locator('.player-sample canvas')
          .first()
          .evaluate((canvas) => Math.abs(canvas.width / canvas.height - 5 / 7) < 1e-8),
      );
      if (dpr === 1) {
        await page.screenshot({ path: path.join(out, 'contact-sheet.png'), fullPage: true });
        const legacy = players.map((p) => {
          const portrait = originals.find((e) => e.id === p.id);
          return {
            id: p.id,
            url: portrait
              ? `/assets/players_original/${portrait.portraitId}.png`
              : `/assets/players/${p.id}_avatar.png`,
          };
        });
        const dimensions = await page.evaluate(
          async (entries) =>
            Promise.all(
              entries.map(async (entry) => {
                const image = new Image();
                image.src = entry.url;
                await image.decode();
                return { id: entry.id, width: image.naturalWidth, height: image.naturalHeight };
              }),
            ),
          legacy,
        );
        assert.equal(dimensions.length, 117);
        assert.ok(dimensions.every((p) => p.width > 0 && p.width === p.height));
        legacyLoaded = dimensions.length;
        gutterChecks = await page.evaluate(async (atlas) => {
          let checks = 0;
          for (const definition of atlas.pages) {
            const image = new Image();
            image.src = definition.path;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = definition.width;
            canvas.height = definition.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(image, 0, 0);
            const equal = (a, b) =>
              Array.from(ctx.getImageData(...a, 1, 1).data).every(
                (value, index) => value === ctx.getImageData(...b, 1, 1).data[index],
              );
            for (const region of [...atlas.portraits, ...atlas.frames].filter((r) => r.pageId === definition.id)) {
              const { x, y, width: w, height: h } = region,
                mx = x + Math.floor(w / 2),
                my = y + Math.floor(h / 2);
              for (const [inside, outside] of [
                [
                  [x, my],
                  [x - 1, my],
                ],
                [
                  [x + w - 1, my],
                  [x + w, my],
                ],
                [
                  [mx, y],
                  [mx, y - 1],
                ],
                [
                  [mx, y + h - 1],
                  [mx, y + h],
                ],
              ]) {
                if (!equal(inside, outside)) throw new Error('Atlas gutter does not extrude the owning edge');
                checks++;
              }
            }
          }
          return checks;
        }, manifest);
        const first = page.locator('.player-sample').first();
        await first.click();
        assert.equal(await first.getAttribute('aria-pressed'), 'true');
        await first.focus();
        assert.ok(await first.evaluate((button) => document.activeElement === button));
        await page.selectOption('[name=quality]', 'blue');
        assert.equal(
          await page.locator('.player-sample').count(),
          manifest.portraits.filter((p) => p.quality === 'blue').length,
        );
        await page.selectOption('[name=state]', 'disabled');
        assert.equal(await page.locator('.player-sample:enabled').count(), 0);
      } else {
        await page.locator('.card-controls').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, `dpr-${dpr}.png`) });
      }
      views.push({ width, height, dpr, drawn: limit, pages: audit.pages, frames: audit.frames });
    } finally {
      await context.close();
    }
  }
  const brokenContext = await browser.newContext();
  try {
    const page = await brokenContext.newPage();
    await page.route('**/assets/cards/portraits-0.png', (route) => route.abort());
    await page.goto(`${origin}/card-debug.html?limit=6`);
    await page.getByRole('status').filter({ hasText: '加载失败' }).waitFor();
    await page.unroute('**/assets/cards/portraits-0.png');
    await page.getByRole('button', { name: '重试' }).click();
    await page.waitForFunction(() => window.__cardAudit?.drawn === 6);
  } finally {
    await brokenContext.close();
  }
  assert.deepEqual(errors, []);
  const report = {
    atlasVersion: manifest.version,
    views,
    legacyLoaded,
    gutterChecks,
    retryAfterFailure: true,
    consoleErrorsAndWarnings: errors,
  };
  writeFileSync(path.join(out, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await server.close();
}
