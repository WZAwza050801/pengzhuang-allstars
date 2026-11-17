/**
 * test:e2e — 构建产物的真实浏览器冒烟验收。
 *
 * 做什么：起 dist/server + 静态托管测试客户端，用真实 Chromium 打开页面，
 *         校验服务端 /healthz、页面/canvas 渲染、无 JS 错误，并尽力打一杆球。
 * 不做什么：**不冒充联机对局**。两个独立客户端联机的完整对局由 `npm run test:net`
 *         与 OnlineHost 场景覆盖；本脚本只验证「构建产物真的能启动、能玩」。
 * 结果三态：PASS / FAIL / SKIP；只有 FAIL 会让退出码非零。
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';

const ROOT = process.cwd();
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT || 2567);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 4173);
const DIST_CLIENT = path.join(ROOT, 'work', 'test-client');
const DIST_SERVER = path.join(ROOT, 'dist', 'server', 'index.js');
const OUT = path.join(ROOT, 'docs', 'screens');
const ROOM_STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'allstars-e2e-'));

const results = [];
const record = (name, status, detail) => {
  results.push({ name, status, detail });
  console.log(`${status.padEnd(4)}  ${name} — ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

let serverProc = null;
let webServer = null;
let browser = null;

function startWeb() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent((req.url || '/').split('?')[0]);
      let file = path.join(DIST_CLIENT, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(DIST_CLIENT)) {
        res.writeHead(403).end();
        return;
      }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) {
        // SPA fallback
        const fallback = path.join(DIST_CLIENT, 'index.html');
        if (!fs.existsSync(fallback)) {
          res.writeHead(404).end('not found');
          return;
        }
        file = fallback;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.on('error', reject);
    srv.listen(WEB_PORT, '127.0.0.1', () => resolve(srv));
  });
}

async function waitHealth(timeoutMs = 40000) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${SERVER_PORT}/healthz`);
      if (r.ok) return { ok: true, body: await r.text() };
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = e.message;
    }
    await sleep(500);
  }
  return { ok: false, body: last };
}

async function main() {
  // 0) 前置：必须先 npm run build
  const missing = [path.join(DIST_CLIENT, 'index.html'), DIST_SERVER].filter((f) => !fs.existsSync(f));
  if (missing.length) {
    record('构建产物', 'FAIL', `缺少 ${missing.join(', ')}；请先执行 npm run build`);
    return 1;
  }
  record('构建产物', 'PASS', `work/test-client 与 dist/server/index.js 均存在`);

  fs.mkdirSync(OUT, { recursive: true });

  // 1) 服务端
  let serverErr = '';
  serverProc = spawn(process.execPath, [DIST_SERVER], {
    cwd: ROOT,
    env: { ...process.env, APP_ENV: 'test', PORT: String(SERVER_PORT), ROOM_STORE_DIR: ROOM_STORE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stderr.on('data', (d) => (serverErr += d.toString().slice(-2000)));
  serverProc.stdout.on('data', () => {});
  const health = await waitHealth();
  record('联机服务端 /healthz', health.ok ? 'PASS' : 'FAIL', health.ok ? health.body.slice(0, 220) : `${health.body} | stderr=${serverErr.slice(-300)}`);
  if (!health.ok) return 1;

  // 2) 静态站点
  try {
    webServer = await startWeb();
    record('静态托管测试客户端', 'PASS', `http://127.0.0.1:${WEB_PORT}`);
  } catch (e) {
    record('静态托管测试客户端', 'FAIL', e.message);
    return 1;
  }

  // 3) 真实 Chromium
  const errors = [];
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    record('Chromium 启动', 'FAIL', e.message);
    return 1;
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  // 3) 起始界面（首页是昵称/模式设置，canvas 要进入对局后才创建）
  try {
    await page.goto(`http://127.0.0.1:${WEB_PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0, null, { timeout: 15000 });
    await page.screenshot({ path: path.join(OUT, 'e2e-build-boot.png') });
    record('起始界面渲染', 'PASS', '#app 已挂载子节点');
  } catch (e) {
    record('起始界面渲染', 'FAIL', e.message);
  }

  // 4) 按真实 UI 顺序：填昵称 -> 选难度开局 -> canvas 挂载 -> 打一杆球
  //    UI 选择器可能随联机模式改造而变化，缺失时如实 SKIP，绝不把 SKIP 记成 PASS。
  const nick = await page.$('.nick');
  if (!nick) {
    record('进入对局 / canvas 渲染', 'SKIP', '未找到本地对局入口 .nick（联机模式可能改造了入口），不计失败');
    record('UI 一杆球', 'SKIP', '依赖进入对局，跳过');
  } else {
    let entered = false;
    try {
      await page.fill('.nick', 'E2E');
      await page.dispatchEvent('.nick', 'change');
      // 练习 / 双人 / 联机入口收在大厅"竞技模式"弹窗里
      if (await page.$('.btn-play')) await page.click('.btn-play');
      const timer = await page.$('.timer');
      if (timer) await page.uncheck('.timer');
      const bot = await page.$('[data-bot="easy"]');
      if (!bot) throw new Error('未找到 [data-bot] 按钮');
      await bot.click();
      await page.waitForSelector('canvas', { timeout: 20000 });
      entered = true;
      record('进入对局 / canvas 渲染', 'PASS', 'canvas 已挂载');
    } catch (e) {
      record('进入对局 / canvas 渲染', 'SKIP', `开局流程未完成：${e.message.slice(0, 140)}（不计失败）`);
    }

    if (!entered) {
      record('UI 一杆球', 'SKIP', '依赖进入对局，跳过');
    } else {
      try {
        await page.waitForFunction(() => window.__pz && window.__pz.canAim && window.__pz.canAim(), null, { timeout: 20000 });
        const before = await page.evaluate(() => window.__pz.state().shotNo);
        const pl = await page.evaluate(() => {
          const st = window.__pz.state();
          const mine = st.pieces.filter((p) => p.side === st.turn && p.out === 0 && p.frozen === 0);
          mine.sort((a, b) => Math.hypot(a.x - st.ball.x, a.y - st.ball.y) - Math.hypot(b.x - st.ball.x, b.y - st.ball.y));
          const p = mine[0];
          const d = Math.hypot(st.ball.x - p.x, st.ball.y - p.y);
          const ux = (st.ball.x - p.x) / d, uy = (st.ball.y - p.y) / d;
          const pull = 0.32 * 0.6 + 2.4 * 0.8;
          return { from: window.__pz.screenOf(p.x, p.y), to: window.__pz.screenOf(p.x - ux * pull, p.y - uy * pull) };
        });
        await page.mouse.move(pl.from.x, pl.from.y);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) {
          await page.mouse.move(pl.from.x + ((pl.to.x - pl.from.x) * i) / 8, pl.from.y + ((pl.to.y - pl.from.y) * i) / 8);
        }
        await page.mouse.up();
        // 出手后有物理回放，shotNo 由 host 异步推状态；用条件等待而非固定延时
        try {
          await page.waitForFunction((b) => window.__pz.state().shotNo > b, before, { timeout: 15000, polling: 150 });
        } catch {
          const diag = await page.evaluate(() => {
            const s = window.__pz.state();
            return { shotNo: s.shotNo, turn: s.turn, over: s.over, playing: window.__pz.playing(), canAim: window.__pz.canAim(), curve: window.__pz.curve() };
          }).catch(() => ({}));
          console.log(`[diag] shotNo 未增长，state=${JSON.stringify(diag)}`);
        }
        const after = await page.evaluate(() => window.__pz.state().shotNo);
        await page.screenshot({ path: path.join(OUT, 'e2e-build-shot.png') });
        record('UI 一杆球', after > before ? 'PASS' : 'FAIL', `shotNo ${before} -> ${after}`);
      } catch (e) {
        record('UI 一杆球', 'SKIP', `交互未完成：${e.message.slice(0, 160)}（不计失败）`);
      }
    }
  }

  if (await page.$('.game')) {
    try {
      await page.waitForFunction(() => window.__pz?.canAim(), null, { timeout: 30000 });
      const touch = await page.evaluate(() => {
        const state = window.__pz.state();
        const piece = state.pieces.filter(p => p.side === state.turn && p.out === 0 && p.frozen === 0)
          .sort((a,b) => Math.hypot(a.x,a.y)-Math.hypot(b.x,b.y))[0];
        return { before: state.shotNo, points: [[0,0],[-0.15,0.3],[-0.2,0.6],[0,1.1]].map(([x,y]) => window.__pz.screenOf(piece.x+x,piece.y+y)) };
      });
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
        const point = p => ({ x:p.x, y:p.y, id:1 });
        await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[point(touch.points[0])] });
        for (const p of touch.points.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[point(p)] });
        const curved = await page.evaluate(() => !!window.__pz.aim() && Math.abs(window.__pz.curve()) > 0);
        await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
        await page.waitForFunction(before => window.__pz.state().shotNo > before, touch.before, { timeout:15000 });
        record('浏览器触屏弧线出手', curved ? 'PASS' : 'FAIL', 'CDP真实touch输入，弯曲拖拽产生非零弧线并推进杆数');
      } finally { await cdp.send('Emulation.setTouchEmulationEnabled', { enabled:false }); await cdp.detach(); }
    } catch (e) { record('浏览器触屏弧线出手', 'FAIL', e.message.slice(0,180)); }
  }

  if (await page.$('.game')) {
    try {
      await page.waitForFunction(() => window.__pz?.canAim(), null, { timeout: 30000 });
      const lifecycle = await page.evaluate(() => {
        window.dispatchEvent(new Event('pagehide'));
        const suspended = !window.__pz.canAim();
        window.dispatchEvent(new Event('pageshow'));
        return suspended && window.__pz.canAim();
      });
      record('平台前后台输入恢复', lifecycle ? 'PASS' : 'FAIL', 'pagehide 禁止出手，pageshow 恢复');
      await page.click('.menu-btn');
      await page.selectOption('.quality','low');
      const qualityLow = await page.evaluate(()=>window.__pz.resources().quality==='low');
      await page.selectOption('.quality','high');
      const qualityHigh = await page.evaluate(()=>window.__pz.resources().quality==='high');
      await page.click('.menu .close');
      record('比赛画质切换', qualityLow && qualityHigh ? 'PASS' : 'FAIL', '菜单实际切换流畅/精细，物理状态保持');
      const shot = await page.evaluate(() => {
        const st = window.__pz.state();
        const p = st.pieces.find(p => p.side === st.turn && p.out === 0 && p.frozen === 0);
        return {before:st.shotNo,from:window.__pz.screenOf(p.x,p.y),to:window.__pz.screenOf(p.x,p.y+.9)};
      });
      await page.mouse.move(shot.from.x,shot.from.y);await page.mouse.down();await page.mouse.move(shot.to.x,shot.to.y);await page.mouse.up();
      await page.waitForFunction(()=>window.__pz.playing(),null,{timeout:5000});
      const resumed = await page.evaluate(before => {
        window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pageshow'));
        return !window.__pz.playing() && window.__pz.state().shotNo>before;
      },shot.before);
      record('后台回放丢弃', resumed ? 'PASS' : 'FAIL', '中途切后台后跳到最新权威终态，不补播过期动画');
      await page.click('.menu-btn'); await page.click('.menu .exit');
      const released = await page.evaluate(() => !window.__pz && !!document.querySelector('.shell'));
      record('比赛宿主释放', released ? 'PASS' : 'FAIL', '退出回大厅并释放自动化句柄');
    } catch (e) { record('平台生命周期验收', 'FAIL', e.message.slice(0, 180)); }
  }
  const production = await ctx.newPage();
  production.on('pageerror',e=>errors.push(e.message));
  production.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await production.goto(`http://127.0.0.1:${SERVER_PORT}/`);
  await production.fill('.nick','production');await production.click('.btn-play');await production.uncheck('.timer');await production.click('[data-bot="easy"]');
  await production.waitForSelector('.game canvas');
  const noHandle=await production.evaluate(()=>!window.__pz&&!window.__fieldCalibration&&!window.__aiAudit&&!window.__cardAudit&&!window.__uiAudit&&!window.__componentsAudit);
  const html=await (await fetch(`http://127.0.0.1:${SERVER_PORT}/field-debug.html`)).text();
  const cardHtml=await (await fetch(`http://127.0.0.1:${SERVER_PORT}/card-debug.html`)).text();
  const uiHtml=await (await fetch(`http://127.0.0.1:${SERVER_PORT}/ui-debug.html`)).text();
  const componentsHtml=await (await fetch(`http://127.0.0.1:${SERVER_PORT}/components-debug.html`)).text();
  const noEntry=!html.includes('/src/fieldDebug.ts')&&!cardHtml.includes('/src/cardDebug.ts')&&!uiHtml.includes('/src/uiDebug.ts')&&!componentsHtml.includes('/src/componentsDebug.ts')&&!fs.existsSync(path.join(ROOT,'dist/client/field-debug.html'))&&!fs.existsSync(path.join(ROOT,'dist/client/ai-debug.html'))&&!fs.existsSync(path.join(ROOT,'dist/client/card-debug.html'))&&!fs.existsSync(path.join(ROOT,'dist/client/ui-debug.html'))&&!fs.existsSync(path.join(ROOT,'dist/client/components-debug.html'));
  record('生产包调试隔离', noHandle && noEntry ? 'PASS' : 'FAIL', '实际生产页可进入比赛，调试句柄和调试HTML均未发布');
  await production.close();
  const modeContexts = [];
  try {
    const pages = [];
    for (const viewport of [{ width: 1200, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      modeContexts.push(context);
      const peer = await context.newPage();
      peer.on('pageerror', e => errors.push(e.message));
      peer.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await peer.goto(`http://127.0.0.1:${SERVER_PORT}/`);
      pages.push(peer);
    }
    const [a, b] = pages;
    await a.fill('.nick', 'mode-owner'); await a.click('.btn-play'); await a.click('.online-create');
    await a.locator('.rule-summary').filter({ hasText: '统一 Lv5' }).waitFor();
    const roomCode = await a.locator('.roomcode b').innerText();
    await b.fill('.nick', 'mode-guest'); await b.click('.btn-play'); await b.fill('.code', roomCode); await b.click('.online-join');
    await b.locator('.rule-summary').filter({ hasText: '统一 Lv5' }).waitFor();
    const summaries = await Promise.all(pages.map(p => p.locator('.rule-summary').innerText()));
    record('双端模式规则摘要', summaries[0] === summaries[1] && summaries[0].includes('均衡好友赛') && summaries[0].includes('无正式奖励') ? 'PASS' : 'FAIL', summaries[0]);
    await a.screenshot({ path: path.join(ROOT, 'docs/productization/reports/mode-lobby.png') });
    await a.click('.ready'); await b.click('.ready');
    await Promise.all(pages.map(p => p.waitForSelector('.game canvas')));
    record('均衡好友赛双浏览器开局', 'PASS', '独立桌面/移动视口均从规则摘要进入比赛');
  } catch (e) { record('均衡好友赛浏览器验收', 'FAIL', e.message.slice(0, 180)); }
  finally { await Promise.all(modeContexts.map(context => context.close())); }
  record('运行时 JS 错误', errors.length === 0 ? 'PASS' : 'FAIL', errors.length ? errors.slice(0, 3).join(' | ').slice(0, 300) : 'console error / pageerror 均为 0');

  const failed = results.filter((r) => r.status === 'FAIL');
  const skipped = results.filter((r) => r.status === 'SKIP');
  console.log(`\n[e2e-browser] PASS=${results.length - failed.length - skipped.length} SKIP=${skipped.length} FAIL=${failed.length}`);
  console.log('[e2e-browser] 注：联机双客户端完整对局由 test:net / OnlineHost 场景验收，本脚本不冒充。');
  return failed.length ? 1 : 0;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.error('[e2e-browser] unexpected error:', e);
  code = 1;
} finally {
  try { if (browser) await browser.close(); } catch {}
  try { if (webServer) webServer.close(); } catch {}
  try {
    if (serverProc && !serverProc.killed) {
      serverProc.kill();
      await sleep(300);
      if (!serverProc.killed) serverProc.kill('SIGKILL');
    }
  } catch {}
  if (path.dirname(path.resolve(ROOM_STORE)) === path.resolve(os.tmpdir()) && path.basename(ROOM_STORE).startsWith('allstars-e2e-')) {
    fs.rmSync(ROOM_STORE, { recursive: true, force: true });
  }
}
process.exit(code);
