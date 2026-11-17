import { expect, test } from 'vitest';
import { makeRng, nextRandom } from '@pengzhuang/game-core';
import { makeRng as legacyRng } from '../shared/rng';

test('workspace API and legacy entry preserve seeded sequence and portable state', () => {
  const a = makeRng(42);
  const b = legacyRng(42);
  for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  const restored = JSON.parse(JSON.stringify(a.state)) as { s: number };
  expect(nextRandom(restored)).toBe(a.next());
  expect(typeof globalThis.document).toBe('undefined');
});
