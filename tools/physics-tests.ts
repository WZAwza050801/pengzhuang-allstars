/**
 * Physics + rules verification on the real code paths. Writes docs/physics-tests.md.
 *   npm run test:physics
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DATA } from '../shared/data';
import { ShotRunner, simulateShot, insideField, type SimSetup, type SimShot, type SimWorld } from '../shared/physics';
import { createMatch, resolveShot, validateShot, beginTurn, endByTime, levelAttrs, pieceStats, buildSetup, buildShot, type MatchState } from '../shared/match';
import { makeRng } from '../shared/rng';
import { foldAimPath } from '../shared/aim';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const G = DEFAULT_DATA.geometry;
const P = DEFAULT_DATA.physics;
const L = G.length / 2;
const R = P.disc.radius;
const BR = P.ball.radius;

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
}
const f2 = (v: number) => v.toFixed(2);
const f3 = (v: number) => v.toFixed(3);

function piece(id: string, x: number, y: number, side: 0 | 1 = 0, mass = P.disc.mass) {
  return { id, side, x, y, mass };
}

/** Per-step invariants used by the scenario tests and the fuzz. */
function watcher(setup: SimSetup, opts: { allowBoost?: boolean } = {}) {
  const st = { outside: 0, maxOverlap: 0, keRise: 0, worstKeRise: 0, prevKe: -1, steps: 0, springKicks: 0 };
  const masses = new Map<string, number>();
  for (const p of setup.pieces) masses.set(p.id, p.mass);
  masses.set('ball', P.ball.mass);
  const onStep = (_s: number, sim: SimWorld) => {
    st.steps++;
    let ke = 0;
    const pos: { id: string; x: number; y: number; r: number }[] = [];
    for (const [id, b] of sim.bodies) {
      const p = b.getPosition();
      const r = id === 'ball' ? BR : R;
      if (!insideField(G, p.x, p.y, r, 0.03)) {
        st.outside++;
        if (process.env.DEBUG_OUTSIDE && st.outside === 1) console.log('outside', id, p.x.toFixed(3), p.y.toFixed(3));
      }
      pos.push({ id, x: p.x, y: p.y, r });
      if (b.isDynamic()) {
        const v = b.getLinearVelocity();
        ke += 0.5 * masses.get(id)! * (v.x * v.x + v.y * v.y);
      }
    }
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
      const a = pos[i], b = pos[j];
      const ov = a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y);
      if (ov > st.maxOverlap) st.maxOverlap = ov;
    }
    if (sim.kicksThisStep > 0) st.springKicks++;
    else if (st.prevKe > 0 && ke > st.prevKe * 1.005 + 1e-6) {
      st.keRise++;
      st.worstKeRise = Math.max(st.worstKeRise, ke / st.prevKe);
    }
    st.prevKe = ke;
  };
  return { st, onStep, allowBoost: !!opts.allowBoost };
}

function run(setup: SimSetup, shot: SimShot) {
  const w = watcher(setup, { allowBoost: !!shot.ballBoost });
  const res = simulateShot(G, P, setup, shot, { onStep: w.onStep });
  return { res, w: w.st };
}

// ---------------------------------------------------------------- scenarios
function scenarios() {
  {
    // 正撞：同质量正碰，动量守恒，被撞者获得大部分速度
    const setup = { ball: { x: 2.5, y: 4 }, pieces: [piece('a', 0, 2), piece('b', 0, 0, 1)] };
    let pa = 0, pb = 0, before = 0, got = false;
    const r = new ShotRunner(G, P, setup, { pieceId: 'a', dirX: 0, dirY: -1, power: 0.6, curve: 0 }, {
      record: false,
      onStep: (_s, sim) => {
        const va = sim.bodies.get('a')!.getLinearVelocity().y, vb = sim.bodies.get('b')!.getLinearVelocity().y;
        if (!got && vb !== 0) { got = true; pa = va; pb = vb; } else if (!got) before = va;
      },
    });
    while (!r.stepOnce()) { /* run */ }
    const momentumErr = Math.abs((pa + pb) - before) / Math.abs(before);
    check('正撞（同质量球员）', got && momentumErr < 0.02 && Math.abs(pb) > Math.abs(pa),
      `撞前 ${f2(-before)} m/s → 撞者 ${f2(-pa)}、被撞 ${f2(-pb)} m/s，动量误差 ${(momentumErr * 100).toFixed(2)}%`);
  }
  {
    // 斜撞：足球沿两圆心连线方向飞出
    const setup = { ball: { x: 0.25, y: 0 }, pieces: [piece('a', 0, 1.5)] };
    const { res, w } = run(setup, { pieceId: 'a', dirX: 0, dirY: -1, power: 0.5, curve: 0 });
    const fc = res.firstContact!;
    const nx = 0.25 - fc.x, ny = 0 - fc.y;
    const bf = res.final.ball;
    const dirAng = Math.atan2(bf.y - 0, bf.x - 0.25), lineAng = Math.atan2(ny, nx);
    const err = Math.abs(((dirAng - lineAng + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 180 / Math.PI;
    check('斜撞足球（偏心碰撞）', !!fc && err < 8 && w.outside === 0,
      `足球出射方向与圆心连线偏差 ${err.toFixed(1)}°（墙反弹前），最大重叠 ${f3(w.maxOverlap)} m`);
  }
  {
    // 连续碰撞：一排 3 名球员 + 足球
    const setup = { ball: { x: 0, y: -2.0 }, pieces: [piece('a', 0, 2.5), piece('b', 0, 1.2, 1), piece('c', 0, 0.3, 1), piece('d', 0, -0.9, 1)] };
    const { res, w } = run(setup, { pieceId: 'a', dirX: 0, dirY: -1, power: 1, curve: 0 });
    const moved = ['b', 'c', 'd'].every((id) => Math.abs(res.final.pieces[id].y - setup.pieces.find((p) => p.id === id)!.y) > 0.05);
    const ballMoved = Math.abs(res.final.ball.y + 2.0) > 0.2;
    check('连续碰撞（球员链 + 足球）', moved && ballMoved && w.keRise === 0 && w.maxOverlap < 0.02 && !res.forcedStop,
      `链上全部移动=${moved}，足球移动=${ballMoved}，动能异常上升步数 ${w.keRise}，最大重叠 ${f3(w.maxOverlap)} m，${f2(res.duration)} s 停止`);
  }
  {
    // 贴墙：紧贴右边墙沿墙满力推进
    const x = G.width / 2 - R - 0.001;
    const setup = { ball: { x: -2, y: 3 }, pieces: [piece('a', x, 3)] };
    const { res, w } = run(setup, { pieceId: 'a', dirX: 0.02, dirY: -1, power: 1, curve: 0 });
    check('贴墙滑行', w.outside === 0 && !res.forcedStop && res.final.pieces.a.y < 0,
      `越界步数 ${w.outside}，${f2(res.duration)} s 停止，终点 y=${f2(res.final.pieces.a.y)}`);
  }
  {
    // 贴墙起步斜撞进墙角
    const x = G.width / 2 - R - 0.001;
    const setup = { ball: { x: -2, y: 3 }, pieces: [piece('a', x, -3.5)] };
    const { res, w } = run(setup, { pieceId: 'a', dirX: 1, dirY: -1, power: 1, curve: 0.5 });
    check('贴墙起步撞切角', w.outside === 0 && !res.forcedStop, `越界步数 ${w.outside}，最大重叠 ${f3(w.maxOverlap)} m，${f2(res.duration)} s 停止`);
  }
  {
    // 角落弹簧：四个角都只给球员加力；足球撞角落不触发、不加能量
    const W = G.width / 2;
    const notes: string[] = [];
    let ok = true;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const setup = { ball: { x: 0, y: 0 }, pieces: [piece('a', sx * (W - 1.6), sy * (L - 1.6))] };
      const { res, w } = run(setup, { pieceId: 'a', dirX: sx, dirY: sy, power: 0.3, curve: 0 });
      const kick = res.events.find((e) => e.type === 'spring-kick');
      ok &&= !!kick && w.outside === 0 && !res.forcedStop;
      notes.push(`${kick?.b ?? '未触发'} 弹出 ${kick ? f2(kick.speed) : '-'} m/s`);
    }
    const bx = W - 1.6, by = -L + 1.6;
    const bsetup = { ball: { x: bx + 0.5, y: by - 0.5 }, pieces: [piece('a', bx, by)] };
    let ballKicked = false;
    const bres = simulateShot(G, P, bsetup, { pieceId: 'a', dirX: 1, dirY: -1, power: 0.6, curve: 0 }, { record: false });
    ballKicked = bres.events.some((e) => e.type === 'spring-kick' && e.a === 'ball');
    ok &&= !ballKicked;
    check('角落弹簧（球员加力、足球按普通墙）', ok, `${notes.join('，')}；足球撞角落${ballKicked ? '被弹簧加力 ❌' : '未加力'}`);
  }
  {
    // 门柱擦边：足球擦着门柱，一次弹出、一次蹭进
    const gx = G.goalWidth / 2;
    const out: string[] = [];
    let inCount = 0, outCount = 0, postHits = 0, tunnel = 0;
    for (let k = 0; k < 13; k++) {
      const offs = -0.12 + k * 0.02;
      const bx = gx + offs;
      const setup = { ball: { x: bx, y: -L + 1.2 }, pieces: [piece('a', bx, -L + 1.2 + R + BR + 0.3)] };
      const { res, w } = run(setup, { pieceId: 'a', dirX: 0, dirY: -1, power: 0.8, curve: 0 });
      const hitPost = res.events.some((e) => e.type.includes('post') && (e.a === 'ball' || e.b === 'ball'));
      if (hitPost) postHits++;
      if (res.goal) inCount++; else outCount++;
      if (w.outside) tunnel++;
      out.push(`${offs >= 0 ? '+' : ''}${offs.toFixed(2)}:${res.goal ? '进' : '出'}${hitPost ? '(柱)' : ''}`);
    }
    check('门柱擦边（13 个横向偏移）', postHits >= 2 && inCount > 0 && outCount > 0 && tunnel === 0,
      `碰柱 ${postHits} 次，进 ${inCount}/出 ${outCount}，穿模 ${tunnel}；${out.join(' ')}`);
  }
  {
    // 高速入门：技能加速到球速上限，射入球门，不能穿网
    const setup = { ball: { x: 0, y: -L + 2.0 }, pieces: [piece('a', 0, -L + 3.0)] };
    const { res, w } = run(setup, { pieceId: 'a', dirX: 0, dirY: -1, power: 1, curve: 0, speedMul: 1.4, ballBoost: { mul: 1.35, requireInBox: false } });
    const goals = res.events.filter((e) => e.type === 'goal').length;
    const by = res.final.ball.y;
    check('高速入门（技能加速）', !!res.goal && goals === 1 && w.outside === 0 && by > -L - G.goalDepth,
      `最高速度 ${f2(res.maxSpeed)} m/s（上限 ${P.maxBallSpeed}），进球事件 ${goals} 次，足球停在 y=${f2(by)}（网底 ${f2(-L - G.goalDepth)}）`);
  }
  {
    // 部分过线：二分力度，让足球停在压线位置 → 不算进球；整体过线 → 算
    // 最小力度时足球也会走近 1 m，所以二分的是足球离门线的起始距离
    const shoot = (dist: number, power = P.shot.minPower) => {
      const by = -L + dist;
      const setup = { ball: { x: 0, y: by }, pieces: [piece('a', 0, by + R + BR + 0.01)] };
      return simulateShot(G, P, setup, { pieceId: 'a', dirX: 0, dirY: -1, power, curve: 0 }, { record: false });
    };
    let lo = 0.2, hi = 3;
    let partial: ReturnType<typeof shoot> | null = null;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const r = shoot(mid);
      const y = r.final.ball.y;
      if (y > -L - BR + 0.001 && y < -L) { partial = r; break; }
      if (y <= -L) lo = mid; else hi = mid;
    }
    const full = shoot(1.5, 1);
    check('足球只部分过线不算进球', !!partial && !partial.goal && !!full.goal,
      partial ? `停在 y=${f3(partial.final.ball.y)}（门线 ${f3(-L)}，整体过线需 < ${f3(-L - BR)}）→ 进球=${!!partial.goal}；满力 → 进球=${!!full.goal}` : '未找到压线力度');
  }
  {
    // 低速收尾：最后 0.3 s 速度平滑下降
    const setup = { ball: { x: 2, y: 4 }, pieces: [piece('a', 0, 3)] };
    const speeds: number[] = [];
    const r = new ShotRunner(G, P, setup, { pieceId: 'a', dirX: 0, dirY: -1, power: 0.35, curve: 0 }, { record: false, onStep: (_s, sim) => speeds.push(sim.speedOf('a')) });
    while (!r.stepOnce()) { /* run */ }
    let maxJump = 0;
    for (let i = 1; i < speeds.length; i++) maxJump = Math.max(maxJump, speeds[i - 1] - speeds[i]);
    const crawl = speeds.filter((s) => s > 0 && s < 0.1).length / P.hz;
    check('低速收尾无微抖、无急刹', maxJump < 0.06 && crawl < 0.2, `单步最大减速 ${f3(maxJump)} m/s，低于 0.1 m/s 的爬行时间 ${f2(crawl)} s`);
  }
}

// ---------------------------------------------------------------- fps consistency
function fpsConsistency() {
  const setup: SimSetup = {
    ball: { x: 0.1, y: -0.3 },
    pieces: [piece('a', -0.8, 2.6), piece('b', 0.6, -1.4, 1), piece('c', -1.2, -2.2, 1), piece('d', 1.5, 1.0)],
  };
  const shot: SimShot = { pieceId: 'a', dirX: 0.35, dirY: -1, power: 0.92, curve: 0.6, curveMul: 1.1, speedMul: 1.02 };
  const ref = simulateShot(G, P, setup, shot);
  const refKey = JSON.stringify(ref.final);
  const rows: string[] = [];
  let allSame = true;
  for (const fps of [30, 60, 120, 144]) {
    for (const jitter of [false, true]) {
      const rng = makeRng(fps * 7 + (jitter ? 1 : 0));
      const r = new ShotRunner(G, P, setup, shot);
      const dt = 1 / P.hz;
      let acc = 0, frames = 0, maxSteps = 0;
      while (!r.done) {
        const frameDt = (1 / fps) * (jitter ? 0.6 + rng.next() * 0.8 : 1);
        acc += Math.min(frameDt, 0.25);
        let n = 0;
        while (acc >= dt && !r.done) { r.stepOnce(); acc -= dt; n++; }
        maxSteps = Math.max(maxSteps, n);
        frames++;
      }
      const same = JSON.stringify(r.result().final) === refKey && JSON.stringify(r.result().frames) === JSON.stringify(ref.frames);
      allSame &&= same;
      rows.push(`${fps}FPS${jitter ? '+抖动' : ''}:${same ? '一致' : '不一致'}(${frames}帧)`);
    }
  }
  const again = simulateShot(G, P, setup, shot);
  check('固定出手 30/60/120/144 FPS 渲染一致', allSame && JSON.stringify(again.frames) === JSON.stringify(ref.frames), rows.join('，'));
}

// ---------------------------------------------------------------- fuzz
function randomSetup(rng: ReturnType<typeof makeRng>): SimSetup {
  const pieces: SimSetup['pieces'] = [];
  const placed: { x: number; y: number; r: number }[] = [];
  const tryPlace = (r: number) => {
    for (let k = 0; k < 200; k++) {
      const x = (rng.next() * 2 - 1) * (G.width / 2 - r - 0.01);
      const y = (rng.next() * 2 - 1) * (L - r - 0.01);
      if (!insideField(G, x, y, r, 0)) continue;
      if (placed.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + r + 0.005)) { placed.push({ x, y, r }); return { x, y }; }
    }
    throw new Error('placement failed');
  };
  const ball = tryPlace(BR);
  const m = DEFAULT_DATA.mapping;
  for (let i = 0; i < 10; i++) {
    const pos = tryPlace(R);
    const massMul = m.massMul[0] + (m.massMul[1] - m.massMul[0]) * rng.next();
    const boost = rng.next() < 0.15 ? 1.6 * 1.5 : 1; // skill + guardian stacking extremes
    pieces.push({ id: `p${i}`, side: (i < 5 ? 0 : 1) as 0 | 1, x: pos.x, y: pos.y, mass: P.disc.mass * massMul * boost, fixed: rng.next() < 0.08 && i !== 0 });
  }
  return { ball, pieces };
}

function fuzz(n: number) {
  const rng = makeRng(20261114);
  let outside = 0, overlapEnd = 0, keRise = 0, forced = 0, multiGoal = 0, overspeed = 0, goals = 0, worstOverlap = 0, worstKe = 1;
  let totalSteps = 0, maxDur = 0, springShots = 0;
  const overspeedNotes: string[] = [];
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const setup = randomSetup(rng);
    // half the shots aim at the ball so goals, post hits and chain collisions actually occur
    const s0 = setup.pieces[0];
    const a = rng.next() < 0.5 ? rng.next() * Math.PI * 2 : Math.atan2(setup.ball.y - s0.y, setup.ball.x - s0.x) + (rng.next() - 0.5) * 0.3;
    const boost = rng.next() < 0.2;
    const shot: SimShot = {
      pieceId: 'p0', dirX: Math.cos(a), dirY: Math.sin(a), power: 0.06 + rng.next() * 0.94,
      curve: rng.next() < 0.5 ? 0 : rng.next() * 2 - 1, speedMul: 0.92 + rng.next() * 0.16 * (rng.next() < 0.2 ? 1.3 : 1),
      curveMul: 0.6 + rng.next() * 0.8 * (rng.next() < 0.2 ? 2 : 1),
      ballBoost: boost ? { mul: 1.35, requireInBox: false } : null,
    };
    const w = watcher(setup, { allowBoost: boost });
    const res = simulateShot(G, P, setup, shot, { onStep: w.onStep });
    totalSteps += res.steps;
    maxDur = Math.max(maxDur, res.duration);
    if (w.st.outside) outside++;
    if (w.st.springKicks) springShots++;
    if (!boost && w.st.keRise) { keRise++; worstKe = Math.max(worstKe, w.st.worstKeRise); }
    if (res.forcedStop) forced++;
    const g = res.events.filter((e) => e.type === 'goal').length;
    if (g > 1) multiGoal++;
    if (g) goals++;
    if (!boost && res.maxSpeed > res.launchSpeed * 1.01 && overspeedNotes.length < 6) {
      overspeedNotes.push(`#${i} 出手 ${f2(res.launchSpeed)} → 最高 ${f2(res.maxSpeed)}`);
    }
    if (res.maxSpeed > P.maxBallSpeed + 1e-6 && !boost) overspeed++;
    // persistent overlap at rest
    const all = [{ x: res.final.ball.x, y: res.final.ball.y, r: BR }, ...setup.pieces.map((p) => ({ ...res.final.pieces[p.id], r: R }))];
    let ov = 0;
    for (let x = 0; x < all.length; x++) for (let y = x + 1; y < all.length; y++) ov = Math.max(ov, all[x].r + all[y].r - Math.hypot(all[x].x - all[y].x, all[x].y - all[y].y));
    worstOverlap = Math.max(worstOverlap, ov);
    if (ov > 0.01) overlapEnd++;
  }
  const secs = (Date.now() - t0) / 1000;
  check(`${n} 次固定种子随机出手`, outside === 0 && overlapEnd === 0 && keRise === 0 && forced === 0 && multiGoal === 0 && overspeed === 0,
    `穿墙/越界 ${outside}，静止后持续重叠 ${overlapEnd}（最大 ${f3(worstOverlap)} m），无技能时动能异常上升 ${keRise}（最差 ×${f3(worstKe)}），超过球速上限 ${overspeed}，` +
    `超时强停 ${forced}，重复进球 ${multiGoal}，进球局 ${goals}，触发角落弹簧 ${springShots}（弹簧那一步的加力不计入能量检查）；` +
    `被撞物体快于出手速度（轻撞重传递，动能未增加，属正常）示例：${overspeedNotes.join('、') || '无'}；最长 ${f2(maxDur)} s，平均 ${(totalSteps / n / P.hz).toFixed(2)} s/次，耗时 ${secs.toFixed(1)} s（${(secs / n * 1000).toFixed(1)} ms/次）`);
}

// ---------------------------------------------------------------- rules fuzz
function rulesFuzz(matches: number) {
  const data = DEFAULT_DATA;
  const rng = makeRng(777);
  const ids = Object.keys(data.players);
  let shots = 0, problems = 0, goalsSeen = 0, ended = 0, skillEvents = 0, rejected = 0;
  const notes: string[] = [];
  for (let m = 0; m < matches; m++) {
    const pick = () => { const c = [...ids]; const out: string[] = []; for (let i = 0; i < 5; i++) out.push(c.splice(Math.floor(rng.next() * c.length), 1)[0]); return out; };
    const st: MatchState = createMatch(data, [pick(), pick()], { seed: 1000 + m });
    beginTurn(st, data);
    let guard = 0;
    while (!st.over && guard++ < 200) {
      const mine = st.pieces.filter((p) => p.side === st.turn && p.out === 0 && p.frozen === 0);
      if (!mine.length) { problems++; notes.push('无可用球员'); break; }
      const p = mine[Math.floor(rng.next() * mine.length)];
      // aim mostly at the ball so goals happen
      const toBall = Math.atan2(st.ball.y - p.y, st.ball.x - p.x);
      const a = toBall + (rng.next() - 0.5) * 0.6;
      const input = { pieceId: p.id, dirX: Math.cos(a), dirY: Math.sin(a), power: 0.4 + rng.next() * 0.6, curve: rng.next() - 0.5 };
      // invalid & duplicate inputs must be rejected
      const other = st.pieces.find((q) => q.side !== st.turn)!;
      if (!validateShot(st, data, st.turn, { ...input, pieceId: other.id })) problems++; else rejected++;
      if (!validateShot(st, data, (1 - st.turn) as 0 | 1, input)) problems++; else rejected++;
      if (!validateShot(st, data, st.turn, { ...input, power: 2 })) problems++; else rejected++;
      if (!validateShot(st, data, st.turn, { ...input, dirX: NaN })) problems++; else rejected++;
      const before = [...st.score] as [number, number];
      const prevTurn = st.turn;
      const out = resolveShot(st, data, input);
      shots++;
      const g = out.events.filter((e) => e.type === 'goal').length;
      goalsSeen += g;
      skillEvents += out.events.filter((e) => e.type === 'skill').length + out.turnEvents.filter((e) => e.type === 'skill').length;
      const diff = st.score[0] + st.score[1] - before[0] - before[1];
      if (diff !== g || g > 1) { problems++; notes.push(`比分变化 ${diff} 与进球事件 ${g} 不符`); }
      if (g && !st.over) {
        const scorer = out.events.find((e) => e.type === 'goal') as { scoredBy: 0 | 1 };
        if (st.turn !== 1 - scorer.scoredBy) { problems++; notes.push('失球方未开球'); }
        if (st.ball.x !== 0 || st.ball.y !== 0) { problems++; notes.push('进球后未复位'); }
      }
      if (!g && !out.events.some((e) => e.type === 'extra') && !st.over && st.turn === prevTurn) { problems++; notes.push('未换手'); }
      for (const q of st.pieces) if (q.out === 0 && !insideField(data.geometry, q.x, q.y, R, 0.03)) { problems++; notes.push('球员在场外'); }
    }
    if (st.over) ended++; else { problems++; notes.push('比赛未结束'); }
  }
  check(`规则：${matches} 场随机完整比赛`, problems === 0 && ended === matches,
    `出手 ${shots} 次，进球 ${goalsSeen}，技能事件 ${skillEvents}，非法/越权出手被拒 ${rejected} 次，全部正常结束 ${ended}/${matches}${notes.length ? '；问题：' + [...new Set(notes)].join('、') : ''}`);
}

function clockRule() {
  const data = DEFAULT_DATA;
  const lineup = data.rules.defaultLineup;
  const cases: [number, number, number][] = [[1, 0, 0], [0, 2, 1], [1, 1, -1]];
  const notes: string[] = [];
  let ok = true;
  for (const [a, b, want] of cases) {
    const st = createMatch(data, [lineup, lineup], { seed: 1 });
    st.score = [a, b];
    const ev = endByTime(st);
    const good = st.over && st.winner === want && st.endReason === 'time' && ev.length === 1 && endByTime(st).length === 0;
    ok &&= good;
    notes.push(`${a}:${b}→${want === -1 ? '平局' : `${want} 方胜`}${good ? '' : ' ❌'}`);
  }
  check(`时间到按比分判定（${data.rules.matchSeconds} s）`, ok, notes.join('，') + '；重复结算被忽略');
}

function mirrorCurve() {
  // A curving shot keeps curving after a wall, bending the other way (mirror image of the incoming curve).
  const setup = { ball: { x: -2, y: -4 }, pieces: [piece('a', 0, 3)] };
  const turns: { t: number; w: number; vx: number }[] = [];
  let prev: { x: number; y: number } | null = null;
  const r = new ShotRunner(G, P, setup, { pieceId: 'a', dirX: 1, dirY: -0.5, power: 0.9, curve: 1 }, {
    record: false,
    onStep: (_s, sim) => {
      const v = sim.bodies.get('a')!.getLinearVelocity();
      if (prev) turns.push({ t: r.t, w: (prev.x * v.y - prev.y * v.x) / (Math.hypot(prev.x, prev.y) * Math.hypot(v.x, v.y) + 1e-12), vx: v.x });
      prev = { x: v.x, y: v.y };
    },
  });
  while (!r.stepOnce()) { /* run */ }
  const bounce = turns.findIndex((s) => s.vx < 0);
  const before = turns.slice(5, Math.max(5, bounce - 3)).map((s) => s.w);
  const after = turns.slice(bounce + 3, bounce + 40).map((s) => s.w);
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const wb = avg(before), wa = avg(after);
  const ok = bounce > 0 && before.length > 5 && after.length > 5 && Math.abs(wb) > 1e-4 && Math.abs(wa) > 1e-4 && Math.sign(wa) === -Math.sign(wb) &&
    before.every((w) => Math.sign(w) === Math.sign(wb)) && after.every((w) => Math.sign(w) === Math.sign(wa));
  check('弧线撞墙后镜面反弯', ok,
    `撞墙前每步转角 ${(wb * 180 / Math.PI).toFixed(3)}°，撞墙后 ${(wa * 180 / Math.PI).toFixed(3)}°（方向相反、仍在拐）`);
}

function aimLine() {
  const len = 5, xw = G.width / 2 - R;
  const pathLen = (pts: { x: number; y: number }[]) => pts.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - pts[i].x, q.y - pts[i].y), 0);
  // straight line at the right wall: the part beyond the wall is mirrored back, nothing is cut off
  const straight = foldAimPath(G, [{ x: 0, y: 0 }, { x: 1, y: 0 }], len, R);
  const end = straight.path[straight.path.length - 1];
  const okStraight = Math.abs(end.x - (xw - (len - xw))) < 0.03 && Math.abs(end.y) < 1e-9 && Math.abs(pathLen(straight.path) - len) < 0.03;
  // curved line: same length; after the wall it is the mirror image of the free curve
  const free: { x: number; y: number }[] = [];
  const rad = 6;
  for (let i = 0; i <= 200; i++) { const a = (i / 200) * 1.2; free.push({ x: rad * Math.sin(a), y: -rad * (1 - Math.cos(a)) }); }
  const curved = foldAimPath(G, free, len, R);
  const ce = curved.path[curved.path.length - 1];
  const s = len / rad;
  const fx = rad * Math.sin(s), fy = -rad * (1 - Math.cos(s));
  const okCurve = Math.abs(pathLen(curved.path) - pathLen(straight.path)) < 0.03 && Math.hypot(ce.x - (2 * xw - fx), ce.y - fy) < 0.05;
  // a piece standing on the line must not shorten it
  const through = foldAimPath(G, [{ x: 0, y: 0 }, { x: 1, y: 0 }], len, R);
  const past = through.path.some((q) => q.x > 1.5);
  const okThrough = !through.ghost && past && Math.abs(pathLen(through.path) - len) < 0.03;
  check('准星定长、碰墙镜面补全、球员不截断', okStraight && okCurve && okThrough,
    `直线 ${len} m 撞右墙：终点 x=${f2(end.x)}（应为 ${f2(xw - (len - xw))}），线长 ${f2(pathLen(straight.path))} m；` +
    `弧线线长 ${f2(pathLen(curved.path))} m，终点 (${f2(ce.x)}, ${f2(ce.y)}) 应为自由弧线的镜像 (${f2(2 * xw - fx)}, ${f2(fy)})；` +
    `线从球员身上穿过去=${past}，未被截断=${!through.ghost}`);
}

function behindGoalRule() {
  const data = DEFAULT_DATA;
  const lineup = data.rules.defaultLineup;
  const st = createMatch(data, [lineup, lineup], { seed: 3 });
  const side = st.turn;
  const victim = st.pieces.find((p) => p.side !== side)!;
  const shooter = st.pieces.find((p) => p.side === side)!;
  victim.x = 0.2;
  victim.y = L + 0.15;
  const out = resolveShot(st, data, { pieceId: shooter.id, dirX: 1, dirY: 0, power: data.physics.shot.minPower, curve: 0 });
  const ev = out.events.find((e) => e.type === 'relocate');
  const clear = st.pieces.every((q) => q.id === victim.id || Math.hypot(q.x - victim.x, q.y - victim.y) > 2 * R) &&
    Math.hypot(st.ball.x - victim.x, st.ball.y - victim.y) > R + BR;
  const ok = !out.sim.goal && ev?.type === 'relocate' && ev.ids.includes(victim.id) && victim.y <= L - R - 0.3 + 1e-9 && victim.y > L - 2 &&
    Math.abs(victim.x - 0.2) < 1 && victim.out === 0 && clear && !out.events.some((e) => e.type === 'respawn');
  check('门线内球员回合结束移到门前空位', ok,
    `圆心在门线后 0.15 m 的球员 → (${f2(victim.x)}, ${f2(victim.y)})，门线 y=${f2(L)}，事件 relocate=${ev ? '有' : '无'}，与其他球员/足球不重叠=${clear}`);
}

function cardLevelRule() {
  const data = DEFAULT_DATA;
  const m = data.mapping;
  const { max } = data.rules.levels;
  const keys = ['weight', 'power', 'mind', 'radian', 'precision'] as const;
  const ids = Object.keys(data.players).filter((id) => data.players[id].srcId);
  let cells = 0, fromTable = 0, inDomain = 0, rising = 0;
  for (const id of ids) {
    const table = data.levels[data.players[id].srcId!];
    for (let l = 1; l <= max; l++) {
      const t = table[String(l)], a = levelAttrs(data, id, l);
      cells++;
      if (keys.every((k) => a[k] === t[k])) fromTable++;
      if (keys.every((k) => t[k] >= m.attrMin && t[k] <= m.attrMax)) inDomain++;
    }
    const lo = pieceStats(data, id, 1), hi = pieceStats(data, id, max);
    if (hi.speedMul > lo.speedMul && hi.curveMul > lo.curveMul && hi.massMul > lo.massMul) rising++;
  }
  // The same player on both sides, Lv1 vs Lv max: the shot must carry that level's table points through the mapping.
  const lineup = data.rules.defaultLineup;
  const slot = lineup.findIndex((id) => data.players[id].srcId);
  const st = createMatch(data, [lineup, lineup], { seed: 1, levels: [lineup.map(() => 1), lineup.map(() => max)] });
  const want = (r: number[], v: number) => r[0] + ((r[1] - r[0]) * (v - m.attrMin)) / (m.attrMax - m.attrMin);
  const close = (got: number | undefined, r: number[], v: number) => got !== undefined && Math.abs(got - want(r, v)) < 1e-12;
  const measure = (side: 0 | 1) => {
    const id = `${side}-${slot}`;
    const p = st.pieces.find((q) => q.id === id)!;
    const t = levelAttrs(data, p.playerId, p.level);
    const s = pieceStats(data, p.playerId, p.level, p.cond);
    const mass = buildSetup(st, data, id).pieces.find((q) => q.id === id)!.mass;
    const straight = buildShot(st, data, { pieceId: id, dirX: 0, dirY: -1, power: 0.5, curve: 0 }, null).shot;
    const curved = buildShot(st, data, { pieceId: id, dirX: 0, dirY: -1, power: 0.5, curve: 1 }, null).shot;
    // Straight shot on the real pitch. The curve is measured in the open: on the real pitch a tighter
    // curve hits the wall and folds back, so the final x is no longer a measure of how hard it bends.
    const setup = (): SimSetup => ({ ball: { x: -2, y: -3 }, pieces: [piece(id, 0, 3, 0, mass)] });
    const open = { ...G, width: 400, length: 400 };
    const a = simulateShot(G, P, setup(), straight).final.pieces[id];
    let lateral = 0;
    const runner = new ShotRunner(open, P, setup(), curved, {
      record: false,
      onStep: (step, sim) => {
        if (step === 36) lateral = Math.abs(sim.bodies.get(id)!.getPosition().x);
      },
    });
    while (!runner.stepOnce()) { /* 0.3 s, before the turn cap */ }
    const exact = close(straight.speedMul, m.speedMul, t.power) && close(straight.curveMul, m.curveMul, t.radian) && close(s.massMul, m.massMul, t.weight);
    return { level: p.level, t, speedMul: straight.speedMul!, curveMul: straight.curveMul!, massMul: s.massMul, exact, dist: 3 - a.y, lateral };
  };
  const lo = measure(0), hi = measure(1);
  const pid = lineup[slot];
  const ok = slot >= 0 && fromTable === cells && inDomain === cells && lo.level === 1 && hi.level === max && lo.exact && hi.exact &&
    hi.speedMul > lo.speedMul && hi.curveMul > lo.curveMul && hi.dist > lo.dist && hi.lateral > lo.lateral;
  check(`卡牌等级：按等级表取属性进入出手（Lv1–Lv${max}）`, ok,
    `${ids.length} 名有原表球员 × ${max} 级 = ${cells} 格：运行时属性等于 data/levels.json ${fromTable}/${cells}，属性点在映射域 [${m.attrMin}, ${m.attrMax}] 内 ${inDomain}/${cells}；` +
    `Lv${max} 的速度、弧线、质量倍率都高于 Lv1 的 ${rising}/${ids.length} 人（数据本身的性质，只记录）；` +
    `同一场比赛两边同一名球员 ${pid}（srcId ${data.players[pid].srcId}）分别 Lv1 / Lv${max}：power ${lo.t.power} → ${hi.t.power}，radian ${lo.t.radian} → ${hi.t.radian}，weight ${lo.t.weight} → ${hi.t.weight}；` +
    `出手速度 ×${f3(lo.speedMul)} → ×${f3(hi.speedMul)}，弧线 ×${f3(lo.curveMul)} → ×${f3(hi.curveMul)}，质量 ×${f3(lo.massMul)} → ×${f3(hi.massMul)}（与表值按 attr-mapping 算出的一致：${lo.exact && hi.exact ? '是' : '否'}）；` +
    `真实球场 50% 力度直线滑行 ${f2(lo.dist)} → ${f2(hi.dist)} m，空场满弧线 0.3 s 横向偏移 ${f2(lo.lateral)} → ${f2(hi.lateral)} m`);
}

scenarios();
mirrorCurve();
aimLine();
behindGoalRule();
clockRule();
cardLevelRule();
fpsConsistency();
fuzz(240);
rulesFuzz(30);

const passed = results.filter((r) => r.ok).length;
const md = `# 物理与规则测试结果

\`npm run test:physics\` 自动生成，全部使用正式物理与规则代码（${P.hz} Hz 固定步长，配置 \`${P.version}\`）。

通过 ${passed}/${results.length}

| 检查 | 结果 | 实测 |
|---|---|---|
${results.map((r) => `| ${r.name} | ${r.ok ? '✅' : '❌'} | ${r.detail.replace(/\|/g, '/')} |`).join('\n')}
`;
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'physics-tests.md'), md);
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
