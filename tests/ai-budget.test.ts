import { expect, test } from 'vitest';
import { chooseShot, fallbackShot, type AiSearchStats } from '../shared/ai';
import { DEFAULT_DATA as data } from '../shared/data';
import { createMatch, beginTurn, validateShot } from '../shared/match';
const state = () => {
  const s = createMatch(data, [data.rules.defaultLineup, data.rules.defaultLineup], { seed: 42, firstSide: 0 });
  beginTurn(s, data);
  return s;
};
test('bounded search produces a legal fallback, enforces candidate/time limits and never changes authority', () => {
  for (const options of [{ maxEvaluations: 0 }, { maxEvaluations: 1 }, { budgetMs: 0 }]) {
    const st = state(),
      before = JSON.stringify(st);
    let stats: AiSearchStats | undefined;
    const input = chooseShot(st, data, 'normal', 13, {
      ...options,
      onStats: (v) => {
        stats = v;
      },
      now: () => 100,
    });
    expect(input).not.toBeNull();
    expect(validateShot(st, data, 0, input!)).toBeNull();
    expect(JSON.stringify(st)).toBe(before);
    expect(stats?.evaluated).toBeLessThanOrEqual(options.maxEvaluations ?? 0);
    expect(stats?.reason).toBe(options.budgetMs === 0 ? 'budget' : 'evaluations');
  }
});
test('cancellation, ended/no-legal-piece states and malformed limits are explicit', () => {
  const st = state(),
    before = JSON.stringify(st);
  let stats: AiSearchStats | undefined;
  expect(
    chooseShot(st, data, 'hard', 13, {
      isCancelled: () => true,
      onStats: (v) => {
        stats = v;
      },
    }),
  ).toBeNull();
  expect(stats?.reason).toBe('cancelled');
  expect(JSON.stringify(st)).toBe(before);
  for (const p of st.pieces) if (p.side === 0) p.frozen = 1;
  expect(chooseShot(st, data)).toBeNull();
  expect(fallbackShot(st, data)).toBeNull();
  st.over = true;
  expect(chooseShot(st, data)).toBeNull();
  for (const options of [{ maxEvaluations: -1 }, { maxEvaluations: 1.5 }, { budgetMs: NaN }])
    expect(() => chooseShot(state(), data, 'normal', 13, options)).toThrow();
});
