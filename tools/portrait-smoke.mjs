/**
 * AR-3 portrait smoke. Serves dist/client, opens a real browser, and checks:
 *   - the lobby has no Q版 switch
 *   - every on-pitch disc loads the mapped original, or the kept file for an unmapped player
 *   - all 106 original files decode at 256×256
 *
 *   node tools/portrait-smoke.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT = process.cwd();
const PORT = Number(process.env.PORTRAIT_PORT || 4291);
const DIST = path.join(ROOT, 'dist', 'client');
const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'portrait_map.json'), 'utf8'));
const byId = new Map(map.entries.map((e) => [e.id, e.portraitId]));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function serve() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent((req.url || '/').split('?')[0]);
      let file = path.join(DIST, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(DIST)) {
        res.writeHead(403).end();
        return;
      }
      if (!fs.existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.on('error', reject);
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

function classify(rows) {
  const bad = [];
  for (const row of rows) {
    const portraitId = byId.get(row.playerId);
    const src = row.src || '';
    if (portraitId) {
      if (!src.includes(`/assets/players_original/${portraitId}.png`)) bad.push(`${row.playerId} expected original ${portraitId} got ${src}`);
    } else if (!src.includes(`/assets/players/${row.playerId}_avatar.png`) || src.includes('players_original')) {
      bad.push(`${row.playerId} expected kept avatar got ${src}`);
    }
  }
  return bad;
}

async function waitFaces(page) {
  await page.waitForFunction(() => {
    const st = window.__pz?.state?.();
    const rows = window.__pz?.portraits?.() || [];
    if (!st || rows.length < st.pieces.length) return false;
    const ids = new Set(st.pieces.map((p) => p.playerId));
    return [...ids].every((id) => rows.some((r) => r.playerId === id && r.complete));
  }, null, { timeout: 20000 });
  return page.evaluate(() => window.__pz.portraits());
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('FAIL dist/client missing — run npm run build first');
    return 1;
  }
  const errors = [];
  const srv = await serve();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.btn-play');
    await page.click('.btn-play');
    const ui = await page.evaluate(async () => {
      const logo = document.querySelector('.logo img');
      const loaded = logo ? await new Promise((ok) => {
        if (logo.complete && logo.naturalWidth > 0) ok(logo.naturalWidth);
        else { logo.onload = () => ok(logo.naturalWidth); logo.onerror = () => ok(0); }
      }) : 0;
      const css = getComputedStyle(document.querySelector('[data-bot="normal"]'));
      const btn = `${css.borderImageSource} ${css.backgroundImage}`;
      const panel = getComputedStyle(document.querySelector('.group')).borderImageSource || '';
      return { logo: loaded, btn, panel };
    });
    if (!ui.logo) {
      console.error('FAIL logo');
      return 1;
    }
    if (!String(ui.btn).includes('Btn_02')) {
      console.error('FAIL primary button skin', ui.btn);
      return 1;
    }
    if (await page.$('.portrait')) {
      console.error('FAIL Q版 switch is still in the lobby');
      return 1;
    }
    const timer = await page.$('.timer');
    if (timer) await page.uncheck('.timer');
    await page.click('[data-bot="easy"]');
    await page.waitForSelector('canvas', { timeout: 20000 });

    const originalRows = await waitFaces(page);
    const originalBad = classify(originalRows);
    const pieceIds = await page.evaluate(() => window.__pz.state().pieces.map((p) => p.playerId));
    const originalOnPitch = pieceIds.filter((id) => byId.has(id)).length;
    const fallbackOnPitch = pieceIds.length - originalOnPitch;

    const loaded = await page.evaluate(async (entries) => {
      const load = (src) => new Promise((res) => {
        const i = new Image();
        i.onload = () => res({ src, w: i.naturalWidth, h: i.naturalHeight, ok: true });
        i.onerror = () => res({ src, w: 0, h: 0, ok: false });
        i.src = src;
      });
      return Promise.all(entries.map((e) => load(`/assets/players_original/${e.portraitId}.png`)));
    }, map.entries);
    const badFiles = loaded.filter((r) => !r.ok || r.w !== 256 || r.h !== 256);

    await page.click('.menu-btn');
    await page.selectOption('.skin', 'scene_01');
    await page.click('.menu .close');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => {
      const imgs = performance.getEntriesByType('resource');
      return imgs.some((e) => e.name.includes('spring_corner.png'));
    }, null, { timeout: 8000 });
    const corner = await page.evaluate(() => {
      const sample = (x, y) => {
        const s = window.__pz.screenOf(x, y);
        const c = document.querySelector('.stage canvas');
        const rect = c.getBoundingClientRect();
        const dpr = c.width / rect.width;
        const px = Math.round((s.x - rect.left) * dpr);
        const py = Math.round((s.y - rect.top) * dpr);
        const d = c.getContext('2d').getImageData(px, py, 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      // Inside the top-left chamfer (0.5 m). The old spring pad was orange #ff9f1a.
      // Goal: stone just outside the post, and the mouth center, which must not be a solid white net.
      return {
        corner: sample(-2.82, -4.72),
        grass: sample(0, 0),
        jamb: sample(1.4, -5.05),
        mouth: sample(0, -5.1),
      };
    });

    const summary = {
      pieces: pieceIds.length,
      originalOnPitch,
      fallbackOnPitch,
      files: loaded.length,
      badFiles: badFiles.length,
      originalBad: originalBad.length,
      corner: corner.corner,
      grass: corner.grass,
      jamb: corner.jamb,
      mouth: corner.mouth,
      consoleErrors: errors.length,
    };
    console.log(JSON.stringify(summary));
    const problems = [];
    if (pieceIds.length !== 10) problems.push(`pieces ${pieceIds.length}`);
    // Lineups now come from the original-only card pool (p06–p16 are not selectable), so every piece is an original.
    if (originalOnPitch !== pieceIds.length || fallbackOnPitch !== 0) problems.push(`non-original players on pitch: ${fallbackOnPitch}`);
    if (badFiles.length) problems.push(`bad files ${badFiles.slice(0, 3).map((r) => r.src).join(',')}`);
    if (originalBad.length) problems.push(originalBad.slice(0, 3).join('; '));
    const [cr, cg, cb] = corner.corner;
    if (cr > 220 && cg > 120 && cg < 210 && cb < 80) problems.push(`corner still orange ${cr},${cg},${cb}`);
    if (cb < 90 && cr > 200) problems.push(`corner is the old yellow wall ${cr},${cg},${cb}`);
    const [jr, jg, jb] = corner.jamb;
    // The jamb is the scene photo's own wall now: light, near-neutral stone (not grass, hedge or an orange pad).
    if (Math.min(jr, jg, jb) < 170 || Math.max(jr, jg, jb) - Math.min(jr, jg, jb) > 25) problems.push(`goal jamb is not stone ${jr},${jg},${jb}`);
    const [mr, mg, mb] = corner.mouth;
    if (mr > 220 && mg > 220 && mb > 220) problems.push(`goal mouth net is still solid white ${mr},${mg},${mb}`);
    if (errors.length) problems.push(errors.slice(0, 2).join(' | ').slice(0, 300));
    if (problems.length) {
      console.error('FAIL', problems.join(' || '));
      return 1;
    }
    console.log('PASS');
    return 0;
  } finally {
    await browser.close();
    srv.close();
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(err);
  process.exit(1);
});
