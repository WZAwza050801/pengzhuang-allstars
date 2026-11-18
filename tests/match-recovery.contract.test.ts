import { expect, test } from 'vitest';
import { ActiveMatchSchema, ReentryCommandSchema } from '../packages/contracts/src/match-recovery';

test('active match responses bind the owner and distinguish recoverable, expired, ended and unavailable states', () => {
  const userId = crypto.randomUUID();
  const match = {
    matchId: crypto.randomUUID(),
    roomCode: 'ABCDEF',
    side: 0,
    protocol: 2,
    mode: 'friend',
    configVersion: 'frozen-v1',
    reconnectMs: null,
  };
  expect(ActiveMatchSchema.safeParse({ userId, state: 'available', match }).success).toBe(true);
  expect(ActiveMatchSchema.safeParse({ userId, state: 'available', match: null }).success).toBe(false);
  for (const state of ['none', 'expired', 'ended', 'unavailable']) {
    expect(ActiveMatchSchema.safeParse({ userId, state, match: null }).success).toBe(true);
    expect(ActiveMatchSchema.safeParse({ userId, state, match }).success).toBe(false);
  }
  for (const extra of [{ protocol: 1 }, { reconnectMs: -1 }, { side: 2 }, { ticket: 'secret' }, { userId }])
    expect(ActiveMatchSchema.safeParse({ userId, state: 'available', match: { ...match, ...extra } }).success).toBe(
      false,
    );
});

test('reentry intent carries protocol only; it cannot select an account, side or new lineup', () => {
  expect(ReentryCommandSchema.parse({ protocol: 2 })).toEqual({ protocol: 2 });
  for (const extra of [
    { protocol: 1 },
    { userId: crypto.randomUUID() },
    { side: 0 },
    { lineupId: crypto.randomUUID() },
    { snapshot: {} },
  ])
    expect(ReentryCommandSchema.safeParse({ protocol: 2, ...extra }).success).toBe(false);
});
