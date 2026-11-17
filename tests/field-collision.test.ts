import { expect, test } from 'vitest';
import { goalCrossing, fieldSegments, fieldPosts, insideField } from '@pengzhuang/game-core';
import { ShotRunner, simulateShot } from '../shared/physics';
import { DEFAULT_DATA } from '../shared/data';
const g = DEFAULT_DATA.geometry,
  p = DEFAULT_DATA.physics,
  L = g.length / 2,
  W = g.width / 2,
  r = p.ball.radius;

test('whole-ball crossing is symmetric, excludes partial/equal line and illegal mouth, and interpolates crossing X', () => {
  for (const sign of [-1, 1] as const) {
    const before = { x: 0, y: sign * (L - r) };
    for (const y of [L, L + r - 1e-6, L + r]) expect(goalCrossing(g, r, before, { x: 0, y: sign * y })).toBeNull();
    expect(goalCrossing(g, r, before, { x: 0, y: sign * (L + r + 1e-6) })).toMatchObject({
      scoredBy: sign === -1 ? 0 : 1,
      x: 0,
    });
    expect(goalCrossing(g, r, { x: 2, y: before.y }, { x: 2, y: sign * (L + r + 0.1) })).toBeNull();
    expect(goalCrossing(g, r, { x: 0, y: sign * (L + r + 0.1) }, { x: 0, y: sign * (L + r + 0.2) })).toBeNull();
    expect(goalCrossing(g, r, { x: 0, y: sign * L }, { x: 0.4, y: sign * (L + 2 * r) })?.x).toBeCloseTo(0.2, 12);
  }
});
function ballRun(x: number, y: number, vx: number, vy: number) {
  const runner = new ShotRunner(
    g,
    p,
    { ball: { x, y }, pieces: [{ id: 'shooter', side: 0, x: -2, y: 0, mass: p.disc.mass }] },
    { pieceId: 'shooter', dirX: 0, dirY: 1, power: 0, curve: 0 },
  );
  runner.sim.bodies.get('shooter')!.setLinearVelocity({ x: 0, y: 0 });
  runner.sim.ball.setLinearVelocity({ x: vx, y: vy });
  let outside = 0;
  while (!runner.done) {
    runner.stepOnce();
    const pos = runner.sim.ball.getPosition();
    if (!insideField(g, pos.x, pos.y, r, 0.03)) outside++;
  }
  return { runner, result: runner.result(), outside };
}
test('real CCD at both open goals scores once and the net contains the ball; posts stop a direct high-speed ball', () => {
  for (const sign of [-1, 1] as const) {
    const scored = ballRun(0, sign * (L - 0.3), 0, sign * p.maxBallSpeed);
    expect(scored.result.goal?.scoredBy).toBe(sign === -1 ? 0 : 1);
    expect(scored.result.events.filter((e) => e.type === 'goal')).toHaveLength(1);
    expect(scored.outside).toBe(0);
    const blocked = ballRun(g.goalWidth / 2, sign * (L - 0.4), 0, sign * p.maxBallSpeed);
    expect(blocked.result.goal).toBeNull();
    expect(blocked.result.events.some((e) => e.type.includes('post') && e.type.includes('ball'))).toBe(true);
    expect(blocked.outside).toBe(0);
  }
});
test('high-speed sidewalls, corner glancing and repeated contacts remain inside the same physical outline', () => {
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const wall = ballRun(sx * (W - r - 0.15), sy * 1, sx * p.maxBallSpeed, sy * 2);
      expect(wall.outside).toBe(0);
      expect(wall.result.events.some((e) => e.type.includes('wall'))).toBe(true);
      const shot = simulateShot(
        g,
        p,
        {
          ball: { x: 0, y: 0 },
          pieces: [{ id: 'a', side: 0, x: sx * (W - 0.9), y: sy * (L - 0.9), mass: p.disc.mass }],
        },
        { pieceId: 'a', dirX: sx, dirY: sy, power: 1, curve: 0.5 },
      );
      expect(insideField(g, shot.final.pieces.a.x, shot.final.pieces.a.y, p.disc.radius, 0.03)).toBe(true);
      expect(shot.events.filter((e) => e.type === 'goal').length).toBeLessThanOrEqual(1);
    }
  expect(fieldSegments(g).filter((s) => s.kind === 'net')).toHaveLength(6);
  expect(fieldPosts(g)).toHaveLength(4);
});
