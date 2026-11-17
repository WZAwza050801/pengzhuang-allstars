import { expect, test } from 'vitest';
import { attributeFraction, levelAttrs, pieceStats, launchSpeed } from '@pengzhuang/game-core';
import { DEFAULT_DATA as data, buildGameData } from '../shared/data';
import { levelAttrs as oldLevelAttrs, pieceStats as oldPieceStats } from '../shared/match';
import { launchSpeed as oldLaunchSpeed } from '../shared/physics';

test('all card levels preserve source axes and independently computed physical multipliers', () => {
  let rows = 0;
  for (const player of Object.values(data.players))
    for (let level = 1; level <= 10; level++) {
      const actual = levelAttrs(data, player.id, level);
      if (player.srcId) expect(actual).toEqual(data.levels[player.srcId][String(level)]);
      else
        expect(actual).toEqual({
          weight: Math.min(119, player.attrs[0] + player.growth[0] * (level - 1)),
          power: Math.min(119, player.attrs[1] + player.growth[1] * (level - 1)),
          radian: Math.min(119, player.attrs[2] + player.growth[2] * (level - 1)),
          precision: Math.min(119, player.attrs[3] + player.growth[3] * (level - 1)),
          mind: Math.min(119, player.attrs[4] + player.growth[4] * (level - 1)),
        });
      for (const condition of [1, 0.7]) {
        const stats = pieceStats(data, player.id, level, condition);
        const n = (value: number) => Math.max(0, Math.min(1, (value * condition - 21) / 98));
        expect(stats.massMul).toBeCloseTo(0.85 + n(actual.weight) * 0.4, 14);
        expect(stats.speedMul).toBeCloseTo(0.92 + n(actual.power) * 0.16, 14);
        expect(stats.curveMul).toBeCloseTo(0.6 + n(actual.radian) * 0.8, 14);
        expect(stats.aimAssist).toBeCloseTo(0.45 + n(actual.precision) * 0.55, 14);
        expect(launchSpeed(data.physics, 0.8, stats.speedMul)).toBeCloseTo(
          9.1956 * stats.speedMul * Math.pow(0.8, 0.623),
          14,
        );
      }
      rows++;
    }
  expect(rows).toBe(1170);
});
test('endpoints, source-over-legacy priority, explicit saturation, immutable results and invalid inputs are stable', () => {
  expect(attributeFraction(21, 1, 21, 119)).toBe(0);
  expect(attributeFraction(119, 1, 21, 119)).toBe(1);
  expect(attributeFraction(21, 0.7, 21, 119)).toBe(0);
  expect(levelAttrs(data, 'p17', 1).weight).toBe(34);
  expect(data.players.p17.attrs[0]).toBe(40);
  expect(levelAttrs(data, 'p06', 10).weight).toBe(115);
  const copy = levelAttrs(data, 'p17', 1);
  copy.weight = 99;
  expect(data.levels['10101']['1'].weight).toBe(34);
  for (const level of [0, 11, 1.5, NaN]) expect(() => levelAttrs(data, 'p01', level)).toThrow();
  expect(() => levelAttrs(data, 'missing', 1)).toThrow();
  for (const condition of [NaN, Infinity, -1, 2]) expect(() => pieceStats(data, 'p01', 1, condition)).toThrow();
  expect(() => launchSpeed(data.physics, NaN)).toThrow();
  const broken = buildGameData();
  broken.levels = { ...broken.levels, '40108': {} };
  expect(() => levelAttrs(broken, 'p01', 5)).toThrow('Missing');
  const isolated = buildGameData();
  isolated.levels['10101']['1'].weight = 88;
  expect(buildGameData().levels['10101']['1'].weight).toBe(34);
  expect(oldLevelAttrs).toBe(levelAttrs);
  expect(oldPieceStats).toBe(pieceStats);
  expect(oldLaunchSpeed).toBe(launchSpeed);
});
