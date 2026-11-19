import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { MatchResultSchema, MatchHistoryQuerySchema, MatchLedgerSchema } from '../packages/contracts/src/match-results';

test('result contracts distinguish pending delivery from committed reward receipts and reject private fields', () => {
  const pending = {
    userId: randomUUID(),
    matchId: randomUUID(),
    side: 0,
    mode: 'friend',
    configVersion: 'game-1',
    economyVersion: 'economy-2',
    modesVersion: 'modes-1',
    finalSeq: 0,
    score: [0, 0],
    winner: 1,
    reason: 'surrender',
    endedAt: '2026-11-18T05:00:00.000Z',
    status: 'pending',
    recorded: false,
    pendingReason: 'storage-unavailable',
    reward: null,
  };
  const reward = {
    eligible: false,
    coins: '0',
    fragments: '0',
    playerDefId: null,
    operationId: null,
    ledgerIds: [],
    dayKey: '2026-11-18',
  };
  expect(MatchResultSchema.safeParse(pending).success).toBe(true);
  expect(
    MatchResultSchema.safeParse({ ...pending, status: 'settled', recorded: true, pendingReason: null, reward }).success,
  ).toBe(true);
  for (const extra of [
    { reward },
    { status: 'settled' },
    { status: 'recorded' },
    { recorded: true },
    { seatToken: 'private' },
    { opponentUserId: randomUUID() },
  ])
    expect(MatchResultSchema.safeParse({ ...pending, ...extra }).success).toBe(false);
  for (const query of [
    { limit: '0' },
    { limit: '51' },
    { cursor: '../file' },
    { limit: ['1', '2'] },
    { userId: randomUUID() },
  ])
    expect(MatchHistoryQuerySchema.safeParse(query).success).toBe(false);
});

test('match ledger contracts require owner and match identity, preserve integer precision, and exclude credential fields', () => {
  const body = {
    userId: randomUUID(),
    matchId: randomUUID(),
    entries: [
      {
        id: randomUUID(),
        currency: 'coins',
        delta: '50',
        balanceAfter: '9007199254741041',
        reason: 'match.reward',
        sourceId: randomUUID(),
        createdAt: '2026-11-18T05:00:00.000Z',
      },
    ],
  };
  expect(MatchLedgerSchema.safeParse(body).success).toBe(true);
  for (const value of [
    { ...body, userId: undefined },
    { ...body, entries: Array(9).fill(body.entries[0]) },
    { ...body, sessionToken: 'private' },
    { ...body, entries: [{ ...body.entries[0], delta: 50 }] },
    { ...body, entries: [{ ...body.entries[0], internalUserId: randomUUID() }] },
  ])
    expect(MatchLedgerSchema.safeParse(value).success).toBe(false);
});
