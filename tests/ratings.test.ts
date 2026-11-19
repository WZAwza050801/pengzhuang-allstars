import { describe, expect, test } from 'vitest';
import { expectedScore, eloDelta, tierFor, resultFor } from '../packages/game-core/src/ratings';
import { RatingsConfigSchema } from '../packages/contracts/src/ratings';
import { RATINGS_CONFIG, verifyRatingsConfig } from '../config/ratings';

const config = RATINGS_CONFIG;

describe('simple Elo math', () => {
  test('equal ratings expect half a point and expectations are symmetric', () => {
    expect(expectedScore(1000, 1000, 400)).toBe(0.5);
    expect(expectedScore(1200, 1000, 400)).toBeGreaterThan(0.5);
    expect(expectedScore(1000, 1200, 400) + expectedScore(1200, 1000, 400)).toBeCloseTo(1, 12);
  });
  test('win/loss/draw at equal ratings move by half K or zero', () => {
    expect(eloDelta(1000, 1000, 'win', config)).toEqual({ delta: 16, after: 1016 });
    expect(eloDelta(1000, 1000, 'loss', config)).toEqual({ delta: -16, after: 984 });
    expect(eloDelta(1000, 1000, 'draw', config)).toEqual({ delta: 0, after: 1000 });
  });
  test('underdog gains more than favourite and deltas reconcile with stored points', () => {
    const underdog = eloDelta(1000, 1400, 'win', config);
    const favourite = eloDelta(1400, 1000, 'loss', config);
    expect(underdog.delta).toBeGreaterThan(16);
    expect(favourite.delta).toBeLessThan(-16);
    expect(underdog.after).toBe(1000 + underdog.delta);
    expect(favourite.after).toBe(1400 + favourite.delta);
  });
  test('floor clamp is reflected in the recorded delta', () => {
    expect(eloDelta(10, 0, 'loss', config)).toEqual({ delta: -10, after: 0 });
    expect(eloDelta(0, 0, 'loss', config)).toEqual({ delta: 0, after: 0 });
    expect(eloDelta(5, 1000, 'loss', config)).toEqual({ delta: 0, after: 5 });
  });
  test('result mapping follows the authoritative winner', () => {
    expect(resultFor(-1, 0)).toBe('draw');
    expect(resultFor(0, 0)).toBe('win');
    expect(resultFor(0, 1)).toBe('loss');
    expect(resultFor(1, 1)).toBe('win');
  });
});

describe('tier mapping', () => {
  test('boundaries select the highest reached tier', () => {
    expect(tierFor(0, config).id).toBe('bronze');
    expect(tierFor(1099, config).id).toBe('bronze');
    expect(tierFor(1100, config).id).toBe('silver');
    expect(tierFor(1250, config).id).toBe('gold');
    expect(tierFor(1400, config).id).toBe('platinum');
    expect(tierFor(1600, config).id).toBe('diamond');
    expect(tierFor(5000, config).id).toBe('diamond');
  });
});

describe('versioned ratings configuration', () => {
  test('bundled config is frozen and valid', () => {
    expect(config.version).toBe('ratings-1');
    expect(config.status).toBe('engineering-default');
    expect(Object.isFrozen(config)).toBe(true);
    expect(verifyRatingsConfig(config)).toEqual(config);
  });
  test('invalid tier ladders and parameters are rejected', () => {
    expect(RatingsConfigSchema.safeParse({ ...config, tiers: [...config.tiers].reverse() }).success).toBe(false);
    expect(
      RatingsConfigSchema.safeParse({ ...config, tiers: config.tiers.map((t, i) => (i === 0 ? { ...t, min: 10 } : t)) })
        .success,
    ).toBe(false);
    expect(
      RatingsConfigSchema.safeParse({
        ...config,
        tiers: [config.tiers[0], { ...config.tiers[1], id: config.tiers[0].id }],
      }).success,
    ).toBe(false);
    expect(RatingsConfigSchema.safeParse({ ...config, floorPoints: config.initialPoints + 1 }).success).toBe(false);
    expect(RatingsConfigSchema.safeParse({ ...config, k: 0 }).success).toBe(false);
    expect(RatingsConfigSchema.safeParse({ ...config, scale: 99 }).success).toBe(false);
    expect(RatingsConfigSchema.safeParse({ ...config, extra: true }).success).toBe(false);
  });
});
