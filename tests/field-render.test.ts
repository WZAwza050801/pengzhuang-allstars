import { expect, test } from 'vitest';
import { freezeSnapshot, samplePlayback } from '@pengzhuang/game-core';
import { simulateShot } from '../shared/physics';
import { DEFAULT_DATA } from '../shared/data';
import { chooseQuality, QUALITY_PROFILES } from '../client/src/quality';

test('read-only server playback has the same terminal pose at 30/60/120/144Hz and never writes authority or frames', () => {
  const sim = simulateShot(
    DEFAULT_DATA.geometry,
    DEFAULT_DATA.physics,
    { ball: { x: 0, y: 0 }, pieces: [{ id: 'a', side: 0, x: 0, y: 2, mass: 1 }] },
    { pieceId: 'a', dirX: 0, dirY: -1, power: 0.8, curve: 0.4 },
  );
  const frames = freezeSnapshot(sim.frames),
    before = JSON.stringify(frames);
  const end = samplePlayback(frames, DEFAULT_DATA.physics.recordHz, 999);
  for (const fps of [30, 60, 120, 144]) {
    let pose = end;
    for (let frame = 0; frame / fps < sim.duration + 1; frame++)
      pose = samplePlayback(frames, DEFAULT_DATA.physics.recordHz, frame / fps);
    expect(pose).toEqual(end);
    expect(pose.complete).toBe(true);
  }
  expect(JSON.stringify(frames)).toBe(before);
  expect(() => samplePlayback([], 30, 0)).toThrow();
});
test('quality affects only presentation budgets and chooses bounded backing resolution', () => {
  expect(chooseQuality({ cores: 2 })).toBe('medium');
  expect(chooseQuality({ memoryGiB: 2 })).toBe('low');
  expect(chooseQuality({ cores: 8, memoryGiB: 8 })).toBe('high');
  expect(chooseQuality({ reducedMotion: true })).toBe('low');
  expect(QUALITY_PROFILES.low.maxDpr).toBeLessThan(QUALITY_PROFILES.high.maxDpr);
  expect(QUALITY_PROFILES.low.shadows).toBe(false);
  expect(Object.isFrozen(QUALITY_PROFILES.high)).toBe(true);
});
