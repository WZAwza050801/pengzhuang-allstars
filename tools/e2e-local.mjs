// Plays local matches through the real UI in Chromium. Usage: node tools/e2e-local.mjs [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = 'docs/screens';
fs.mkdirSync(OUT, { recursive: true });
const errors = [];

async function waitAim(page, timeout = 60000) {
  await page.waitForFunction(() => window.__pz && (window.__pz.canAim() || window.__pz.state()?.over), null, { timeout, polling: 100 });
  return page.evaluate(() => window.__pz.state().over);
}

/** Pick the own piece closest to the ball and pull straight back from the ball direction. */
async function plan(page, pullFrac = 0.8, curve = 0) {
  return page.evaluate(([pullFrac]) => {
    const st = window.__pz.state();
    const side = st.turn;
    const mine = st.pieces.filter((p) => p.side === side && p.out === 0 && p.frozen === 0);
    mine.sort((a, b) => Math.hypot(a.x - st.ball.x, a.y - st.ball.y) - Math.hypot(b.x - st.ball.x, b.y - st.ball.y));
    const p = mine[0];
    const d = Math.hypot(st.ball.x - p.x, st.ball.y - p.y);
    const ux = (st.ball.x - p.x) / d, uy = (st.ball.y - p.y) / d;
    const pull = 0.32 * 0.6 + 2.4 * pullFrac;
    const a = window.__pz.screenOf(p.x, p.y);
    const b = window.__pz.screenOf(p.x - ux * pull, p.y - uy * pull);
    return { from: a, to: b, id: p.id };
  }, [pullFrac, curve]);
}

async function mouseShot(page, pullFrac, shotName) {
  const pl = await plan(page, pullFrac);
  await page.mouse.move(pl.from.x, pl.from.y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) await page.mouse.move(pl.from.x + ((pl.to.x - pl.from.x) * i) / steps, pl.from.y + ((pl.to.y - pl.from.y) * i) / steps);
  if (shotName) await page.screenshot({ path: `${OUT}/${shotName}.png` });
  await page.mouse.up();
}

async function touchShot(page, client, pullFrac) {
  const pl = await plan(page, pullFrac);
  const pt = (p) => [{ x: p.x, y: p.y, id: 1 }];
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(pl.from) });
  for (let i = 1; i <= 8; i++) {
    const p = { x: pl.from.x + ((pl.to.x - pl.from.x) * i) / 8, y: pl.from.y + ((pl.to.y - pl.from.y) * i) / 8 };
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(p) });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function startBot(page, level) {
  await page.goto(BASE);
  await page.fill('.nick', '测试员');
  await page.dispatchEvent('.nick', 'change');
  await page.click('.btn-play');
  await page.uncheck('.timer');
  await page.click(`[data-bot="${level}"]`);
  await page.waitForFunction(() => window.__pz && window.__pz.state(), null, { timeout: 10000 });
}

const browser = await chromium.launch();
const results = [];

// 1) desktop: full match vs normal bot
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push('desktop: ' + m.text()));
  page.on('pageerror', (e) => errors.push('desktop pageerror: ' + e.message));
  await startBot(page, 'normal');
  await page.screenshot({ path: `${OUT}/desktop-start.png` });
  let my = 0, over = false;
  const t0 = Date.now();
  while (!over && my < 40) {
    over = await waitAim(page);
    if (over) break;
    await mouseShot(page, 0.75 + (my % 3) * 0.1, my === 0 ? 'desktop-aim' : null);
    my++;
    if (my === 1) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/desktop-playback.png` });
    }
  }
  await page.waitForSelector('.result:not(.hidden)', { timeout: 20000 });
  await page.screenshot({ path: `${OUT}/desktop-result.png` });
  const st = await page.evaluate(() => window.__pz.state());
  results.push(`桌面鼠标 vs 普通电脑：我方出手 ${my} 次，比分 ${st.score[0]}:${st.score[1]}，总手数 ${st.shotNo}，结束原因 ${st.endReason}，用时 ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await ctx.close();
}

// 1b) desktop curve: the arrow keys set it (a mouse arc does not); the aim line keeps its length when curved
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push('curve: ' + m.text()));
  page.on('pageerror', (e) => errors.push('curve pageerror: ' + e.message));
  await startBot(page, 'easy');
  await waitAim(page);
  const pl = await plan(page, 0.8);
  const len = Math.hypot(pl.to.x - pl.from.x, pl.to.y - pl.from.y);
  const px = (pl.to.x - pl.from.x) / len, py = (pl.to.y - pl.from.y) / len;
  const rx = py, ry = -px; // shooter's right on screen (shot direction is opposite to the pull)
  const pathLen = (pts) => pts.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - pts[i].x, q.y - pts[i].y), 0);
  const press = async (key, n) => { for (let i = 0; i < n; i++) await page.keyboard.press(key); };
  // hold an aim; `keys` are pressed while the pull is held
  const aimWith = async (bulge, keys, shotName) => {
    await page.mouse.move(pl.from.x, pl.from.y);
    await page.mouse.down();
    const n = 16;
    for (let i = 1; i <= n; i++) {
      const t = i / n, side = Math.sin(Math.PI * t) * bulge * len;
      await page.mouse.move(pl.from.x + px * len * t + rx * side, pl.from.y + py * len * t + ry * side);
    }
    for (const [k, c] of keys) await press(k, c);
    const r = await page.evaluate(() => ({ curve: window.__pz.curve(), aim: window.__pz.aim() }));
    if (shotName) await page.screenshot({ path: `${OUT}/${shotName}.png` });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    return r;
  };
  const arc = await aimWith(0.25, []);
  const straight = await aimWith(0, []);
  const right = await aimWith(0, [['ArrowRight', 6]], 'desktop-curve');
  const left = await aimWith(0, [['ArrowLeft', 9]]);
  await press('ArrowLeft', 20);
  const clamp = await page.evaluate(() => window.__pz.curve());
  const sameLen = (a) => a.aim.ghost || straight.aim.ghost || Math.abs(pathLen(a.aim.path) - pathLen(straight.aim.path)) < 0.05;
  const ok = arc.curve === 0 && straight.curve === 0 && Math.abs(right.curve - 0.6) < 1e-9 && Math.abs(left.curve + 0.3) < 1e-9 && clamp === -1 &&
    sameLen(right) && sameLen(left);
  if (!ok) errors.push(`curve keys: arc=${arc.curve} straight=${straight.curve} right=${right.curve} left=${left.curve} clamp=${clamp} len=${pathLen(straight.aim.path).toFixed(2)}/${pathLen(right.aim.path).toFixed(2)}/${pathLen(left.aim.path).toFixed(2)}`);
  results.push(`弧线按键：鼠标划弧 → ${arc.curve === 0 ? '直线' : arc.curve}，→×6 → 右旋 ${Math.round(right.curve * 100)}%，再 ←×9 → 左旋 ${Math.round(-left.curve * 100)}%，←到底 → ${clamp}；预测线长 直线 ${pathLen(straight.aim.path).toFixed(2)} m / 右旋 ${pathLen(right.aim.path).toFixed(2)} m / 左旋 ${pathLen(left.aim.path).toFixed(2)} m${ok ? '' : '（不符合预期）'}`);
  await ctx.close();
}

// 2) phone: touch drags, then page zoom
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push('mobile: ' + m.text()));
  page.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
  const client = await ctx.newCDPSession(page);
  await startBot(page, 'easy');
  await page.screenshot({ path: `${OUT}/mobile-start.png` });
  let shots = 0;
  for (let i = 0; i < 3; i++) {
    if (await waitAim(page)) break;
    const before = await page.evaluate(() => window.__pz.state().shotNo);
    await touchShot(page, client, 0.8);
    await page.waitForFunction((b) => window.__pz.state().shotNo > b || window.__pz.playing(), before, { timeout: 5000 });
    shots++;
  }
  await waitAim(page);
  await page.screenshot({ path: `${OUT}/mobile-after-touch.png` });
  // zoomed page: the hit-testing must still map to the right piece
  await page.evaluate(() => { document.body.style.zoom = '1.25'; window.dispatchEvent(new Event('resize')); });
  await page.waitForTimeout(200);
  let zoomOk = false;
  if (!(await waitAim(page))) {
    const before = await page.evaluate(() => window.__pz.state().shotNo);
    await touchShot(page, client, 0.6);
    zoomOk = await page.waitForFunction((b) => window.__pz.state().shotNo > b || window.__pz.playing(), before, { timeout: 5000 }).then(() => true, () => false);
  }
  await page.screenshot({ path: `${OUT}/mobile-zoom.png` });
  const imgs = await page.evaluate(() => Array.from(document.images).length);
  results.push(`手机触控（390×844, DPR3）：触控出手 ${shots}/3 次成功；页面缩放 125% 后出手 ${zoomOk ? '成功' : '失败'}`);
  void imgs;
  await ctx.close();
}

// 3) asset loading
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const failed = [];
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  await startBot(page, 'easy');
  await page.waitForTimeout(800);
  const loaded = await page.evaluate(async () => {
    // The faces the renderer actually bound (original portraits for every selectable player).
    const bound = window.__pz.portraits();
    const res = await Promise.all(bound.map((b) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i.naturalWidth); i.onerror = () => ok(0); i.src = b.src; })));
    return { n: bound.length, okN: res.filter((w) => w > 0).length };
  });
  results.push(`素材加载：比赛中 ${loaded.okN}/${loaded.n} 个头像加载成功，HTTP 失败 ${failed.length} 个${failed.length ? '：' + failed.join(', ') : ''}`);
  await ctx.close();
}

await browser.close();
console.log(results.join('\n'));
console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : '无控制台错误');
process.exit(errors.length ? 1 : 0);
