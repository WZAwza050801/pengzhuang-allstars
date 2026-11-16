/**
 * Automatic feel calibration. Every number reported here is measured from the real ShotRunner
 * (same code the server uses). Bounded random search + local refinement, fixed seed, fixed budget.
 *
 *   npm run calibrate            -> search, write data/physics.json + docs/calibration.{md,json}
 *   npm run calibrate -- --check -> only measure the current data/physics.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DATA, type PhysicsConfig, type FieldGeometry } from '../shared/data';
import { ShotRunner, simulateShot, type SimSetup } from '../shared/physics';
import { levelAttrs, pieceStats } from '../shared/match';
import { makeRng } from '../shared/rng';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEOM = DEFAULT_DATA.geometry;
const FIELD_L = GEOM.length;
const OPEN: FieldGeometry = { ...GEOM, width: 400, length: 400 };
const FAR = { x: 150, y: 150 };

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

export const TARGETS = {
  d25: { lo: 0.22, hi: 0.33, unit: 'L', desc: '25% 力度空场滑行距离（出手速度 +20% 后）' },
  d50: { lo: 0.48, hi: 0.68, unit: 'L', desc: '50% 力度空场滑行距离（出手速度 +20% 后）' },
  d100: { lo: 1.05, hi: 1.35, unit: 'L', desc: '满力空场滑行距离（出手速度 +20% 后）' },
  t100: { lo: 2.0, hi: 3.0, unit: 's', desc: '满力自然停止时间' },
  tail: { lo: 0, hi: 0.35, unit: 's', desc: '满力收尾：速度低于 0.25 m/s 后到停下的时间（防微抖拖尾）' },
  lastDrop: { lo: 0, hi: 0.06, unit: 'm/s', desc: '停下前最后一步的速度跳变（防突然刹停）' },
  ballD: { lo: 1.15, hi: 1.6, unit: 'L', desc: '满力正撞后足球滑行距离（足球更轻、滚得更远；出手速度 +20% 后）' },
  ballT: { lo: 2.5, hi: 4.0, unit: 's', desc: '满力正撞后足球停止时间' },
  curveLat: { lo: 8.2, hi: 10.0, unit: 'm', desc: '满力满弧线横向偏移（普通球员；曲率半径收到原先的 1/3，角速度 1.98 rad/s）' },
  curveLatHalf: { lo: 3.4, hi: 4.8, unit: 'm', desc: '50% 力度满弧线横向偏移（曲率半径收到原先的 1/3）' },
};

interface FreeRun { dist: number; time: number; tail: number; lastDrop: number }

function freeRun(phys: PhysicsConfig, power: number, speedMul = 1): FreeRun {
  const setup: SimSetup = { ball: FAR, pieces: [{ id: 's', side: 0, x: 0, y: 0, mass: phys.disc.mass }] };
  let below = -1, prev = 0, lastDrop = 0;
  const r = new ShotRunner(OPEN, phys, setup, { pieceId: 's', dirX: 0, dirY: -1, power, curve: 0, speedMul }, {
    record: false,
    onStep: (step, sim) => {
      const s = sim.speedOf('s');
      if (s < 0.25 && below < 0 && s > 0) below = step;
      if (s === 0 && prev > 0) lastDrop = prev;
      prev = s;
    },
  });
  while (!r.stepOnce()) { /* run */ }
  if (prev > 0) lastDrop = prev;
  const f = r.result().final.pieces.s;
  const dt = 1 / phys.hz;
  return { dist: Math.hypot(f.x, f.y), time: r.t, tail: below < 0 ? 0 : (r.step - below) * dt, lastDrop };
}

/** Disc at full power hits a resting ball dead-centre from 1 m away. */
function headOn(phys: PhysicsConfig, power = 1, discMass = phys.disc.mass) {
  const setup: SimSetup = { ball: { x: 0, y: -1 }, pieces: [{ id: 's', side: 0, x: 0, y: 0, mass: discMass }] };
  let vDiscBefore = 0, vDiscAfter = -1, vBallAfter = -1, hitStep = -1;
  const r = new ShotRunner(OPEN, phys, setup, { pieceId: 's', dirX: 0, dirY: -1, power, curve: 0 }, {
    record: false,
    onStep: (step, sim) => {
      if (hitStep < 0) {
        if (sim.speedOf('ball') > 0) {
          hitStep = step;
          vDiscAfter = sim.speedOf('s');
          vBallAfter = sim.speedOf('ball');
        } else vDiscBefore = sim.speedOf('s');
      }
    },
  });
  while (!r.stepOnce()) { /* run */ }
  const res = r.result();
  const b = res.final.ball;
  const hitT = hitStep / phys.hz;
  return {
    vDiscBefore, vDiscAfter, vBallAfter,
    ballRatio: vBallAfter / vDiscBefore,
    discRatio: vDiscAfter / vDiscBefore,
    ballDist: Math.hypot(b.x - 0, b.y + 1),
    ballTime: res.duration - hitT,
  };
}

/** 45° shot into the right side wall at 60% power on the real pitch. */
function obliqueWall(phys: PhysicsConfig) {
  const setup: SimSetup = { ball: { x: -2.5, y: 4.2 }, pieces: [{ id: 's', side: 0, x: 1.6, y: 1.0, mass: phys.disc.mass }] };
  let before: { x: number; y: number } | null = null, after: { x: number; y: number } | null = null, wallStep = -1;
  let lastV = { x: 0, y: 0 };
  const r = new ShotRunner(GEOM, phys, setup, { pieceId: 's', dirX: 1, dirY: -1, power: 0.6, curve: 0 }, {
    record: false,
    onStep: (step, sim) => {
      const v = sim.bodies.get('s')!.getLinearVelocity();
      if (wallStep < 0 && v.x < 0) { wallStep = step; before = lastV; after = { x: v.x, y: v.y }; }
      lastV = { x: v.x, y: v.y };
    },
  });
  while (!r.stepOnce()) { /* run */ }
  const b = before as unknown as { x: number; y: number } | null;
  const a = after as unknown as { x: number; y: number } | null;
  if (!a || !b) return { inDeg: NaN, outDeg: NaN, speedRatio: NaN, energyRatio: NaN };
  const sb = Math.hypot(b.x, b.y), sa = Math.hypot(a.x, a.y);
  return {
    inDeg: (Math.atan2(Math.abs(b.y), Math.abs(b.x)) * 180) / Math.PI,
    outDeg: (Math.atan2(Math.abs(a.y), Math.abs(a.x)) * 180) / Math.PI,
    speedRatio: sa / sb,
    energyRatio: (sa * sa) / (sb * sb),
  };
}

/** Lateral deflection of a full-power full-curve shot on the open field. */
function curveRun(phys: PhysicsConfig, curve: number, curveMul = 1, power = 1) {
  const setup: SimSetup = { ball: FAR, pieces: [{ id: 's', side: 0, x: 0, y: 0, mass: phys.disc.mass }] };
  const res = simulateShot(OPEN, phys, setup, { pieceId: 's', dirX: 0, dirY: -1, power, curve, curveMul }, { record: false });
  const f = res.final.pieces.s;
  return { lateral: f.x, forward: -f.y };
}

/** Disc (or ball) driven diagonally into the top-right corner spring. */
function springRun(phys: PhysicsConfig, power: number, who: 'disc' | 'ball' = 'disc') {
  const W = GEOM.width / 2, L = GEOM.length / 2;
  const sx = W - 1.6, sy = -L + 1.6;
  const pieces: SimSetup['pieces'] = [{ id: 's', side: 0, x: who === 'disc' ? sx : -2, y: who === 'disc' ? sy : 3, mass: phys.disc.mass }];
  const ball = who === 'ball' ? { x: sx + 0.5, y: sy - 0.5 } : { x: -2, y: 3.5 };
  if (who === 'ball') { pieces[0].x = sx; pieces[0].y = sy; }
  const id = who === 'disc' ? 's' : 'ball';
  let before = 0, after = -1, prev = 0, kicked = false;
  const r = new ShotRunner(GEOM, phys, { ball, pieces }, { pieceId: 's', dirX: 1, dirY: -1, power, curve: 0 }, {
    record: false,
    onStep: (_s, sim) => {
      const v = sim.speedOf(id);
      if (after < 0) {
        const vel = sim.bodies.get(id)!.getLinearVelocity();
        if (vel.x < 0) { before = prev; after = v; kicked = sim.kicksThisStep > 0; }
      }
      prev = v;
    },
  });
  while (!r.stepOnce()) { /* run */ }
  return { before, after, ratio: after / before, energyRatio: (after * after) / (before * before), kicked };
}

function norm(v: number, t: { lo: number; hi: number }) {
  const mid = (t.lo + t.hi) / 2, half = (t.hi - t.lo) / 2 || 0.05;
  const z = (v - mid) / half;
  const outside = v < t.lo || v > t.hi ? 4 : 0;
  return z * z * 0.25 + outside * (Math.abs(z) - 1 + 1);
}

function discLoss(phys: PhysicsConfig) {
  const a = freeRun(phys, 0.25), b = freeRun(phys, 0.5), c = freeRun(phys, 1);
  let loss = norm(a.dist / FIELD_L, TARGETS.d25) + norm(b.dist / FIELD_L, TARGETS.d50) + norm(c.dist / FIELD_L, TARGETS.d100) + norm(c.time, TARGETS.t100);
  if (c.tail > TARGETS.tail.hi) loss += 4 * (c.tail - TARGETS.tail.hi) / 0.1;
  if (!(a.time < b.time && b.time < c.time)) loss += 10;
  return { loss, a, b, c };
}

function ballLoss(phys: PhysicsConfig) {
  const h = headOn(phys);
  return { loss: norm(h.ballDist / FIELD_L, TARGETS.ballD) + norm(h.ballTime, TARGETS.ballT), h };
}

type Knob = { get: (p: PhysicsConfig) => number; set: (p: PhysicsConfig, v: number) => void; lo: number; hi: number; name: string };
const DISC_KNOBS: Knob[] = [
  { name: 'disc.linDamp', get: (p) => p.disc.linDamp, set: (p, v) => (p.disc.linDamp = v), lo: 0.1, hi: 2.0 },
  { name: 'disc.coulomb', get: (p) => p.disc.coulomb, set: (p, v) => (p.disc.coulomb = v), lo: 0.3, hi: 3.0 },
  { name: 'shot.vmax', get: (p) => p.shot.vmax, set: (p, v) => (p.shot.vmax = v), lo: 5, hi: 16 },
  { name: 'shot.gamma', get: (p) => p.shot.gamma, set: (p, v) => (p.shot.gamma = v), lo: 0.55, hi: 1.25 },
];
const CURVE_KNOBS: Knob[] = [
  { name: 'curve.turnRate', get: (p) => p.curve.turnRate, set: (p, v) => (p.curve.turnRate = v), lo: 0.2, hi: 3 },
  { name: 'curve.maxTurnDeg', get: (p) => p.curve.maxTurnDeg, set: (p, v) => (p.curve.maxTurnDeg = v), lo: 45, hi: 120 },
];

function curveLoss(p: PhysicsConfig) {
  return norm(Math.abs(curveRun(p, 1).lateral), TARGETS.curveLat) + norm(Math.abs(curveRun(p, 1, 1, 0.5).lateral), TARGETS.curveLatHalf);
}
const BALL_KNOBS: Knob[] = [
  { name: 'ball.linDamp', get: (p) => p.ball.linDamp, set: (p, v) => (p.ball.linDamp = v), lo: 0.05, hi: 1.5 },
  { name: 'ball.coulomb', get: (p) => p.ball.coulomb, set: (p, v) => (p.ball.coulomb = v), lo: 0.1, hi: 2.0 },
];

function search(base: PhysicsConfig, knobs: Knob[], lossFn: (p: PhysicsConfig) => number, budget: number, seed: number) {
  const rng = makeRng(seed);
  let best = clone(base), bestLoss = lossFn(best), evals = 1;
  const randomPhase = Math.floor(budget * 0.6);
  for (; evals < randomPhase; evals++) {
    const c = clone(base);
    for (const k of knobs) k.set(c, k.lo + (k.hi - k.lo) * rng.next());
    const l = lossFn(c);
    if (l < bestLoss) { best = c; bestLoss = l; }
  }
  let scale = 0.15;
  for (; evals < budget; evals++) {
    const c = clone(best);
    for (const k of knobs) {
      const span = (k.hi - k.lo) * scale;
      k.set(c, Math.min(k.hi, Math.max(k.lo, k.get(c) + (rng.next() * 2 - 1) * span)));
    }
    const l = lossFn(c);
    if (l < bestLoss) { best = c; bestLoss = l; } else scale = Math.max(0.01, scale * 0.985);
  }
  for (const k of knobs) k.set(best, Math.round(k.get(best) * 1000) / 1000);
  return { best, bestLoss: lossFn(best), evals };
}

export function measureAll(phys: PhysicsConfig) {
  const d = discLoss(phys);
  const h = headOn(phys);
  const w = obliqueWall(phys);
  const m = DEFAULT_DATA.mapping;
  const heavy = headOn(phys, 1, phys.disc.mass * m.massMul[1]);
  const light = headOn(phys, 1, phys.disc.mass * m.massMul[0]);
  const fast = freeRun(phys, 1, m.speedMul[1]);
  const slow = freeRun(phys, 1, m.speedMul[0]);
  const curveMid = curveRun(phys, 1, 1);
  const curveMax = curveRun(phys, 1, m.curveMul[1] * 2.0);
  const curveMin = curveRun(phys, 1, m.curveMul[0]);
  const curveHalfPow = curveRun(phys, 1, 1, 0.5);
  const springSlow = springRun(phys, 0.3), springFast = springRun(phys, 1), springBall = springRun(phys, 0.6, 'ball');
  return {
    d25: d.a.dist / FIELD_L, d50: d.b.dist / FIELD_L, d100: d.c.dist / FIELD_L,
    t25: d.a.time, t50: d.b.time, t100: d.c.time,
    tail: d.c.tail, lastDrop: d.c.lastDrop,
    ballD: h.ballDist / FIELD_L, ballT: h.ballTime,
    curveLat: Math.abs(curveMid.lateral),
    curveLatHalf: Math.abs(curveHalfPow.lateral),
    spring: { slow: springSlow, fast: springFast, ball: springBall },
    headOn: h, headOnHeavy: heavy, headOnLight: light,
    wall: w,
    speedSpread: { fastD100: fast.dist / FIELD_L, slowD100: slow.dist / FIELD_L },
    curve: { mid: curveMid, max: curveMax, min: curveMin, halfPower: curveHalfPow },
  };
}

/**
 * The card-level table (data/levels.json) through the attribute mapping (data/attr-mapping.json). For the players
 * with a source table: lowest / median / highest points at a few levels and what they do to a real shot.
 */
export function measureLevels(phys: PhysicsConfig) {
  const data = DEFAULT_DATA;
  const ids = Object.keys(data.players).filter((id) => data.players[id].srcId);
  const { max, uniformLevel } = data.rules.levels;
  const spread = (vals: number[]) => {
    const s = [...vals].sort((a, b) => a - b);
    return [s[0], s[Math.floor((s.length - 1) / 2)], s[s.length - 1]];
  };
  const rows = [...new Set([1, uniformLevel, max])].map((level) => {
    const pts = ids.map((id) => levelAttrs(data, id, level));
    const st = ids.map((id) => pieceStats(data, id, level));
    const speedMul = spread(st.map((s) => s.speedMul));
    const curveMul = spread(st.map((s) => s.curveMul));
    const massMul = spread(st.map((s) => s.massMul));
    return {
      level,
      weight: spread(pts.map((a) => a.weight)), power: spread(pts.map((a) => a.power)), radian: spread(pts.map((a) => a.radian)),
      precision: spread(pts.map((a) => a.precision)), mind: spread(pts.map((a) => a.mind)),
      speedMul, curveMul, massMul, aimAssist: spread(st.map((s) => s.aimAssist)),
      d100: speedMul.map((v) => freeRun(phys, 1, v).dist / FIELD_L),
      curveLat: curveMul.map((v) => Math.abs(curveRun(phys, 1, v).lateral)),
      ballRatio: massMul.map((v) => headOn(phys, 1, phys.disc.mass * v).ballRatio),
    };
  });
  return { players: ids.length, rebuilt: Object.keys(data.players).length - ids.length, rows };
}

function fmt(v: number, d = 3) { return Number.isFinite(v) ? v.toFixed(d) : String(v); }

function report(phys: PhysicsConfig, meta: Record<string, unknown>) {
  const m = measureAll(phys);
  const lv = measureLevels(phys);
  const map = DEFAULT_DATA.mapping;
  const span = (v: number[], d = 3, pre = '') => v.map((x) => pre + fmt(x, d)).join(' / ');
  const lvRows = lv.rows.flatMap((r) => [
    `| Lv${r.level} | power → 出手速度 | ${r.power.join(' / ')} | ${span(r.speedMul, 3, '×')} | 满力空场滑行 ${span(r.d100)} L |`,
    `| | radian → 弧线 | ${r.radian.join(' / ')} | ${span(r.curveMul, 3, '×')} | 满力满弧线横向偏移 ${span(r.curveLat, 2)} m |`,
    `| | weight → 质量 | ${r.weight.join(' / ')} | ${span(r.massMul, 3, '×')} | 满力正撞，足球速度 ${span(r.ballRatio, 2, '×')} |`,
    `| | precision → 预测线 | ${r.precision.join(' / ')} | ${span(r.aimAssist, 3, '×')} | 预测线显示路线的比例（客户端，不进物理） |`,
    `| | mind → 状态 | ${r.mind.join(' / ')} | — | 只用于状态模式（默认关闭） |`,
  ]);
  const rows = (Object.keys(TARGETS) as (keyof typeof TARGETS)[]).map((k) => {
    const t = TARGETS[k];
    const v = (m as unknown as Record<string, number>)[k];
    const ok = v >= t.lo - 1e-9 && v <= t.hi + 1e-9;
    return `| ${t.desc} | ${t.lo}–${t.hi} ${t.unit} | ${fmt(v)} ${t.unit} | ${ok ? '✅' : '❌'} |`;
  });
  const md = `# 物理校准报告

自动生成：\`npm run calibrate\`。所有实测值来自正式物理代码（shared/physics.ts 的 ShotRunner，${phys.hz} Hz 固定步长），
不是解析公式。目标值是原型设计标准（用户给定的建议目标），**不是原版实测数据**。距离单位 L = 虚拟球场长度 ${FIELD_L} m。

配置版本：\`${phys.version}\`　搜索：${JSON.stringify(meta)}

## 目标 vs 实测（普通球员，随机技能关闭）

| 场景 | 目标 | 实测 | 结果 |
|---|---|---|---|
${rows.join('\n')}
| 25% / 50% 力度停止时间 | 小力度更快停止 | ${fmt(m.t25, 2)} s / ${fmt(m.t50, 2)} s（满力 ${fmt(m.t100, 2)} s） | ${m.t25 < m.t50 && m.t50 < m.t100 ? '✅' : '❌'} |

## 碰撞

| 场景 | 实测 | 判定 |
|---|---|---|
| 正面撞足球（满力） | 撞前球员 ${fmt(m.headOn.vDiscBefore, 2)} m/s → 球员 ${fmt(m.headOn.vDiscAfter, 2)} m/s（×${fmt(m.headOn.discRatio, 2)}），足球 ${fmt(m.headOn.vBallAfter, 2)} m/s（×${fmt(m.headOn.ballRatio, 2)}） | ${m.headOn.ballRatio > 1.05 && m.headOn.discRatio < 0.7 ? '✅ 足球明显向前、球员减速、球更轻' : '❌'} |
| 重球员（质量×${DEFAULT_DATA.mapping.massMul[1]}）正撞 | 足球 ×${fmt(m.headOnHeavy.ballRatio, 2)}，球员保留 ×${fmt(m.headOnHeavy.discRatio, 2)} | 重的撞球更远、自己减速更少 |
| 轻球员（质量×${DEFAULT_DATA.mapping.massMul[0]}）正撞 | 足球 ×${fmt(m.headOnLight.ballRatio, 2)}，球员保留 ×${fmt(m.headOnLight.discRatio, 2)} | |
| 45° 斜撞边墙（60% 力度） | 入射 ${fmt(m.wall.inDeg, 1)}°，出射 ${fmt(m.wall.outDeg, 1)}°（与法线夹角），速度 ×${fmt(m.wall.speedRatio, 2)}，动能 ×${fmt(m.wall.energyRatio, 2)} | ${m.wall.energyRatio < 1 ? '✅ 未增加能量' : '❌ 能量增加'} |
| 球员撞角落弹簧（30% 力度） | ${fmt(m.spring.slow.before, 2)} m/s → ${fmt(m.spring.slow.after, 2)} m/s（×${fmt(m.spring.slow.ratio, 2)}） | ${m.spring.slow.kicked && m.spring.slow.ratio > 1 ? '✅ 弹簧加力弹出' : '❌'} |
| 球员撞角落弹簧（满力） | ${fmt(m.spring.fast.before, 2)} m/s → ${fmt(m.spring.fast.after, 2)} m/s（上限 ${phys.spring.maxSpeed} m/s） | ${m.spring.fast.kicked && m.spring.fast.after <= phys.spring.maxSpeed + 1e-6 ? '✅ 有上限' : '❌'} |
| 足球撞角落（60% 力度出手撞球） | ${fmt(m.spring.ball.before, 2)} m/s → ${fmt(m.spring.ball.after, 2)} m/s，动能 ×${fmt(m.spring.ball.energyRatio, 2)} | ${!m.spring.ball.kicked && m.spring.ball.energyRatio < 1 ? '✅ 与普通墙相同，不加能量' : '❌'} |

## 球员差异（属性映射范围的两端）

| 因素 | 实测 |
|---|---|
| 力量最高/最低的满力距离 | ${fmt(m.speedSpread.fastD100)} L / ${fmt(m.speedSpread.slowD100)} L |
| 弧线：满力满弧线（普通球员） | 横向偏移 ${fmt(m.curve.mid.lateral, 2)} m，前进 ${fmt(m.curve.mid.forward, 2)} m |
| 弧线：最高弧线属性 × 弧线技能×2 | 横向偏移 ${fmt(m.curve.max.lateral, 2)} m，前进 ${fmt(m.curve.max.forward, 2)} m（受最大转角 ${phys.curve.maxTurnDeg}° 限制） |
| 弧线：最低弧线属性 | 横向偏移 ${fmt(m.curve.min.lateral, 2)} m |
| 弧线：50% 力度满弧线 | 横向偏移 ${fmt(m.curve.halfPower.lateral, 2)} m |

弧线模型：出手后球员的朝向按固定角速度 ${phys.curve.turnRate} rad/s 旋转（最多 ${phys.curve.maxTurnDeg}°），速度大小不变；撞墙或角落弹簧后按镜面继续拐（转向反号），碰到球员、足球、门柱或球网后弧线消失。
快的时候几乎走直线，越慢拐得越明显，形成“先直后拐”的弧线球轨迹。

角落弹簧：只对球员生效。碰撞后沿弹簧法线额外加 ${phys.spring.boost} m/s（恢复系数 ${phys.spring.restitution}，接近速度低于 ${phys.spring.minSpeed} m/s 不触发，弹出速度上限 ${phys.spring.maxSpeed} m/s）。足球撞角落按普通墙处理。

## 等级属性 → 物理（data/levels.json × data/attr-mapping.json）

属性点不是物理单位：weight 不是 kg，power 不是 N，radian 不是角度，precision 不是命中率。映射 \`${map.version}\`：属性点按 [${map.attrMin}, ${map.attrMax}]（等级表全部行的实测最小 / 最大值）线性归一到 0–1，
再在上一节的倍率区间内线性插值；倍率区间是重建设计值，不是原版公式（材料包没有原版的属性点 → 物理量公式）。

有原表的 ${lv.players} 名球员（1.5.5 基础卡）在 Lv1 / Lv${DEFAULT_DATA.rules.levels.uniformLevel}（默认等级）/ Lv${DEFAULT_DATA.rules.levels.max} 的最低 / 中位 / 最高；
物理量用正式 ShotRunner 在空场实测。另外 ${lv.rebuilt} 名重建球员（srcId 为空）没有原表，仍按 players.json 的 attrs + growth 估算（上限 ${map.attrMax}），不在表内。

| 等级 | 属性 → 作用 | 属性点 | 倍率 | 实测 |
|---|---|---|---|---|
${lvRows.join('\n')}

## 当前参数

\`\`\`json
${JSON.stringify(phys, null, 2)}
\`\`\`
`;
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'calibration.md'), md);
  fs.writeFileSync(path.join(ROOT, 'docs', 'calibration.json'), JSON.stringify({ meta, targets: TARGETS, measured: m, levels: lv, physics: phys }, null, 2));
  return { m, md };
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const base = clone(DEFAULT_DATA.physics);
  if (checkOnly) {
    const { md } = report(base, { mode: 'check' });
    console.log(md);
    return;
  }
  const t0 = Date.now();
  // --curve: keep the approved slide/collision feel and only re-tune the curve.
  const curveOnly = process.argv.includes('--curve');
  const disc = curveOnly ? { best: base, evals: 0, bestLoss: discLoss(base).loss } : search(base, DISC_KNOBS, (p) => discLoss(p).loss, 500, 20161029);
  const ball = curveOnly ? { best: base, evals: 0, bestLoss: ballLoss(base).loss } : search(disc.best, BALL_KNOBS, (p) => ballLoss(p).loss, 200, 20170117);
  const curve = search(ball.best, CURVE_KNOBS, curveLoss, 160, 20180614);
  const best = curve.best;
  best.version = 'phys-4';
  const meta = {
    mode: curveOnly ? 'curve' : 'full',
    discEvals: disc.evals, discLoss: +disc.bestLoss.toFixed(4),
    ballEvals: ball.evals, ballLoss: +ball.bestLoss.toFixed(4),
    curveEvals: curve.evals, curveLoss: +curve.bestLoss.toFixed(4),
    seed: [20161029, 20170117, 20180614],
    seconds: +((Date.now() - t0) / 1000).toFixed(1),
  };
  fs.writeFileSync(path.join(ROOT, 'data', 'physics.json'), JSON.stringify(best, null, 2) + '\n');
  const { md } = report(best, meta);
  console.log(md);
}

main();
