import type { GameData, LevelAttrs, SkillDef } from './data';
import { simulateShot, type SimResult, type SimSetup, type SimShot, type Side } from './physics';
import { nextRandom } from './rng';

export interface PieceState {
  id: string;
  side: Side;
  playerId: string;
  slot: number;
  level: number;
  /** 1 normally, 0.7 when 状态差 (condition mode). */
  cond: number;
  x: number;
  y: number;
  /** Owner turns left off the pitch (0 = on pitch). */
  out: number;
  /** Owner turns left frozen. */
  frozen: number;
  /** Defence skill active for the current shot. */
  anchored: boolean;
  /** Pre-turn skill triggered this turn. */
  ready: boolean;
}

export interface MatchState {
  dataVersion: string;
  rng: number;
  turn: Side;
  shotNo: number;
  score: [number, number];
  pieces: PieceState[];
  ball: { x: number; y: number };
  over: boolean;
  winner: Side | -1;
  endReason: string;
  extraUsed: boolean;
}

export interface ShotInput {
  pieceId: string;
  dirX: number;
  dirY: number;
  power: number;
  curve: number;
}

export type MatchEvent =
  | { type: 'skill'; pieceId: string; skillId: string; name: string; text: string }
  | { type: 'goal'; scoredBy: Side; ownGoal: boolean }
  | { type: 'sendoff'; ids: string[] }
  | { type: 'freeze'; ids: string[] }
  | { type: 'respawn'; id: string }
  | { type: 'relocate'; ids: string[] }
  | { type: 'extra'; side: Side }
  | { type: 'pass'; side: Side; reason: string }
  | { type: 'end'; winner: Side | -1; reason: string };

export interface PieceStats {
  massMul: number;
  speedMul: number;
  curveMul: number;
  aimAssist: number;
  skill: SkillDef | null;
  skillLevel: number;
}

const lerp = (r: number[], t: number) => r[0] + (r[1] - r[0]) * t;

/**
 * Attribute points of a player at a card level. Players with a srcId read the source level table (data/levels.json);
 * the rebuilt players (srcId null) have no table and keep the attrs + growth estimate, capped at attrMax.
 */
export function levelAttrs(data: GameData, playerId: string, level: number): LevelAttrs {
  const def = data.players[playerId];
  if (def.srcId) return data.levels[def.srcId][String(level)];
  const m = data.mapping;
  const a = def.attrs.map((v, i) => Math.min(m.attrMax, v + def.growth[i] * (level - 1)));
  return { weight: a[0], power: a[1], mind: a[4], radian: a[2], precision: a[3] };
}

export function pieceStats(data: GameData, playerId: string, level: number, cond = 1): PieceStats {
  const def = data.players[playerId];
  const m = data.mapping;
  const a = levelAttrs(data, playerId, level);
  const n = (v: number) => Math.max(0, Math.min(1, (v * cond - m.attrMin) / (m.attrMax - m.attrMin)));
  const skill = data.skills[def.skill] ?? null;
  const at = data.rules.levels.skillLevelAt;
  let skillLevel = 0;
  for (let i = 0; i < at.length; i++) if (level >= at[i]) skillLevel = i + 1;
  const unlocked = skill && level >= skill.unlockLevel;
  return {
    massMul: lerp(m.massMul, n(a.weight)),
    speedMul: lerp(m.speedMul, n(a.power)),
    curveMul: lerp(m.curveMul, n(a.radian)),
    aimAssist: lerp(m.aimAssist, n(a.precision)),
    skill: unlocked ? skill : null,
    skillLevel: unlocked ? Math.max(1, skillLevel) : 0,
  };
}

export function formationPos(data: GameData, side: Side, slot: number) {
  const f = data.rules.formation[slot];
  return side === 0 ? { x: f.x, y: f.y } : { x: -f.x, y: -f.y };
}

export interface CreateOptions {
  seed: number;
  firstSide?: Side;
  levels?: [number[] | null, number[] | null];
  conditionMode?: boolean;
}

export function createMatch(data: GameData, lineups: [string[], string[]], opts: CreateOptions): MatchState {
  const st: MatchState = {
    dataVersion: data.version,
    rng: opts.seed >>> 0,
    turn: 0,
    shotNo: 0,
    score: [0, 0],
    pieces: [],
    ball: { x: 0, y: 0 },
    over: false,
    winner: -1,
    endReason: '',
    extraUsed: false,
  };
  const rng = { s: st.rng };
  for (const side of [0, 1] as Side[]) {
    lineups[side].forEach((pid, slot) => {
      const level = opts.levels?.[side]?.[slot] ?? data.rules.levels.uniformLevel;
      let cond = 1;
      if (opts.conditionMode) {
        const mental = levelAttrs(data, pid, level).mind;
        const bad = data.rules.condition.badChanceBase * (1 - (mental - 40) / 100);
        if (nextRandom(rng) < bad) cond = 1 - data.rules.condition.badPenalty;
      }
      const pos = formationPos(data, side, slot);
      st.pieces.push({ id: `${side}-${slot}`, side, playerId: pid, slot, level, cond, x: pos.x, y: pos.y, out: 0, frozen: 0, anchored: false, ready: false });
    });
  }
  st.turn = opts.firstSide ?? (nextRandom(rng) < 0.5 ? 0 : 1);
  st.rng = rng.s;
  return st;
}

function prob(skill: SkillDef, level: number) {
  return skill.probability[Math.min(skill.probability.length, Math.max(1, level)) - 1];
}

/** Roll pre-turn skills for the side to move and defence skills for the other side. */
export function beginTurn(st: MatchState, data: GameData): MatchEvent[] {
  const ev: MatchEvent[] = [];
  const rng = { s: st.rng };
  for (const p of st.pieces) {
    p.ready = false;
    p.anchored = false;
    if (p.out > 0) continue;
    const s = pieceStats(data, p.playerId, p.level, p.cond);
    if (!s.skill) continue;
    if (p.side === st.turn && s.skill.trigger === 'preturn' && p.frozen === 0) {
      if (nextRandom(rng) < prob(s.skill, s.skillLevel)) {
        p.ready = true;
        ev.push({ type: 'skill', pieceId: p.id, skillId: s.skill.id, name: s.skill.name, text: s.skill.effectText });
      }
    } else if (p.side !== st.turn && s.skill.trigger === 'defense') {
      if (nextRandom(rng) < prob(s.skill, s.skillLevel)) {
        p.anchored = true;
        ev.push({ type: 'skill', pieceId: p.id, skillId: s.skill.id, name: s.skill.name, text: s.skill.effectText });
      }
    }
  }
  st.rng = rng.s;
  return ev;
}

export function validateShot(st: MatchState, data: GameData, side: Side, input: ShotInput): string | null {
  if (st.over) return 'match-over';
  if (st.turn !== side) return 'not-your-turn';
  const p = st.pieces.find((q) => q.id === input.pieceId);
  if (!p) return 'no-such-piece';
  if (p.side !== side) return 'not-your-piece';
  if (p.out > 0) return 'piece-off-pitch';
  if (p.frozen > 0) return 'piece-frozen';
  const nums = [input.dirX, input.dirY, input.power, input.curve];
  if (!nums.every((v) => typeof v === 'number' && Number.isFinite(v))) return 'bad-number';
  if (Math.hypot(input.dirX, input.dirY) < 1e-6) return 'bad-direction';
  if (input.power < data.physics.shot.minPower - 1e-9 || input.power > 1) return 'bad-power';
  if (input.curve < -1 || input.curve > 1) return 'bad-curve';
  return null;
}

/** Physics inputs for the current position. `shooterId` gets its pre-turn buff if ready. */
export function buildSetup(st: MatchState, data: GameData, shooterId: string | null): SimSetup {
  const auraMul: [number, number] = [1, 1];
  for (const p of st.pieces) {
    if (p.out > 0) continue;
    const s = pieceStats(data, p.playerId, p.level, p.cond);
    if (s.skill?.effect.type === 'halfMassAura' && inOwnHalf(p)) {
      const mm = s.skill.effect.massMul as number[];
      auraMul[p.side] = Math.max(auraMul[p.side], mm[Math.min(mm.length, s.skillLevel) - 1]);
    }
  }
  const pieces = st.pieces
    .filter((p) => p.out === 0)
    .map((p) => {
      const s = pieceStats(data, p.playerId, p.level, p.cond);
      let mass = data.physics.disc.mass * s.massMul;
      if (inOwnHalf(p)) mass *= auraMul[p.side];
      if (p.id === shooterId && p.ready && s.skill?.effect.type === 'shooterBuff') mass *= (s.skill.effect.massMul as number) ?? 1;
      return { id: p.id, side: p.side, x: p.x, y: p.y, mass, fixed: p.frozen > 0 || p.anchored };
    });
  return { ball: { ...st.ball }, pieces };
}

function inOwnHalf(p: { side: Side; y: number }) {
  return p.side === 0 ? p.y > 0 : p.y < 0;
}

/** Shot parameters including the shooter's attributes and any triggered skill. Rolls on-shot skills. */
export function buildShot(st: MatchState, data: GameData, input: ShotInput, rng: { s: number } | null) {
  const p = st.pieces.find((q) => q.id === input.pieceId)!;
  const s = pieceStats(data, p.playerId, p.level, p.cond);
  const shot: SimShot = { ...input, speedMul: s.speedMul, curveMul: s.curveMul, ballBoost: null };
  let onHit: 'sendOffOnHit' | 'freezeOnHit' | null = null;
  let extra = false;
  const sk = s.skill;
  if (sk) {
    if (sk.trigger === 'preturn' && p.ready) {
      if (sk.effect.type === 'shooterBuff') {
        shot.speedMul! *= sk.effect.speedMul ?? 1;
        shot.curveMul! *= sk.effect.curveMul ?? 1;
      } else if (sk.effect.type === 'extraAction') extra = true;
    } else if (sk.trigger === 'onShot' && rng && nextRandom(rng) < prob(sk, s.skillLevel)) {
      if (sk.effect.type === 'ballBoost') shot.ballBoost = { mul: sk.effect.ballSpeedMul ?? 1, requireInBox: !!sk.effect.requireInBox };
      else if (sk.effect.type === 'sendOffOnHit' || sk.effect.type === 'freezeOnHit') onHit = sk.effect.type;
    }
  }
  return { shot, onHit, extra, skill: sk };
}

function freeSpot(st: MatchState, data: GameData, x: number, y: number, selfId: string) {
  const r = data.physics.disc.radius;
  const br = data.physics.ball.radius;
  const ok = (px: number, py: number) =>
    Math.abs(px) <= data.geometry.width / 2 - r && Math.abs(py) <= data.geometry.length / 2 - r - 0.3 &&
    Math.hypot(px - st.ball.x, py - st.ball.y) > r + br + 0.05 &&
    st.pieces.every((q) => q.id === selfId || q.out > 0 || Math.hypot(px - q.x, py - q.y) > 2 * r + 0.05);
  if (ok(x, y)) return { x, y };
  for (let ring = 1; ring < 30; ring++) {
    const rad = ring * 0.15;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      if (ok(px, py)) return { x: px, y: py };
    }
  }
  return { x, y };
}

/** Pieces whose centre ended behind a goal line are moved to the nearest free spot in front of it. */
function relocateBehindGoal(st: MatchState, data: GameData, ev: MatchEvent[]) {
  const r = data.physics.disc.radius;
  const halfW = data.geometry.width / 2, halfL = data.geometry.length / 2;
  const ids: string[] = [];
  for (const p of st.pieces) {
    if (p.out > 0 || Math.abs(p.y) <= halfL) continue;
    const x = Math.max(-(halfW - r), Math.min(halfW - r, p.x));
    const spot = freeSpot(st, data, x, Math.sign(p.y) * (halfL - r - 0.3), p.id);
    p.x = spot.x;
    p.y = spot.y;
    ids.push(p.id);
  }
  if (ids.length) ev.push({ type: 'relocate', ids });
}

export function resetPositions(st: MatchState, data: GameData) {
  st.ball = { x: 0, y: 0 };
  for (const p of st.pieces) {
    const pos = formationPos(data, p.side, p.slot);
    p.x = pos.x;
    p.y = pos.y;
    p.out = 0;
    p.frozen = 0;
    p.anchored = false;
    p.ready = false;
  }
}

/** Status counters tick down at the end of their owner's turn. */
function endOwnerTurn(st: MatchState, data: GameData, side: Side, ev: MatchEvent[]) {
  for (const p of st.pieces) {
    if (p.side !== side) continue;
    if (p.frozen > 0) p.frozen--;
    if (p.out > 0) {
      p.out--;
      if (p.out === 0) {
        const home = formationPos(data, p.side, p.slot);
        const spot = freeSpot(st, data, home.x, home.y, p.id);
        p.x = spot.x;
        p.y = spot.y;
        ev.push({ type: 'respawn', id: p.id });
      }
    }
  }
}

function checkEnd(st: MatchState, data: GameData, ev: MatchEvent[]) {
  const g = data.rules.goalsToWin;
  if (st.score[0] >= g || st.score[1] >= g) {
    st.over = true;
    st.winner = st.score[0] > st.score[1] ? 0 : 1;
    st.endReason = 'goals';
  } else if (st.shotNo >= data.rules.maxShots) {
    st.over = true;
    st.winner = st.score[0] === st.score[1] ? -1 : st.score[0] > st.score[1] ? 0 : 1;
    st.endReason = 'shot-limit';
  }
  if (st.over) ev.push({ type: 'end', winner: st.winner, reason: st.endReason });
}

export interface ShotOutcome {
  sim: SimResult;
  events: MatchEvent[];
  turnEvents: MatchEvent[];
}

/** Authoritative resolution of one validated shot. Mutates `st` and begins the next turn. */
export function resolveShot(st: MatchState, data: GameData, input: ShotInput): ShotOutcome {
  const rng = { s: st.rng };
  const ev: MatchEvent[] = [];
  const side = st.turn;
  const shooter = st.pieces.find((q) => q.id === input.pieceId)!;
  const { shot, onHit, extra, skill } = buildShot(st, data, input, rng);
  st.rng = rng.s;
  const setup = buildSetup(st, data, shooter.id);
  const sim = simulateShot(data.geometry, data.physics, setup, shot);

  for (const p of st.pieces) {
    const f = sim.final.pieces[p.id];
    if (f) {
      p.x = f.x;
      p.y = f.y;
    }
  }
  st.ball = { ...sim.final.ball };
  st.shotNo++;

  if (sim.ballBoosted && skill) ev.push({ type: 'skill', pieceId: shooter.id, skillId: skill.id, name: skill.name, text: skill.effectText });
  if (onHit && skill) {
    const hit = sim.shooterTouched.filter((id) => st.pieces.some((p) => p.id === id && p.side !== side));
    if (hit.length) {
      ev.push({ type: 'skill', pieceId: shooter.id, skillId: skill.id, name: skill.name, text: skill.effectText });
      for (const id of hit) {
        const p = st.pieces.find((q) => q.id === id)!;
        if (onHit === 'sendOffOnHit') p.out = skill.durationTurns;
        else p.frozen = Math.max(p.frozen, skill.durationTurns);
      }
      ev.push(onHit === 'sendOffOnHit' ? { type: 'sendoff', ids: hit } : { type: 'freeze', ids: hit });
    }
  }

  if (sim.goal) {
    st.score[sim.goal.scoredBy]++;
    ev.push({ type: 'goal', scoredBy: sim.goal.scoredBy, ownGoal: sim.goal.scoredBy !== side });
    checkEnd(st, data, ev);
    resetPositions(st, data);
    st.turn = (1 - sim.goal.scoredBy) as Side;
    st.extraUsed = false;
  } else {
    relocateBehindGoal(st, data, ev);
    if (extra && !st.extraUsed) {
      st.extraUsed = true;
      ev.push({ type: 'extra', side });
      if (skill) ev.push({ type: 'skill', pieceId: shooter.id, skillId: skill.id, name: skill.name, text: skill.effectText });
    } else {
      st.extraUsed = false;
      endOwnerTurn(st, data, side, ev);
      st.turn = (1 - side) as Side;
    }
    checkEnd(st, data, ev);
  }
  const turnEvents = st.over ? [] : beginTurn(st, data);
  return { sim, events: ev, turnEvents };
}

/** Turn timeout or voluntary skip. Counts toward the shot limit. */
export function passTurn(st: MatchState, data: GameData, reason: string): MatchEvent[] {
  const ev: MatchEvent[] = [{ type: 'pass', side: st.turn, reason }];
  st.shotNo++;
  st.extraUsed = false;
  endOwnerTurn(st, data, st.turn, ev);
  st.turn = (1 - st.turn) as Side;
  checkEnd(st, data, ev);
  if (!st.over) ev.push(...beginTurn(st, data));
  return ev;
}

/** Match clock ran out. The caller lets a shot that is already in motion finish first. */
export function endByTime(st: MatchState): MatchEvent[] {
  if (st.over) return [];
  st.over = true;
  st.winner = st.score[0] === st.score[1] ? -1 : st.score[0] > st.score[1] ? 0 : 1;
  st.endReason = 'time';
  return [{ type: 'end', winner: st.winner, reason: 'time' }];
}

export function forfeit(st: MatchState, loser: Side, reason: string): MatchEvent[] {
  st.over = true;
  st.winner = (1 - loser) as Side;
  st.endReason = reason;
  return [{ type: 'end', winner: st.winner, reason }];
}
