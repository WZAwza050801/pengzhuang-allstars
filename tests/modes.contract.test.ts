import { expect, test } from 'vitest';
import { ModeIdSchema, ModePolicySchema, ModeRulesSchema, ModeOutcomeSchema } from '@pengzhuang/contracts';
import { MODE_POLICY, rulesForMode, verifyModeRules } from '../config/modes';
import { DEFAULT_DATA } from '../shared/data';

test('mode DTOs survive JSON transport and reject unsupported modes, authority claims and mixed scopes', () => {
  for (const mode of ModeIdSchema.options) {
    const rules = rulesForMode(DEFAULT_DATA, mode);
    expect(verifyModeRules(DEFAULT_DATA, JSON.parse(JSON.stringify(rules)))).toEqual(rules);
    expect(ModeRulesSchema.safeParse({ ...rules, admin: true }).success).toBe(false);
  }
  expect(ModeIdSchema.safeParse('premium').success).toBe(false);
  const mixed = structuredClone(MODE_POLICY);
  mixed.modes.growth.ratingScope = 'ranked';
  expect(ModePolicySchema.safeParse(mixed).success).toBe(false);
  expect(ModeOutcomeSchema.safeParse({ winner: 42 }).success).toBe(false);
});
