import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { QueueCommandSchema, QueueEntrySchema, MatchmakingPolicySchema } from '../packages/contracts/src/matchmaking';
import { MATCHMAKING_POLICY } from '../config/matchmaking';
import { DEFAULT_DATA } from '../shared/data';
import { rulesForMode } from '../config/modes';

test('queue commands reject client identities, rating/levels and non-account protocols', () => {
  const command = {
    intentId: randomUUID(),
    mode: 'friend',
    lineupId: randomUUID(),
    expectedRevision: 0,
    protocol: 2,
    configVersion: 'fixture-v1',
    region: 'local',
  };
  expect(QueueCommandSchema.safeParse(command).success).toBe(true);
  for (const extra of [
    { userId: randomUUID() },
    { rating: 9999 },
    { levels: [10, 10, 10, 10, 10] },
    { protocol: 1 },
    { region: '../../outside' },
  ])
    expect(QueueCommandSchema.safeParse({ ...command, ...extra }).success).toBe(false);
});
test('queue replies cannot claim a match without an assignment or label fake ratings as friend play', () => {
  const value = {
    id: randomUUID(),
    intentId: randomUUID(),
    mode: 'friend',
    configVersion: DEFAULT_DATA.version,
    policyVersion: 'queue-1',
    rules: rulesForMode(DEFAULT_DATA, 'friend'),
    region: 'local',
    lineupId: randomUUID(),
    lineupRevision: 0,
    rating: null,
    state: 'queued',
    reason: 'waiting-compatible-player',
    createdAt: '2026-11-18T00:00:00.000Z',
    expiresAt: '2026-11-18T00:02:00.000Z',
    assignment: null,
  };
  expect(QueueEntrySchema.safeParse(value).success).toBe(true);
  expect(QueueEntrySchema.safeParse({ ...value, state: 'matched' }).success).toBe(false);
  expect(
    QueueEntrySchema.safeParse({ ...value, rating: { scope: 'ranked', season: 's1', points: 1000 } }).success,
  ).toBe(false);
  expect(QueueEntrySchema.safeParse({ ...value, mode: 'ranked' }).success).toBe(false);
});
test('queue policy has finite capacity/time/rating limits and unique region identifiers', () => {
  expect(MatchmakingPolicySchema.safeParse(MATCHMAKING_POLICY).success).toBe(true);
  for (const extra of [
    { maxQueued: 1000000 },
    { waitMs: Infinity },
    { ratingDifference: 5001 },
    { regions: [...MATCHMAKING_POLICY.regions, ...MATCHMAKING_POLICY.regions] },
  ])
    expect(MatchmakingPolicySchema.safeParse({ ...MATCHMAKING_POLICY, ...extra }).success).toBe(false);
});
