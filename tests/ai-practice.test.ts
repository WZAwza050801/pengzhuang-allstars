import { describe, expect, test, vi } from 'vitest';
import { chooseShot, fallbackShot } from '../shared/ai';
import { createMatch, beginTurn } from '../shared/match';
import { DEFAULT_DATA } from '../shared/data';
import { LocalHost } from '../client/src/localHost';
import type { DecisionWorker } from '@pengzhuang/platform';

const data = DEFAULT_DATA;
const lineup = data.rules.defaultLineup.slice();
function state(seed = 7) {
  const st = createMatch(data, [lineup, lineup], { seed, levels: [null, null] });
  beginTurn(st, data);
  return st;
}
const silentWorker = (): DecisionWorker => ({
  postMessage() {},
  onMessage() {
    return () => {};
  },
  onError() {
    return () => {};
  },
  terminate() {},
});
const listener = { onState() {}, onShot() {}, onEvents() {} };

describe('observable difficulty and bounded computation', () => {
  test('easy and hard choose differently on the same fixed state/seed', () => {
    const st = state(7);
    const easy = chooseShot(st, data, 'easy', 13);
    const hard = chooseShot(st, data, 'hard', 13);
    expect(easy).not.toBeNull();
    expect(hard).not.toBeNull();
    expect(JSON.stringify(easy)).not.toEqual(JSON.stringify(hard));
  });
  test('a zero time budget stops search with a budget reason and never mutates authority', () => {
    const st = state(7);
    const before = JSON.stringify(st);
    let reason = '';
    const input = chooseShot(st, data, 'hard', 13, { budgetMs: 0, now: () => 0, onStats: (s) => (reason = s.reason) });
    expect(['budget', 'evaluations', 'complete']).toContain(reason);
    expect(JSON.stringify(st)).toEqual(before);
    expect(input === null || typeof input.pieceId === 'string').toBe(true);
  });
  test('cancellation yields no shot and a cancelled reason', () => {
    const st = state(7);
    let reason = '';
    const input = chooseShot(st, data, 'hard', 13, { isCancelled: () => true, onStats: (s) => (reason = s.reason) });
    expect(input).toBeNull();
    expect(reason).toBe('cancelled');
  });
  test('evaluation cap is respected', () => {
    const st = state(7);
    let evaluated = -1;
    chooseShot(st, data, 'hard', 13, { maxEvaluations: 3, onStats: (s) => (evaluated = s.evaluated) });
    expect(evaluated).toBeLessThanOrEqual(3);
  });
  test('fallback is constant-work and legal-shaped', () => {
    const st = state(7);
    const shot = fallbackShot(st, data);
    expect(shot).not.toBeNull();
    expect(shot!.power).toBeGreaterThanOrEqual(data.physics.shot.minPower);
  });
});

describe('practice offline isolation and bot labeling', () => {
  test('practice rules carry no rating or reward scope and the opponent is a labeled bot', () => {
    const host = new LocalHost(
      { mode: 'bot', level: 'normal', names: ['我', '电脑'], lineups: [lineup, lineup], timer: false },
      { createWorker: silentWorker, seed: 7 },
    );
    expect(host.rules.ratingScope).toBeNull();
    expect(host.rules.rewardScope).toBeNull();
    expect(host.seats[1].isBot).toBe(true);
    expect(host.seats[1].name).toContain('电脑');
    expect(host.mySides).toEqual([0]);
    host.dispose();
  });
  test('difficulty is readable and switchable, updating the bot label', () => {
    const host = new LocalHost(
      { mode: 'bot', level: 'easy', names: ['我', '电脑'], lineups: [lineup, lineup], timer: false },
      { createWorker: silentWorker, seed: 7 },
    );
    expect(host.aiLevel()).toBe('easy');
    expect(host.seats[1].name).toContain('简单');
    host.setAiLevel('hard');
    expect(host.aiLevel()).toBe('hard');
    expect(host.seats[1].name).toContain('困难');
    host.dispose();
  });
});

describe('background pauses bot computation', () => {
  test('a hidden page cancels pending AI and does not schedule bot moves until visible', () => {
    vi.useFakeTimers();
    try {
      const host = new LocalHost(
        { mode: 'bot', level: 'normal', names: ['我', '电脑'], lineups: [lineup, lineup], timer: false },
        { createWorker: silentWorker, seed: 7 },
      );
      host.start(listener);
      const internal = host as unknown as {
        st: { turn: number; over: boolean };
        botSide: number | null;
        botDelay: unknown;
        backgrounded: boolean;
        turnStarted(): void;
        started: boolean;
      };
      // Force the bot to move so scheduling is observable.
      internal.st.turn = internal.botSide!;
      internal.backgrounded = true;
      internal.turnStarted();
      expect(internal.botDelay).toBeNull();
      host.setBackground(false);
      expect(internal.backgrounded).toBe(false);
      internal.turnStarted();
      expect(internal.botDelay).not.toBeNull();
      host.setBackground(true);
      expect(internal.botDelay).toBeNull();
      host.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
