import { expect, test } from 'vitest';
import { buildGameData } from '../shared/data';
import {
  beginTurn,
  buildSetup,
  buildShot,
  createMatch,
  endByTime,
  forfeit,
  passTurn,
  resolveShot,
  validateShot,
  type MatchState,
} from '../shared/match';
import { pieceStats, SKILL_EFFECT_POLICIES } from '@pengzhuang/game-core';
const home = ['p01', 'p02', 'p03', 'p04', 'p05'],
  away = ['p06', 'p07', 'p08', 'p09', 'p10'];
function fixture(assign: Record<string, string>, guaranteed = true) {
  const data = buildGameData();
  for (const p of Object.values(data.players)) {
    p.skill = 'none';
    p.srcSkill = null;
  }
  for (const [id, skill] of Object.entries(assign)) data.players[id].skill = skill;
  if (guaranteed) for (const skill of Object.values(data.skills)) skill.probability = [1, 1, 1];
  const state = createMatch(data, [home, away], {
    seed: 42,
    firstSide: 0,
    levels: [
      [10, 10, 10, 10, 10],
      [10, 10, 10, 10, 10],
    ],
  });
  return { data, state };
}
const intent = (st: MatchState) => ({ pieceId: st.pieces[0].id, dirX: 1, dirY: 0, power: 0.06, curve: 0 });
function isolate(st: MatchState, active: string[]) {
  for (const p of st.pieces) if (!active.includes(p.id)) p.out = 99;
}
test('all thirteen implemented effects have compatible timing; six preturn buffs apply only to the selected ready shooter', () => {
  const base = buildGameData();
  expect(Object.keys(base.skills)).toHaveLength(13);
  for (const skill of Object.values(base.skills))
    expect(SKILL_EFFECT_POLICIES[skill.effect.type as keyof typeof SKILL_EFFECT_POLICIES].trigger).toBe(skill.trigger);
  for (const skill of Object.values(base.skills).filter((s) => s.effect.type === 'shooterBuff')) {
    const { data, state } = fixture({ p01: skill.id });
    beginTurn(state, data);
    expect(state.pieces[0].ready).toBe(true);
    const stats = pieceStats(data, 'p01', 10),
      shot = buildShot(state, data, intent(state), null).shot;
    expect(shot.speedMul).toBeCloseTo(stats.speedMul * ((skill.effect.speedMul as number | undefined) ?? 1), 12);
    expect(shot.curveMul).toBeCloseTo(stats.curveMul * ((skill.effect.curveMul as number | undefined) ?? 1), 12);
    expect(buildSetup(state, data, state.pieces[0].id).pieces[0].mass).toBeCloseTo(
      data.physics.disc.mass * stats.massMul * ((skill.effect.massMul as number | undefined) ?? 1),
      12,
    );
    expect(buildSetup(state, data, null).pieces[0].mass).toBeCloseTo(data.physics.disc.mass * stats.massMul, 12);
  }
});
test('auras take the strongest value in own half and multiply shooter buffs; frozen plus anchor stays static', () => {
  const { data, state } = fixture({ p01: 'alien', p02: 'guardian', p03: 'guardian', p06: 'wall' });
  state.pieces[5].frozen = 2;
  beginTurn(state, data);
  expect(state.pieces[5].anchored).toBe(true);
  const setup = buildSetup(state, data, state.pieces[0].id);
  expect(setup.pieces[5].fixed).toBe(true);
  expect(setup.pieces[0].mass).toBeCloseTo(pieceStats(data, 'p01', 10).massMul * 1.5 * 1.5, 12);
  passTurn(state, data, 'timeout');
  expect(state.pieces[5].frozen).toBe(2);
  expect(validateShot(state, data, 1, { ...intent(state), pieceId: state.pieces[5].id })).toBe('piece-frozen');
  passTurn(state, data, 'timeout');
  expect(state.pieces[5].frozen).toBe(1);
});
test('extra action is capped and owner counters decrement only after that owner finishes the full turn', () => {
  const { data, state } = fixture({ p01: 'extra' });
  state.pieces[1].frozen = 2;
  state.pieces[2].out = 2;
  beginTurn(state, data);
  const first = resolveShot(state, data, intent(state));
  expect(first.events.filter((e) => e.type === 'extra')).toHaveLength(1);
  expect(state.turn).toBe(0);
  expect(state.extraUsed).toBe(true);
  expect(state.pieces[1].frozen).toBe(2);
  expect(state.pieces[2].out).toBe(2);
  const second = resolveShot(state, data, intent(state));
  expect(second.events.filter((e) => e.type === 'extra')).toHaveLength(0);
  expect(state.turn).toBe(1);
  expect(state.extraUsed).toBe(false);
  expect(state.pieces[1].frozen).toBe(1);
  expect(state.pieces[2].out).toBe(1);
});
test('on-shot sendoff/freeze affects unique opponents hit; previews never roll and owner-turn counters recover', () => {
  for (const skill of ['sendoff', 'tank']) {
    const { data, state } = fixture({ p01: skill });
    const [shooter, , , , , left, right] = state.pieces;
    isolate(state, [shooter.id, left.id, right.id]);
    shooter.x = 0;
    shooter.y = 1.5;
    left.x = -0.38;
    left.y = 0;
    right.x = 0.38;
    right.y = 0;
    state.ball = { x: 2, y: -3 };
    beginTurn(state, data);
    const shot = { ...intent(state), dirX: 0, dirY: -1, power: 0.8 };
    const before = state.rng;
    expect(buildShot(state, data, shot, null).onHit).toBeNull();
    expect(state.rng).toBe(before);
    const outcome = resolveShot(state, data, shot),
      status = outcome.events.find((e) => e.type === (skill === 'sendoff' ? 'sendoff' : 'freeze'));
    if (!status || !('ids' in status)) throw new Error('Missing contact skill event');
    expect(new Set(status.ids).size).toBe(status.ids.length);
    expect(status.ids).toContain(left.id);
    expect(status.ids).toContain(right.id);
    for (const p of [left, right]) expect(skill === 'sendoff' ? p.out : p.frozen).toBe(skill === 'sendoff' ? 2 : 1);
    passTurn(state, data, 'timeout');
    for (const p of [left, right]) expect(skill === 'sendoff' ? p.out : p.frozen).toBe(skill === 'sendoff' ? 1 : 0);
    if (skill === 'sendoff') {
      passTurn(state, data, 'timeout');
      const returned = passTurn(state, data, 'timeout').filter((e) => e.type === 'respawn');
      expect(returned).toHaveLength(2);
      expect(left.out).toBe(0);
      expect(right.out).toBe(0);
      expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeGreaterThan(2 * data.physics.disc.radius);
    }
  }
});
function boostRun(skill: string, inside: boolean) {
  const { data, state } = fixture({ p01: skill }),
    shooter = state.pieces[0];
  isolate(state, [shooter.id]);
  shooter.x = 0;
  shooter.y = inside ? -data.geometry.length / 2 + 1 : 1.5;
  state.ball = { x: 0, y: inside ? -data.geometry.length / 2 + 0.35 : 0 };
  beginTurn(state, data);
  return resolveShot(state, data, { ...intent(state), dirX: 0, dirY: -1, power: 0.8 });
}
test('ball boost triggers on first eligible contact only and fox box condition is respected', () => {
  for (const [skill, inside, expected] of [
    ['fox', false, false],
    ['fox', true, true],
    ['cannon', false, true],
  ] as const) {
    const result = boostRun(skill, inside);
    expect(result.sim.ballBoosted).toBe(expected);
    expect(result.sim.events.filter((e) => e.type === 'skill-boost')).toHaveLength(expected ? 1 : 0);
    expect(result.events.filter((e) => e.type === 'skill')).toHaveLength(expected ? 1 : 0);
  }
});
test('winning goal cancels extra action and resets statuses; finalized games cannot roll, pass, resolve or overwrite results', () => {
  const { data, state } = fixture({ p01: 'extra' });
  const shooter = state.pieces[0];
  isolate(state, [shooter.id]);
  state.score = [2, 0];
  shooter.x = 0;
  shooter.y = -data.geometry.length / 2 + 1.1;
  state.ball = { x: 0, y: -data.geometry.length / 2 + 0.35 };
  beginTurn(state, data);
  const result = resolveShot(state, data, { ...intent(state), dirX: 0, dirY: -1, power: 0.8 });
  expect(state.over).toBe(true);
  expect(state.winner).toBe(0);
  expect(result.turnEvents).toHaveLength(0);
  expect(result.events.filter((e) => e.type === 'extra')).toHaveLength(0);
  for (const p of state.pieces) expect(p).toMatchObject({ out: 0, frozen: 0, ready: false, anchored: false });
  const frozen = JSON.stringify(state);
  expect(beginTurn(state, data)).toEqual([]);
  expect(passTurn(state, data, 'timeout')).toEqual([]);
  expect(forfeit(state, 0, 'surrender')).toEqual([]);
  expect(endByTime(state)).toEqual([]);
  expect(() => resolveShot(state, data, intent(state))).toThrow('match-over');
  expect(JSON.stringify(state)).toBe(frozen);
});
test('fixed-seed probability experiments are reproducible with a declared sampling tolerance', () => {
  const run = () => {
    const { data, state } = fixture({ p01: 'alien' }, false);
    let triggered = 0;
    for (let i = 0; i < 10000; i++) {
      beginTurn(state, data);
      if (state.pieces[0].ready) triggered++;
    }
    return { triggered, rng: state.rng };
  };
  const first = run();
  expect(run()).toEqual(first);
  expect(first.triggered / 10000).toBeGreaterThan(0.18);
  expect(first.triggered / 10000).toBeLessThan(0.22);
});
