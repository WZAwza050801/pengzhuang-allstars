import { describe, expect, test } from 'vitest';
import { softResetPoints } from '../packages/game-core/src/ratings';
import { SeasonsConfigSchema } from '../packages/contracts/src/seasons';
import { SEASONS_CONFIG, verifySeasonsConfig } from '../config/seasons';
import { RATINGS_CONFIG } from '../config/ratings';
import { SeasonService } from '../server/matches/seasons';

const service = () =>
  new SeasonService(
    null as never,
    SEASONS_CONFIG,
    RATINGS_CONFIG,
    null as never,
    () => null as never,
    () => null as never,
  );

describe('soft reset', () => {
  test('compresses toward the floor by the factor and never below floor', () => {
    expect(softResetPoints(1600, 0, 0.5)).toBe(800);
    expect(softResetPoints(1250, 0, 0.5)).toBe(625);
    expect(softResetPoints(1000, 0, 0.5)).toBe(500);
    expect(softResetPoints(0, 0, 0.5)).toBe(0);
    expect(softResetPoints(1600, 100, 0.5)).toBe(850);
    expect(softResetPoints(50, 100, 0.5)).toBe(100);
    expect(softResetPoints(1600, 0, 0)).toBe(0);
    expect(softResetPoints(1600, 0, 1)).toBe(1600);
  });
});

describe('season schedule configuration', () => {
  test('bundled config is frozen and valid', () => {
    expect(SEASONS_CONFIG.version).toBe('seasons-1');
    expect(Object.isFrozen(SEASONS_CONFIG)).toBe(true);
    expect(verifySeasonsConfig(SEASONS_CONFIG)).toEqual(SEASONS_CONFIG);
  });
  test('overlapping, duplicate or invalid windows are rejected', () => {
    const [a, b] = SEASONS_CONFIG.seasons;
    expect(
      SeasonsConfigSchema.safeParse({ ...SEASONS_CONFIG, seasons: [a, { ...b, startsAt: a.startsAt }] }).success,
    ).toBe(false);
    expect(SeasonsConfigSchema.safeParse({ ...SEASONS_CONFIG, seasons: [a, a] }).success).toBe(false);
    expect(SeasonsConfigSchema.safeParse({ ...SEASONS_CONFIG, seasons: [{ ...a, endsAt: a.startsAt }] }).success).toBe(
      false,
    );
    expect(SeasonsConfigSchema.safeParse({ ...SEASONS_CONFIG, softResetFactor: 1.5 }).success).toBe(false);
    expect(SeasonsConfigSchema.safeParse({ ...SEASONS_CONFIG, extra: true }).success).toBe(false);
  });
});

describe('clock-driven current season', () => {
  test('boundaries select the half-open window [start, end)', () => {
    const s = service();
    expect(s.currentSeason(Date.parse('2026-10-31T23:59:59Z'))).toBeNull();
    expect(s.currentSeason(Date.parse('2026-11-01T00:00:00Z'))?.id).toBe('season-1');
    expect(s.currentSeason(Date.parse('2026-11-30T23:59:59Z'))?.id).toBe('season-1');
    expect(s.currentSeason(Date.parse('2026-12-01T00:00:00Z'))?.id).toBe('season-2');
    expect(s.currentSeason(Date.parse('2027-02-01T00:00:00Z'))).toBeNull();
  });
});
