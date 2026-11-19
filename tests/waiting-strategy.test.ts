import { describe, expect, test } from 'vitest';
import { MatchmakingPolicySchema, effectiveWindow } from '../packages/contracts/src/matchmaking';
import { MATCHMAKING_POLICY } from '../config/matchmaking';

const base = { ...MATCHMAKING_POLICY, windowStepMs: 30000, windowStepDifference: 100, windowMaxDifference: 800 };

describe('expanding rating window', () => {
  test('no expansion when step difference is zero (queue-1 compatible)', () => {
    const policy = MatchmakingPolicySchema.parse({ ...MATCHMAKING_POLICY, windowStepMs: 0, windowStepDifference: 0 });
    expect(effectiveWindow(policy, 200, 0)).toBe(200);
    expect(effectiveWindow(policy, 200, 999999)).toBe(200);
  });
  test('widens by steps as wait grows and never exceeds the cap', () => {
    const policy = MatchmakingPolicySchema.parse(base);
    expect(effectiveWindow(policy, 200, 0)).toBe(200);
    expect(effectiveWindow(policy, 200, 29999)).toBe(200);
    expect(effectiveWindow(policy, 200, 30000)).toBe(300);
    expect(effectiveWindow(policy, 200, 90000)).toBe(500);
    expect(effectiveWindow(policy, 200, 300000)).toBe(800);
    expect(effectiveWindow(policy, 200, 9999999)).toBe(800);
  });
  test('cap defaults to the base difference when unset', () => {
    const { windowMaxDifference: _cap, ...rest } = MATCHMAKING_POLICY;
    const policy = MatchmakingPolicySchema.parse({ ...rest, windowStepMs: 1000, windowStepDifference: 100 });
    expect(policy.windowMaxDifference).toBeUndefined();
    expect(effectiveWindow(policy, 200, 999999)).toBe(200);
  });
});

describe('matchmaking policy configuration', () => {
  test('bundled queue-2 enables a bounded expansion', () => {
    expect(MATCHMAKING_POLICY.version).toBe('queue-2');
    expect(MATCHMAKING_POLICY.windowMaxDifference).toBe(800);
    expect(MatchmakingPolicySchema.safeParse(MATCHMAKING_POLICY).success).toBe(true);
  });
  test('cap below base and out-of-range steps are rejected', () => {
    expect(MatchmakingPolicySchema.safeParse({ ...base, windowMaxDifference: 100 }).success).toBe(false);
    expect(MatchmakingPolicySchema.safeParse({ ...base, windowStepDifference: 5001 }).success).toBe(false);
    expect(MatchmakingPolicySchema.safeParse({ ...base, windowStepMs: -1 }).success).toBe(false);
    expect(MatchmakingPolicySchema.safeParse({ ...base, ratingDifference: 5001 }).success).toBe(false);
  });
});
