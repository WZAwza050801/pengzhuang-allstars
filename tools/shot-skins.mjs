/**
 * Screenshot every pitch skin so the art can be checked by eye.
 *
 *   node tools/shot-skins.mjs
 *
 * Writes runs/_diag/skin_<id>.png. The art skins ("scene_xx") draw the original
 * pitch texture; the others draw the procedural grass. This is a visual aid, not
 * a test: it asserts nothing beyond the screenshots being written.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const DIST = join(ROOT, 'dist/client');
const OUT = join(ROOT, 'runs/_diag');
const PORT = 4177;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = join(DIST, normalize(url === '/' ? '/index.html' : url));
  if (!existsSync(file)) file = join(DIST, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// SHOT_ONLY=id1,id2 limits the run to those skins.
const only = process.env.SHOT_ONLY ? process.env.SHOT_ONLY.split(',') : null;
const skins = JSON.parse(await readFile(join(ROOT, 'data/fields.json'), 'utf-8')).skins.filter((s) => !only || only.includes(s.id));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
// SHOT_W / SHOT_H / SHOT_TAG pick a phone-sized viewport, e.g. SHOT_W=414 SHOT_H=860 SHOT_TAG=phone.
const viewport = { width: Number(process.env.SHOT_W) || 900, height: Number(process.env.SHOT_H) || 1200 };
const tag = process.env.SHOT_TAG ? `_${process.env.SHOT_TAG}` : '';
const page = await browser.newPage({ viewport, deviceScaleFactor: Number(process.env.SHOT_DPR) || 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

for (const skin of skins) {
  await page.addInitScript((id) => localStorage.setItem('pz_skin', id), skin.id);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  // Enter the local game the same way tools/e2e-browser.mjs does, then wait for
  // the art texture to decode.
  await page.fill('.nick', 'SHOT');
  await page.dispatchEvent('.nick', 'change');
  await page.click('.btn-play');
  const timer = await page.$('.timer');
  if (timer) await page.uncheck('.timer');
  await page.click('[data-bot="easy"]');
  await page.waitForSelector('.stage canvas', { timeout: 20000 });
  await page.waitForTimeout(Number(process.env.SHOT_WAIT) || 900);
  const out = join(OUT, `skin_${skin.id}${tag}.png`);
  await page.screenshot({ path: out });
  console.log(`${skin.id}\t${skin.name}\t${skin.art ? 'art' : 'procedural'}\t${out}`);
}

await browser.close();
server.close();
console.log(errors.length ? `page errors: ${errors.length}` : 'page errors: 0');
