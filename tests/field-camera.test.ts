import { expect, test } from 'vitest';
import {
  fieldViewport,
  worldToView,
  viewToWorld,
  clientToWorld,
  cameraMatrix,
  dragIntent,
  gestureCurve,
} from '@pengzhuang/game-core';
import { DEFAULT_DATA } from '../shared/data';

test('camera roundtrips and drag/curve intent agree for two sides, three DPRs, four viewports, scene and inset layouts', () => {
  const sizes = [
    [320, 568],
    [390, 844],
    [768, 1024],
    [1440, 900],
  ];
  const from = { x: 0.7, y: 1.5 },
    pointer = { x: 1.5, y: 3 };
  const path = [from, { x: 0.6, y: 1.9 }, { x: 0.8, y: 2.4 }];
  const expected = dragIntent(from, pointer, 0.32, 2.4);
  const curve = gestureCurve(path, pointer);
  let variants = 0;
  for (const [width, height] of sizes)
    for (const side of [0, 1] as const)
      for (const dpr of [1, 2, 3])
        for (const scene of [null, { x0: -4.5, y0: -6.4, w: 9, h: 12 }]) {
          const layout = fieldViewport(DEFAULT_DATA.geometry, {
            width,
            height,
            side,
            dpr,
            scene,
            reserveBottom: 44,
            content: { x: 8, y: 12, width: width - 16, height: height - 24 },
          });
          const c = layout.camera;
          const client = (p: { x: number; y: number }) => {
            const v = worldToView(p, c);
            return { x: v.x + 31, y: v.y + 57 };
          };
          const world = (p: { x: number; y: number }) => clientToWorld(p, { x: 31, y: 57 }, c);
          for (let i = 0; i < 100; i++) {
            const p = { x: Math.sin(i * 7) * 3, y: Math.cos(i * 3) * 5 };
            const r = viewToWorld(worldToView(p, c), c);
            expect(Math.hypot(r.x - p.x, r.y - p.y)).toBeLessThan(1e-6);
          }
          const actual = dragIntent(world(client(from)), world(client(pointer)), 0.32, 2.4);
          for (const key of ['dirX', 'dirY', 'power'] as const) expect(actual[key]).toBeCloseTo(expected[key], 12);
          expect(
            gestureCurve(
              path.map((p) => world(client(p))),
              world(client(pointer)),
            ),
          ).toBeCloseTo(curve, 12);
          const m = cameraMatrix(c, dpr);
          const css = worldToView(from, c);
          expect(m[0] * from.x + m[4]).toBeCloseTo(css.x * dpr, 10);
          expect(layout.backing).toEqual({ width: width * dpr, height: height * dpr });
          variants++;
        }
  expect(variants).toBe(48);
});
test('invalid or zero viewport is rejected while a maximal HUD reservation keeps a positive camera scale', () => {
  for (const bad of [
    { width: 0 },
    { dpr: NaN },
    { reserveBottom: -1 },
    { content: { x: 0, y: 0, width: 500, height: 400 } },
  ])
    expect(() => fieldViewport(DEFAULT_DATA.geometry, { width: 320, height: 568, dpr: 2, side: 0, ...bad })).toThrow();
  expect(
    fieldViewport(DEFAULT_DATA.geometry, { width: 320, height: 568, dpr: 2, side: 0, reserveBottom: 999 }).camera.scale,
  ).toBeGreaterThan(0);
  expect(dragIntent({ x: 0, y: 0 }, { x: 0, y: 0 }, 0.32, 2.4)).toMatchObject({ power: 0, dirX: 0, dirY: 0 });
});
