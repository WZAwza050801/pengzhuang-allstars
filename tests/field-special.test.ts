import { expect, test } from 'vitest';
import { fieldSegments, insideField } from '@pengzhuang/game-core';
import { SpringKickEventSchema, RelocateEventSchema } from '@pengzhuang/contracts';
import { ShotRunner } from '../shared/physics';
import { DEFAULT_DATA as data } from '../shared/data';
import { buildSetup, createMatch, freeSpot, resolveShot } from '../shared/match';
const g = data.geometry,
  p = data.physics;
function cornerRunner(corner: number, speed: number, ball = false, fixed = false) {
  const segment = fieldSegments(g).find((s) => s.corner === corner)!;
  const n = segment.n!;
  const radius = ball ? p.ball.radius : p.disc.radius;
  const start = {
    x: (segment.a[0] + segment.b[0]) / 2 + n[0] * (radius + 0.001),
    y: (segment.a[1] + segment.b[1]) / 2 + n[1] * (radius + 0.001),
  };
  const runner = new ShotRunner(
    g,
    p,
    {
      ball: ball ? start : { x: 0, y: 0 },
      pieces: [{ id: 'a', side: 0, ...(ball ? { x: 0, y: 2 } : start), mass: p.disc.mass, fixed }],
    },
    { pieceId: 'a', dirX: -n[0], dirY: -n[1], power: 1, curve: 0 },
  );
  runner.sim.bodies.get('a')!.setLinearVelocity({ x: ball ? 0 : -n[0] * speed, y: ball ? 0 : -n[1] * speed });
  if (ball) runner.sim.ball.setLinearVelocity({ x: -n[0] * speed, y: -n[1] * speed });
  const kicks: { t: number; dot: number }[] = [];
  let events = 0;
  while (!runner.done) {
    runner.stepOnce();
    const next = runner.events.slice(events).filter((e) => e.type === 'spring-kick');
    for (const event of next) {
      SpringKickEventSchema.parse(event);
      expect(event.speed).toBeLessThanOrEqual(p.spring.maxSpeed + 1e-9);
      const v = runner.sim.bodies.get(event.a)!.getLinearVelocity();
      kicks.push({ t: event.t, dot: v.x * n[0] + v.y * n[1] });
    }
    events = runner.events.length;
  }
  return { result: runner.result(), kicks };
}
test('four spring normals point inward; only moving discs above threshold boost once per contact-step and are capped', () => {
  for (let i = 0; i < 4; i++) {
    const s = fieldSegments(g).find((s) => s.corner === i)!;
    expect(Math.hypot(...s.n!)).toBeCloseTo(1, 12);
    expect((s.a[0] + s.b[0]) * s.n![0] + (s.a[1] + s.b[1]) * s.n![1]).toBeLessThan(0);
    const high = cornerRunner(i, p.spring.maxSpeed * 1.5);
    expect(high.kicks.length).toBeGreaterThan(0);
    expect(high.kicks[0].dot).toBeGreaterThan(0);
    expect(new Set(high.kicks.map((e) => e.t)).size).toBe(high.kicks.length);
    expect(cornerRunner(i, 0.2).kicks).toHaveLength(0);
    const football = cornerRunner(i, 3, true);
    expect(football.kicks).toHaveLength(0);
    expect(football.result.events.some((e) => e.type.includes('spring') && e.type.includes('ball'))).toBe(true);
    expect(cornerRunner(i, 3, false, true).kicks).toHaveLength(0);
  }
});
test('authoritative resolution relocates frozen/anchored goal-pocket pieces to separate legal spots once', () => {
  const st = createMatch(data, [data.rules.defaultLineup, data.rules.defaultLineup], { seed: 42 });
  st.turn = 0;
  st.pieces[0].x = -0.45;
  st.pieces[0].y = g.length / 2 + 0.04;
  st.pieces[0].frozen = 2;
  st.pieces[1].x = 0.45;
  st.pieces[1].y = g.length / 2 + 0.04;
  st.pieces[1].anchored = true;
  const setup = buildSetup(st, data, st.pieces[3].id);
  expect(setup.pieces.find((q) => q.id === st.pieces[0].id)?.fixed).toBe(true);
  expect(setup.pieces.find((q) => q.id === st.pieces[1].id)?.fixed).toBe(true);
  const outcome = resolveShot(st, data, { pieceId: st.pieces[3].id, dirX: 0, dirY: 1, power: 0.06, curve: 0 });
  expect(outcome.sim.goal).toBeNull();
  const moves = outcome.events.filter((e) => e.type === 'relocate');
  expect(moves).toHaveLength(1);
  const move = RelocateEventSchema.parse(moves[0]);
  expect(move.ids).toEqual([st.pieces[0].id, st.pieces[1].id]);
  for (const id of move.ids) {
    const q = st.pieces.find((q) => q.id === id)!;
    expect(Math.abs(q.y)).toBeLessThan(g.length / 2);
    expect(insideField(g, q.x, q.y, p.disc.radius, 0)).toBe(true);
    for (const other of st.pieces.filter((v) => v.id !== id && v.out === 0))
      expect(Math.hypot(q.x - other.x, q.y - other.y)).toBeGreaterThan(2 * p.disc.radius);
    expect(Math.hypot(q.x - st.ball.x, q.y - st.ball.y)).toBeGreaterThan(p.disc.radius + p.ball.radius);
  }
});
test('crowded relocation searches for a legal free position; fully occupied worlds fail instead of overlapping', () => {
  const st = createMatch(data, [data.rules.defaultLineup, data.rules.defaultLineup], { seed: 1 });
  const at = freeSpot(st, data, st.pieces[1].x, st.pieces[1].y, st.pieces[0].id);
  expect(insideField(g, at.x, at.y, p.disc.radius, 0)).toBe(true);
  expect(Math.hypot(at.x - st.pieces[1].x, at.y - st.pieces[1].y)).toBeGreaterThan(0.69);
  const impossible = { ...data, physics: { ...p, disc: { ...p.disc, radius: 20 } } };
  expect(() => freeSpot(st, impossible, 0, 0, st.pieces[0].id)).toThrow('No legal free position');
});

test('goal reset clears relocation/status state and gives the conceding side kickoff without an extra relocation event', () => {
  const cleanData = { ...data, skills: {} };
  const st = createMatch(cleanData, [data.rules.defaultLineup, data.rules.defaultLineup], { seed: 3, firstSide: 0 });
  for (const piece of st.pieces) {
    piece.out = 2;
    piece.frozen = 2;
    piece.anchored = true;
  }
  const shooter = st.pieces[3];
  shooter.out = 0;
  shooter.frozen = 0;
  shooter.anchored = false;
  shooter.x = 0;
  shooter.y = -g.length / 2 + 1.1;
  st.ball = { x: 0, y: -g.length / 2 + 0.35 };
  const result = resolveShot(st, cleanData, { pieceId: shooter.id, dirX: 0, dirY: -1, power: 0.8, curve: 0 });
  expect(result.sim.goal?.scoredBy).toBe(0);
  expect(st.score).toEqual([1, 0]);
  expect(st.turn).toBe(1);
  expect(st.ball).toEqual({ x: 0, y: 0 });
  expect(result.events.filter((e) => e.type === 'goal')).toHaveLength(1);
  expect(result.events.filter((e) => e.type === 'relocate')).toHaveLength(0);
  for (const q of st.pieces) expect(q).toMatchObject({ out: 0, frozen: 0, anchored: false, ready: false });
});
