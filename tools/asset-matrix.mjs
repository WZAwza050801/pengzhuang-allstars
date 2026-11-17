import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import { createServer, build, preview } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url)),
  smoke = process.argv.includes('--smoke'),
  directory = path.join(root, smoke ? 'work/asset-matrix-smoke' : 'docs/productization/reports/asset-matrix');
mkdirSync(directory, { recursive: true });
const server = await createServer({
  configFile: path.join(root, 'client/vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, open: false, allowedHosts: ['asset-check.test'] },
  logLevel: 'error',
});
await server.listen();
const base = server.resolvedUrls.local[0],
  geometry = JSON.parse(readFileSync(path.join(root, 'data/fields.json'), 'utf8')).geometry;
const viewports = smoke
    ? [[390, 844]]
    : [
        [320, 568],
        [360, 800],
        [390, 844],
        [430, 932],
        [768, 1024],
        [1280, 720],
        [1440, 900],
        [1920, 1080],
      ],
  dprs = smoke ? [2] : [1, 2, 3];
const report = {
  scope: 'Desktop Playwright engines and emulated viewports; no physical-device evidence',
  engines: [],
  views: [],
  geometry: [],
  rosters: [],
  components: [],
  insecureHttp: null,
  errors: [],
  warnings: [],
};
const observe = (page, stage) => {
  page.on('pageerror', (e) => report.errors.push({ stage, message: e.message }));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push({ stage, message: m.text() });
    else if (m.type() === 'warning') report.warnings.push({ stage, message: m.text() });
  });
};
try {
  for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await type.launch();
    try {
      report.engines.push({ name, version: browser.version() });
      for (const [width, height] of viewports)
        for (const dpr of dprs) {
          const context = await browser.newContext({
              viewport: { width, height },
              deviceScaleFactor: dpr,
              hasTouch: width <= 430,
            }),
            page = await context.newPage();
          observe(page, `${name}/${width}/${dpr}`);
          await page.goto(base);
          await page.fill('.nick', 'resource-matrix');
          await page.click('.btn-play');
          await page.uncheck('.timer');
          await page.click('[data-bot=easy]');
          await page.waitForFunction(() => window.__pz?.canAim());
          for (const quality of ['low', 'high']) {
            await page.click('.menu-btn');
            await page.selectOption('.quality', quality);
            await page.click('.menu .close');
            await page.waitForFunction(
              (q) => {
                const r = window.__pz.resources(),
                  p = window.__pz.portraits();
                return (
                  r.quality === q &&
                  r.assets.pending === 0 &&
                  r.assets.cache?.inFlight === 0 &&
                  p.length > 0 &&
                  p.every((i) => i.complete)
                );
              },
              quality,
              { timeout: 20000 },
            );
            const result = await page.evaluate((g) => {
              const resources = window.__pz.resources(),
                canvas = document.querySelector('.game canvas'),
                rect = canvas.getBoundingClientRect();
              const points = [
                [-g.width / 2, 0],
                [g.width / 2, 0],
                [0, -g.length / 2],
                [0, g.length / 2],
              ].map(([x, y]) => window.__pz.screenOf(x, y));
              return {
                resources,
                canvas: { width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height },
                landmarksVisible: points.every(
                  (p) =>
                    p.x >= rect.left - 0.5 &&
                    p.x <= rect.right + 0.5 &&
                    p.y >= rect.top - 0.5 &&
                    p.y <= rect.bottom + 0.5,
                ),
                overflow: document.documentElement.scrollWidth > innerWidth,
              };
            }, geometry);
            assert.equal(result.resources.assets.failures, 0);
            assert.equal(result.landmarksVisible, true);
            assert.equal(result.overflow, false);
            assert.ok(result.resources.assets.decodedBytes <= result.resources.assets.decodedLimit);
            assert.ok(result.resources.assets.cache.memoryBytes <= result.resources.assets.cache.memoryLimit);
            if (quality === 'low') assert.ok(result.resources.assets.lowVariants >= 2);
            report.views.push({ engine: name, width, height, dpr, quality, ...result });
            if (
              (width === 390 && dpr === 2 && quality === 'low') ||
              (width === 1440 && dpr === 1 && quality === 'high')
            )
              await page.screenshot({ path: path.join(directory, `${name}-${width}-${quality}.png`) });
          }
          const pair = report.views.slice(-2);
          assert.ok(pair[0].resources.backingPixels <= pair[1].resources.backingPixels);
          assert.ok(pair[0].resources.assets.decodedBytes < pair[1].resources.assets.decodedBytes);
          await context.close();
        }
      const audit = await browser.newContext({ viewport: { width: 840, height: 900 }, deviceScaleFactor: 3 }),
        field = await audit.newPage();
      observe(field, `${name}/geometry`);
      await field.goto(new URL('field-debug.html?skin=scene_01&side=1&width=260&height=420', base).href);
      await field.waitForFunction(() => window.__fieldCalibration?.ready);
      for (const quality of ['low', 'high']) {
        const rows = await field.evaluate((q) => window.__fieldCalibration.matrixAudit(q), quality);
        assert.equal(rows.length, 72);
        assert.ok(rows.every((r) => r.error < 1e-9));
        report.geometry.push({ engine: name, quality, rows });
      }
      await field
        .locator('#grid canvas')
        .first()
        .screenshot({ path: path.join(directory, `${name}-field-side-1.png`) });
      await audit.close();
      const catalogContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }),
        cards = await catalogContext.newPage();
      observe(cards, `${name}/roster`);
      await cards.goto(new URL('card-debug.html', base).href);
      await cards.waitForFunction(() => window.__cardAudit?.drawn === 117);
      const roster = await cards.evaluate(async () => {
        const { WebAssetScene } = await import('/src/assets.ts'),
          resources = new WebAssetScene(),
          catalog = await (await fetch('/assets/catalog.json')).json();
        let loaded = 0;
        try {
          for (const alias of catalog.aliases.filter((a) => a.usage === 'portrait')) {
            const image = resources.bind(alias.id);
            await resources.wait(image);
            if (!image.naturalWidth || image.naturalWidth !== image.naturalHeight)
              throw new Error('Portrait is not square');
            loaded++;
            resources.release(image);
          }
          return { ...window.__cardAudit, legacyDecoded: loaded };
        } finally {
          resources.dispose();
        }
      });
      assert.equal(roster.legacyDecoded, 117);
      report.rosters.push({ engine: name, ...roster });
      await cards.screenshot({ path: path.join(directory, `${name}-cards.png`), fullPage: true });
      await catalogContext.close();
      const componentContext = await browser.newContext({
          viewport: { width: 320, height: 568 },
          deviceScaleFactor: 2,
        }),
        components = await componentContext.newPage();
      observe(components, `${name}/components`);
      await components.goto(new URL('components-debug.html', base).href);
      await components.waitForFunction(() => window.__componentsAudit?.components === 19);
      await components.selectOption('[name=font]', '2');
      await components.selectOption('[name=theme]', 'dark');
      const opener = components.getByRole('button', { name: '打开确认框', exact: true });
      await opener.click();
      await components.getByRole('button', { name: '取消', exact: true }).click();
      await components.waitForFunction(() => document.activeElement?.textContent === '打开确认框');
      const component = await components.evaluate(() => ({
        components: window.__componentsAudit.components,
        overflow: document.documentElement.scrollWidth > innerWidth,
        openerFocused: document.activeElement?.textContent === '打开确认框',
      }));
      assert.equal(component.overflow, false);
      assert.equal(component.openerFocused, true);
      report.components.push({ engine: name, ...component });
      await componentContext.close();
      if (name === 'chromium') {
        const outDir = path.join(root, 'work/asset-matrix-client');
        await build({
          configFile: path.join(root, 'client/vite.config.ts'),
          mode: 'test',
          logLevel: 'error',
          build: { outDir, rollupOptions: { input: path.join(root, 'client/card-debug.html') } },
        });
        const staticServer = await preview({
          configFile: path.join(root, 'client/vite.config.ts'),
          build: { outDir },
          preview: { host: '127.0.0.1', port: 0, open: false },
          logLevel: 'error',
        });
        try {
          const context = await browser.newContext(),
            http = await context.newPage();
          await http.route('**/*', async (route) => {
            const target = new URL(route.request().url());
            if (target.hostname !== 'asset-check.test') {
              await route.continue();
              return;
            }
            const local = new URL(target.pathname + target.search, staticServer.resolvedUrls.local[0]);
            const response = await fetch(local.href);
            await route.fulfill({
              status: response.status,
              headers: { 'content-type': response.headers.get('content-type') ?? 'application/octet-stream' },
              body: Buffer.from(await response.arrayBuffer()),
            });
          });
          observe(http, 'insecure-http');
          const address = new URL('card-debug.html?limit=6', staticServer.resolvedUrls.local[0]);
          address.hostname = 'asset-check.test';
          await http.goto(address.href);
          await http.waitForFunction(() => window.__cardAudit?.drawn === 6);
          report.insecureHttp = await http.evaluate(() => ({
            secureContext: isSecureContext,
            nativeDigestAvailable: !!globalThis.crypto?.subtle,
            transport: 'Static test build forwarded locally to a non-localhost HTTP origin; browser APIs unmodified',
            ...window.__cardAudit,
          }));
          assert.equal(report.insecureHttp.secureContext, false);
          assert.equal(report.insecureHttp.nativeDigestAvailable, false);
          await context.close();
        } finally {
          await new Promise((resolve) => staticServer.httpServer.close(resolve));
        }
      }
      console.log(
        `Asset matrix ${name}: ${viewports.length * dprs.length} viewports/DPR, both texture qualities, 144 geometry rows, 117 portraits and component smoke passed`,
      );
    } finally {
      await browser.close();
    }
  }
  assert.deepEqual(report.errors, []);
  writeFileSync(path.join(directory, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    `Asset matrix finished: ${report.views.length} game views, ${report.geometry.reduce((sum, g) => sum + g.rows.length, 0)} geometry rows, ${report.warnings.length} warnings`,
  );
} catch (error) {
  writeFileSync(
    path.join(root, 'work/asset-matrix-failure.json'),
    JSON.stringify({ message: error.message, ...report }, null, 2) + '\n',
  );
  throw error;
} finally {
  await server.close();
}
