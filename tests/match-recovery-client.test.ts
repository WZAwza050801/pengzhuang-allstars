import { expect, test } from 'vitest';
import { WebAccountClient } from '../packages/platform/src/account-client';

test('recovery reads bind the owner and reentry sends only protocol to an authenticated fixed match destination', async () => {
  const userId = crypto.randomUUID(),
    matchId = crypto.randomUUID();
  const requests: { url: string; input: unknown }[] = [];
  const success = (data: unknown) => ({ status: 200, body: { ok: true, data, requestId: crypto.randomUUID() } });
  let owner = userId;
  const api = new WebAccountClient({
    request: async (url, input) => {
      requests.push({ url, input });
      if (url.endsWith('/csrf')) return success({ csrfToken: `${'a'.repeat(43)}.${'b'.repeat(43)}` });
      if (url.endsWith('/active-match'))
        return success({
          userId: owner,
          state: 'available',
          match: {
            matchId,
            roomCode: 'ABCDEF',
            protocol: 2,
            mode: 'friend',
            configVersion: 'frozen',
            side: 0,
            reconnectMs: 50000,
          },
        });
      return success({
        ticket: 'a'.repeat(43),
        roomCode: 'ABCDEF',
        protocol: 2,
        mode: 'friend',
        configVersion: 'frozen',
        expiresAt: '2026-11-18T10:00:00.000Z',
      });
    },
  });
  expect(await api.activeMatch('invalid')).toMatchObject({ ok: false });
  expect(await api.reenterMatch(userId, '../foreign', { protocol: 2 })).toMatchObject({ ok: false });
  expect(await api.reenterMatch(userId, matchId, { protocol: 2, lineupId: crypto.randomUUID() })).toMatchObject({
    ok: false,
  });
  expect(requests).toHaveLength(0);
  expect(await api.activeMatch(userId)).toMatchObject({ ok: true, data: { userId } });
  expect(requests.at(-1)).toMatchObject({
    url: '/api/v1/me/active-match',
    input: { headers: { 'X-Account-Id': userId } },
  });
  owner = crypto.randomUUID();
  expect(await api.activeMatch(userId)).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE' } });
  expect(await api.reenterMatch(userId, matchId, { protocol: 2 })).toMatchObject({ ok: true });
  expect(requests.at(-1)).toMatchObject({
    url: `/api/v1/matches/${matchId}/reentry`,
    input: { method: 'POST', body: { protocol: 2 }, headers: { 'X-Account-Id': userId } },
  });
});
