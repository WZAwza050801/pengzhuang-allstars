import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  CurrentUserSchema,
  LogoutSchema,
  SessionListQuerySchema,
  SessionListSchema,
} from '../packages/contracts/src/accounts';

test('account contracts reject authority claims, invalid list bounds and credential disclosure', () => {
  expect(CurrentUserSchema.safeParse({ userId: randomUUID(), sessionId: randomUUID(), profile: null }).success).toBe(
    true,
  );
  expect(LogoutSchema.safeParse({ allSessions: true, userId: randomUUID() }).success).toBe(false);
  for (const query of [{ limit: '0' }, { limit: '51' }, { userId: randomUUID() }, { limit: ['1', '2'] }])
    expect(SessionListQuerySchema.safeParse(query).success).toBe(false);
  const session = {
    id: randomUUID(),
    deviceKind: 'desktop',
    isCurrent: true,
    createdAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
  };
  expect(SessionListSchema.safeParse({ sessions: [session], nextCursor: null }).success).toBe(true);
  for (const extra of [{ refreshTokenHash: 'private' }, { ip: 'private' }, { userAgent: 'private' }])
    expect(SessionListSchema.safeParse({ sessions: [{ ...session, ...extra }], nextCursor: null }).success).toBe(false);
});
