import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, preview } from 'vite';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../', import.meta.url)),
  directory = path.join(root, 'docs/productization/reports/asset-cache');
mkdirSync(directory, { recursive: true });
const server = await createServer({
  configFile: path.join(root, 'client/vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, open: false },
});
await server.listen();
const browser = await chromium.launch(),
  base = server.resolvedUrls.local[0],
  report = {
    cache: null,
    corruption: null,
    offline: null,
    versionUpdate: null,
    cancellation: null,
    diskBound: null,
    lowResolution: null,
    fallbackPlayable: false,
    legacyLineup: null,
    release: null,
    pageErrors: [],
  };
try {
  const context = await browser.newContext(),
    page = await context.newPage();
  page.on('pageerror', (e) => report.pageErrors.push(e.message));
  await page.goto(`${base}?legacy=1`);
  await page.evaluate(async () => {
    const lib = await import('/src/assets.ts'),
      catalog = await (await fetch('/assets/catalog.json')).json();
    const create = () =>
      new lib.AssetManager(catalog, {
        fetchBytes: lib.fetchAssetBytes,
        digest: lib.assetDigest,
        persistent: new lib.BrowserByteCache(),
      });
    window.__assetHarness = { lib, catalog, create };
  });
  report.cache = await page.evaluate(async () => {
    const h = window.__assetHarness,
      manager = h.create(),
      scene = new h.lib.WebAssetScene(Promise.resolve(manager)),
      image = scene.bind('player.p01.portrait');
    await scene.wait(image);
    const result = { ...scene.stats(), width: image.naturalWidth };
    scene.dispose();
    return result;
  });
  assert.ok(report.cache.width > 0);
  assert.equal(report.cache.cache.networkRequests, 1);
  await page.evaluate(async () => {
    const h = window.__assetHarness,
      entry = h.catalog.assets.find(
        (a) => a.id === h.catalog.aliases.find((a) => a.id === 'player.p01.portrait').target,
      ),
      cache = await caches.open(h.lib.ASSET_CACHE_NAME),
      request = (await cache.keys()).find((k) => k.url.endsWith(entry.sha256));
    await cache.put(request, new Response('corrupt', { headers: { 'x-pz-bytes': '7' } }));
  });
  report.corruption = await page.evaluate(async () => {
    const h = window.__assetHarness,
      manager = h.create(),
      scene = new h.lib.WebAssetScene(Promise.resolve(manager)),
      image = scene.bind('player.p01.portrait');
    await scene.wait(image);
    scene.dispose();
    return manager.stats();
  });
  assert.equal(report.corruption.corruptCache, 1);
  assert.equal(report.corruption.networkRequests, 1);
  await context.setOffline(true);
  report.offline = await page.evaluate(async () => {
    const h = window.__assetHarness,
      manager = h.create(),
      scene = new h.lib.WebAssetScene(Promise.resolve(manager)),
      image = scene.bind('player.p01.portrait');
    await scene.wait(image);
    const result = { width: image.naturalWidth, ...manager.stats() };
    scene.dispose();
    return result;
  });
  assert.ok(report.offline.width > 0);
  assert.equal(report.offline.networkRequests, 0);
  await context.setOffline(false);
  const source = JSON.parse(readFileSync(path.join(root, 'client/public/assets/catalog.json'), 'utf8')),
    face = source.assets.find((a) => a.id === source.aliases.find((a) => a.id === 'player.p01.portrait').target),
    replacement = source.assets.find((a) => a.id === source.aliases.find((a) => a.id === 'player.p02.portrait').target);
  await page.route(`**${face.path}`, (r) =>
    r.fulfill({
      status: 200,
      body: readFileSync(path.join(root, 'client/public', replacement.path)),
      contentType: 'image/png',
    }),
  );
  report.versionUpdate = await page.evaluate(
    async ({ face, replacement }) => {
      const h = window.__assetHarness,
        catalog = structuredClone(h.catalog),
        entry = catalog.assets.find((a) => a.id === face.id);
      Object.assign(entry, {
        sha256: replacement.sha256,
        bytes: replacement.bytes,
        width: replacement.width,
        height: replacement.height,
      });
      catalog.version = 'assets-browser-version-two';
      const manager = new h.lib.AssetManager(catalog, {
          fetchBytes: h.lib.fetchAssetBytes,
          digest: h.lib.assetDigest,
          persistent: new h.lib.BrowserByteCache(),
        }),
        scene = new h.lib.WebAssetScene(Promise.resolve(manager)),
        image = scene.bind(face.id);
      await scene.wait(image);
      scene.dispose();
      return manager.stats();
    },
    { face, replacement },
  );
  assert.equal(report.versionUpdate.networkRequests, 1);
  await page.unroute(`**${face.path}`);
  const delayed = source.assets.find((a) => a.id === source.aliases.find((a) => a.id === 'player.p03.portrait').target);
  let begin;
  const started = new Promise((resolve) => {
    begin = resolve;
  });
  let pendingRoute;
  await page.route(`**${delayed.path}`, async (r) => {
    pendingRoute = r;
    begin();
  });
  await page.evaluate((id) => {
    const h = window.__assetHarness,
      manager = new h.lib.AssetManager(h.catalog, { fetchBytes: h.lib.fetchAssetBytes, digest: h.lib.assetDigest }),
      scene = new h.lib.WebAssetScene(Promise.resolve(manager)),
      image = scene.bind(id);
    window.__cancelAsset = {
      scene,
      result: scene.wait(image).then(
        () => null,
        (e) => e.name,
      ),
    };
  }, delayed.id);
  await started;
  report.cancellation = await page.evaluate(async () => {
    const { scene, result } = window.__cancelAsset;
    scene.dispose();
    return { name: await result, ...scene.stats() };
  });
  assert.equal(report.cancellation.name, 'AbortError');
  assert.equal(report.cancellation.images, 0);
  assert.equal(report.cancellation.decodedBytes, 0);
  await pendingRoute.abort().catch(() => undefined);
  await page.unroute(`**${delayed.path}`);
  report.diskBound = await page.evaluate(async () => {
    const h = window.__assetHarness,
      small = new h.lib.BrowserByteCache(6);
    await small.put('test-bound-a', new Uint8Array(4));
    await small.put('test-bound-b', new Uint8Array(4));
    const cache = await caches.open(h.lib.ASSET_CACHE_NAME),
      keys = await cache.keys();
    let bytes = 0;
    for (const k of keys) bytes += Number((await cache.match(k)).headers.get('x-pz-bytes'));
    return { bytes, limit: 6 };
  });
  assert.ok(report.diskBound.bytes <= 6);
  report.lowResolution = await page.evaluate(async () => {
    const h = window.__assetHarness,
      scene = new h.lib.WebAssetScene(Promise.resolve(h.create())),
      image = scene.bind('field.scene_01.scene', new Image(), 'low');
    await scene.wait(image);
    const result = { width: image.naturalWidth, height: image.naturalHeight, ...scene.stats() };
    scene.dispose();
    return result;
  });
  assert.equal(Math.max(report.lowResolution.width, report.lowResolution.height), 768);
  assert.equal(report.lowResolution.lowVariants, 1);
  await context.close();
  const builtPreview = await preview({
    configFile: path.join(root, 'client/vite.config.ts'),
    preview: { host: '127.0.0.1', port: 0, open: false },
  });
  try {
    const lineupContext = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
      lineup = await lineupContext.newPage(),
      failures = [];
    lineup.on('pageerror', (e) => report.pageErrors.push(e.message));
    lineup.on('console', (m) => {
      if (['error', 'warning'].includes(m.type())) failures.push(m.text());
    });
    await lineup.goto(`${builtPreview.resolvedUrls.local[0]}?legacy=1`);
    await lineup.locator('[data-tab=lineup]').click();
    const cards = JSON.parse(readFileSync(path.join(root, 'data/player_catalog.json'), 'utf8')).entries;
    assert.equal(await lineup.locator('.lu-grid [data-card]').count(), cards.length);
    let imagesVerified = 0;
    for (const card of cards) {
      await lineup.locator(`.lu-grid [data-card="${card.id}"]`).click();
      await lineup.locator('.pd-win').waitFor();
      const count = await lineup.locator('.pd-win img').evaluateAll(async (images) => {
        await Promise.all(images.map((i) => i.decode()));
        return images.filter((i) => i.naturalWidth > 0).length;
      });
      imagesVerified += count;
      await lineup.locator('.pd-close').click();
    }
    assert.deepEqual(failures, []);
    report.legacyLineup = { cards: cards.length, imagesVerified, consoleErrorsAndWarnings: failures };
    await lineupContext.close();
  } finally {
    await new Promise((resolve) => builtPreview.httpServer.close(resolve));
  }
  const fallback = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    game = await fallback.newPage();
  game.on('pageerror', (e) => report.pageErrors.push(e.message));
  await game.route(/\/assets\/(?:players(?:_original)?|fields)\//, (r) => r.abort());
  await game.goto(`${base}?legacy=1`);
  await game.fill('.nick', 'asset-fallback');
  await game.click('.btn-play');
  await game.uncheck('.timer');
  await game.click('[data-bot=easy]');
  await game.waitForFunction(() => window.__pz?.canAim());
  const drag = await game.evaluate(() => {
    const st = window.__pz.state(),
      piece = st.pieces.find((p) => p.side === st.turn && p.out === 0 && p.frozen === 0);
    return {
      before: st.shotNo,
      from: window.__pz.screenOf(piece.x, piece.y),
      to: window.__pz.screenOf(piece.x, piece.y + 0.9),
    };
  });
  await game.mouse.move(drag.from.x, drag.from.y);
  await game.mouse.down();
  await game.mouse.move(drag.to.x, drag.to.y, { steps: 8 });
  await game.mouse.up();
  await game.waitForFunction((before) => window.__pz.state().shotNo > before, drag.before, { timeout: 15000 });
  report.fallbackPlayable = true;
  await game.screenshot({ path: path.join(directory, 'fallback-game.png') });
  await fallback.close();
  const built = JSON.parse(readFileSync(path.join(root, 'dist/client/asset-package-report.json'), 'utf8'));
  assert.equal(
    built.applicationBytes,
    built.applicationFiles.reduce((sum, file) => sum + readFileSync(path.join(root, 'dist/client', file)).length, 0),
  );
  assert.ok(built.applicationFiles.every((file) => /\.(js|css)$/.test(file)));
  assert.equal(existsSync(path.join(root, 'dist/client/art')), false);
  for (const item of built.removed)
    if (item.path) assert.equal(existsSync(path.join(root, 'dist/client', item.path)), false, item.path);
  report.release = {
    version: built.version,
    applicationBytes: built.applicationBytes,
    publicBytes: built.totalBytes,
    removed: built.removed.length,
    removedBytes: built.removedBytes,
    groups: built.packages.map((p) => ({ id: p.id, bytes: p.bytes, decodedRgbaBytes: p.decodedRgbaBytes })),
  };
  assert.deepEqual(report.pageErrors, []);
  writeFileSync(path.join(directory, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    'Asset browser: verified persistent cache/corruption/offline/version/cancellation/bounds/low texture; failed images still allow a real game shot; filtered build has no removed files',
  );
} finally {
  await browser.close();
  await server.close();
}
