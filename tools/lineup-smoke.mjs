// 阵容页烟测：原版卡池、换人、阵容存档、比赛用所选阵容。需先起 dev 服务器（URL 默认 http://127.0.0.1:5180/）。
import { chromium } from 'playwright';

const url = process.env.URL || 'http://127.0.0.1:5180/';
const out = 'runs/_diag';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 414, height: 860 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const problems = [];

await page.goto(url);
await page.evaluate(() => { localStorage.removeItem('pz_lineups'); localStorage.removeItem('pz_skin'); });
await page.reload();
await page.waitForSelector('.bottomnav');
if (!(await page.$('[data-bot="easy"]'))) problems.push('play tab is not the landing tab');
await page.screenshot({ path: `${out}/s1_play.png` });

await page.click('[data-tab="lineup"]');
await page.waitForSelector('.lu-grid .pcard');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/s1_lineup.png` });
const pool = await page.$$eval('.lu-grid .pcard', (els) => els.map((e) => e.dataset.card));
const selfMade = pool.filter((id) => /^p(0[6-9]|1[0-6])$/.test(id));
if (pool.length !== 106) problems.push(`pool ${pool.length}`);
if (selfMade.length) problems.push(`self-made in pool: ${selfMade.join(',')}`);
const brokenImgs = await page.$$eval('.lineup-screen img', (els) => els.filter((i) => i.complete && i.naturalWidth === 0).length);
if (brokenImgs) problems.push(`broken images ${brokenImgs}`);

const before = JSON.parse(await page.evaluate(() => localStorage.getItem('pz_lineups') || 'null'))?.sets?.[0] ?? null;
await page.click('[data-slot="1"]');
await page.click('[data-filter="MF"]');
const target = await page.$eval('.lu-grid .pcard:not(.on)', (e) => e.dataset.card);
await page.click(`.lu-grid .pcard[data-card="${target}"]`);
await page.waitForSelector('.pd-win');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/s1_detail.png` });
await page.click('.pd-place');
await page.waitForTimeout(300);
const after = JSON.parse(await page.evaluate(() => localStorage.getItem('pz_lineups')));
if (after.sets[0][1] !== target) problems.push(`slot 1 is ${after.sets[0][1]}, expected ${target}`);
if (new Set(after.sets[0]).size !== 5) problems.push('duplicate player after swap');

await page.click('[data-tab="play"]');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/s2_home.png` });
// 大厅必须是原版立体球场模型，不能是对局场地裁切图（LB-1c 曾把两者合并成一张）。
const arenaImg = await page.$eval('.arena-img', (i) => ({ src: i.getAttribute('src'), w: i.naturalWidth, h: i.naturalHeight }));
if (arenaImg.src !== '/assets/orig_ui/stadium/Image_01.png') problems.push(`lobby arena img ${arenaImg.src}`);
if (!arenaImg.w || !arenaImg.h) problems.push(`lobby arena img not loaded (${arenaImg.w}x${arenaImg.h})`);
await page.click('.arena-nav.next');
await page.waitForTimeout(400);
const skinAfterNext = await page.evaluate(() => localStorage.getItem('pz_skin'));
if (skinAfterNext !== 'scene_02') problems.push(`arena next -> ${skinAfterNext}`);
const arenaNextSrc = await page.$eval('.arena-img', (i) => i.getAttribute('src'));
if (arenaNextSrc !== '/assets/orig_ui/stadium/Image_02.png') problems.push(`arena next img ${arenaNextSrc}`);
await page.click('.btn-play');
await page.waitForSelector('[data-bot="easy"]');
await page.screenshot({ path: `${out}/s2_sheet.png` });
const timer = await page.$('.timer');
if (timer && (await timer.isChecked())) await timer.uncheck();
await page.click('[data-bot="easy"]');
await page.waitForSelector('canvas', { timeout: 20000 });
await page.waitForFunction(() => window.__pz?.state?.()?.pieces?.length === 10, null, { timeout: 20000 });
const sides = await page.evaluate(() => {
  const ps = window.__pz.state().pieces;
  return [0, 1].map((s) => ps.filter((p) => p.side === s).map((p) => p.playerId));
});
const mine = [...after.sets[0]].sort().join(',');
if ([...sides[0]].sort().join(',') !== mine) problems.push(`match lineup ${sides[0]} != ${after.sets[0]}`);
if (sides[1].some((id) => /^p(0[6-9]|1[0-6])$/.test(id))) problems.push(`bot uses self-made ${sides[1]}`);

console.log(JSON.stringify({ pool: pool.length, before, after: after.sets[0], bot: sides[1], errors: errors.length }));
if (errors.length) problems.push(`console errors: ${errors.slice(0, 2).join(' | ')}`);
await browser.close();
if (problems.length) {
  console.error('FAIL ' + problems.join('; '));
  process.exit(1);
}
console.log('PASS');
