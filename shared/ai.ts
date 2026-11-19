import type { GameData } from './data';
import { buildSetup, buildShot, validateShot, type MatchState, type ShotInput } from './match';
import { simulateShot, type SimResult, type Side } from './physics';
import { makeRng } from './rng';

export type AiLevel = 'easy' | 'normal' | 'hard';

export interface AiSearchStats {
  evaluated: number; elapsedMs: number; reason: 'complete' | 'budget' | 'evaluations' | 'cancelled' | 'no-move' | 'ended';
}
export interface AiSearchOptions {
  maxEvaluations?: number;
  budgetMs?: number;
  now?: () => number;
  isCancelled?: () => boolean;
  onStats?: (stats: AiSearchStats) => void;
}

/** Constant-work fallback. It never simulates or consumes the authoritative skill RNG. */
export function fallbackShot(st: MatchState, data: GameData): ShotInput | null {
  if (st.over) return null;
  const mine = st.pieces.filter(p => p.side === st.turn && p.out === 0 && p.frozen === 0)
    .sort((a,b) => Math.hypot(a.x-st.ball.x,a.y-st.ball.y)-Math.hypot(b.x-st.ball.x,b.y-st.ball.y));
  if (!mine.length) return null;
  const p=mine[0], dx=st.ball.x-p.x, dy=st.ball.y-p.y, distance=Math.hypot(dx,dy);
  return {pieceId:p.id,dirX:distance>1e-6?dx/distance:0,dirY:distance>1e-6?dy/distance:st.turn===0?-1:1,power:Math.max(.6,data.physics.shot.minPower),curve:0};
}

interface Candidate { input: ShotInput; score: number }

/** Higher is better for `side`. Uses only the simulated outcome, never hidden skill rolls. */
function evaluate(res: SimResult, data: GameData, side: Side, st: MatchState): number {
  const L = data.geometry.length / 2;
  if (res.goal) return res.goal.scoredBy === side ? 1000 - res.goal.t * 10 : -1200;
  const b = res.final.ball;
  const fwd = side === 0 ? -b.y : b.y;
  const oppGoalY = side === 0 ? -L : L;
  const distGoal = Math.hypot(b.x, b.y - oppGoalY);
  let s = fwd * 25 - distGoal * 12;
  // keep the ball away from own goal mouth
  const ownGoalY = -oppGoalY;
  const distOwn = Math.hypot(b.x, b.y - ownGoalY);
  if (distOwn < 2.5) s -= (2.5 - distOwn) * 60;
  // a defender left between ball and own goal is good
  let cover = 0;
  for (const p of st.pieces) {
    if (p.side !== side || p.out > 0) continue;
    const f = res.final.pieces[p.id];
    if (!f) continue;
    const behind = side === 0 ? f.y > b.y : f.y < b.y;
    if (behind && Math.abs(f.x - b.x) < 1.5) cover++;
  }
  s += Math.min(cover, 2) * 8;
  return s;
}

function aimAt(fromX: number, fromY: number, toX: number, toY: number) {
  const dx = toX - fromX, dy = toY - fromY;
  const l = Math.hypot(dx, dy) || 1;
  return { dirX: dx / l, dirY: dy / l };
}

export function chooseShot(st: MatchState, data: GameData, level: AiLevel = 'normal', seed = 1, options: AiSearchOptions = {}): ShotInput | null {
  if (options.maxEvaluations !== undefined && (!Number.isInteger(options.maxEvaluations) || options.maxEvaluations < 0)) throw new RangeError('Invalid AI evaluation limit');
  if (options.budgetMs !== undefined && (!Number.isFinite(options.budgetMs) || options.budgetMs < 0)) throw new RangeError('Invalid AI time budget');
  const now=options.now ?? Date.now, started=now();
  let evaluated=0, reason: AiSearchStats['reason']='complete';
  const finish=(input: ShotInput | null) => { options.onStats?.({evaluated,elapsedMs:Math.max(0,now()-started),reason}); return reason === 'cancelled' ? null : input; };
  const stop=() => {
    if (options.isCancelled?.()) {reason='cancelled';return true;}
    if (evaluated >= (options.maxEvaluations ?? Infinity)) {reason='evaluations';return true;}
    if (options.budgetMs !== undefined && now()-started >= options.budgetMs) {reason='budget';return true;}
    return false;
  };
  if (st.over) {reason='ended';return finish(null);}
  const side = st.turn;
  const rng = makeRng(seed);
  const L = data.geometry.length / 2;
  const R = data.physics.disc.radius, BR = data.physics.ball.radius;
  const oppGoalY = side === 0 ? -L : L;
  const gw = data.geometry.goalWidth / 2;
  const mine = st.pieces.filter((p) => p.side === side && p.out === 0 && p.frozen === 0);
  if (!mine.length) {reason='no-move';return finish(null);}

  const cands: ShotInput[] = [];
  const b = st.ball;
  for (const p of mine) {
    const direct = aimAt(p.x, p.y, b.x, b.y);
    for (const power of [0.35, 0.6, 0.85, 1]) cands.push({ pieceId: p.id, ...direct, power, curve: 0 });
    for (const tx of [0, -gw * 0.6, gw * 0.6]) {
      const toGoal = aimAt(b.x, b.y, tx, oppGoalY);
      const gx = b.x - toGoal.dirX * (R + BR), gy = b.y - toGoal.dirY * (R + BR);
      const aim = aimAt(p.x, p.y, gx, gy);
      for (const power of [0.55, 0.8, 1]) cands.push({ pieceId: p.id, ...aim, power, curve: 0 });
    }
  }

  const run = (input: ShotInput) => {
    const { shot } = buildShot(st, data, input, null);
    const setup = buildSetup(st, data, input.pieceId);
    return evaluate(simulateShot(data.geometry, data.physics, setup, shot, { record: false, maxSeconds: 8 }), data, side, st);
  };
  const scored: Candidate[] = [];
  for (const input of cands) {
    if (stop()) break;
    if (validateShot(st,data,side,input)) continue;
    scored.push({input,score:run(input)}); evaluated++;
  }
  if (!scored.length) return finish(fallbackShot(st,data));
  scored.sort((a, b) => b.score - a.score);

  // refine: curve and small angle tweaks around the best few
  const refineN = level === 'hard' ? 5 : 3;
  refine: for (const c of scored.slice(0, refineN)) {
    for (const curve of [-0.7, -0.35, 0.35, 0.7]) {
      const a = Math.atan2(c.input.dirY, c.input.dirX) - curve * 0.12;
      const input = { ...c.input, dirX: Math.cos(a), dirY: Math.sin(a), curve };
      if (stop()) break refine;
      scored.push({ input, score: run(input) }); evaluated++;
    }
    for (const da of [-0.04, 0.04]) {
      const a = Math.atan2(c.input.dirY, c.input.dirX) + da;
      const input = { ...c.input, dirX: Math.cos(a), dirY: Math.sin(a) };
      if (stop()) break refine;
      scored.push({ input, score: run(input) }); evaluated++;
    }
  }
  scored.sort((a, b) => b.score - a.score);

  let pick = scored[0].input;
  if (level === 'easy') {
    pick = scored[Math.floor(rng.next() * Math.min(5, scored.length))].input;
    const a = Math.atan2(pick.dirY, pick.dirX) + (rng.next() - 0.5) * 0.14;
    pick = { ...pick, dirX: Math.cos(a), dirY: Math.sin(a) };
  } else if (level === 'normal') {
    const a = Math.atan2(pick.dirY, pick.dirX) + (rng.next() - 0.5) * 0.03;
    pick = { ...pick, dirX: Math.cos(a), dirY: Math.sin(a) };
  }
  return finish(pick);
}
