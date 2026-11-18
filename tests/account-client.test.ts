import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { WebAccountClient } from '../packages/platform/src/account-client';
import { roomFailureText } from '../packages/client-model/src/room';

const success = (data: unknown) => ({ status: 200, body: { ok: true, data, requestId: randomUUID() } });
const failure = (code: 'UNAUTHENTICATED' | 'UNAVAILABLE', status = 401) => ({
  status,
  body: {
    ok: false,
    error: { code, message: 'Generic failure', retryable: code === 'UNAVAILABLE' },
    requestId: randomUUID(),
  },
});
const csrfValue = () => `${randomBytes(32).toString('base64url')}.${randomBytes(32).toString('base64url')}`;
const csrf = () => success({ csrfToken: csrfValue() });

test('result readers reject stale account or match identities and never submit settlement mutations', async () => {
  const userId = randomUUID(),
    matchId = randomUUID(),
    requests: string[] = [];
  let payload: unknown;
  const result = {
    userId,
    matchId,
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
    status: 'recorded',
    recorded: true,
    pendingReason: null,
    reward: null,
  };
  const api = new WebAccountClient({
    request: async (url, input) => {
      requests.push(url);
      expect(input?.method ?? 'GET').toBe('GET');
      return success(payload);
    },
  });
  payload = result;
  expect(await api.matchResult(userId, matchId)).toMatchObject({ ok: true, data: result });
  payload = { ...result, userId: randomUUID() };
  expect(await api.matchResult(userId, matchId)).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE' } });
  payload = { ...result, matchId: randomUUID() };
  expect(await api.matchResult(userId, matchId)).toMatchObject({ ok: false });
  payload = { userId, matches: [{ ...result, userId: randomUUID() }], nextCursor: null };
  expect(await api.matchHistory(userId)).toMatchObject({ ok: false });
  payload = { userId, matches: [result], nextCursor: null };
  expect(await api.matchHistory(userId, { limit: '50' })).toMatchObject({ ok: true });
  expect(requests.at(-1)).toBe('/api/v1/me/matches?limit=50');
  const count = requests.length;
  expect(await api.matchResult(userId, '../file')).toMatchObject({ ok: false });
  expect(await api.matchHistory(userId, { limit: '51' })).toMatchObject({ ok: false });
  expect(requests).toHaveLength(count);
});

test('room ticket requests validate identity hints and carry only a versioned owned-lineup command', async () => {
  const userId = randomUUID(),
    lineupId = randomUUID();
  const requests: { url: string; body?: unknown; headers?: Record<string, string> }[] = [];
  const ticket = {
    ticket: 'a'.repeat(43),
    roomCode: 'ABCD23',
    expiresAt: '2026-11-18T00:00:00.000Z',
    protocol: 2,
    mode: 'friend',
    configVersion: 'test',
  };
  const api = new WebAccountClient({
    request: async (url, input) => {
      requests.push({ url, body: input?.body, headers: input?.headers });
      return url.endsWith('/csrf') ? csrf() : success(ticket);
    },
  });
  const command = { protocol: 2, mode: 'friend', lineupId, expectedRevision: 0, roomCode: 'ABCD23' };
  expect(await api.roomTicket(userId, { ...command, protocol: 1 })).toMatchObject({ ok: false });
  expect(await api.roomTicket(userId, { ...command, userId })).toMatchObject({ ok: false });
  expect(await api.roomTicket('invalid', command)).toMatchObject({ ok: false });
  expect(requests).toHaveLength(0);
  expect(await api.roomTicket(userId, command)).toEqual({ ok: true, data: ticket });
  expect(requests.at(-1)).toMatchObject({
    url: '/api/v1/matches/tickets',
    body: command,
    headers: { 'X-Account-Id': userId },
  });
  expect(requests.at(-1)?.headers?.['X-CSRF-Token']).toBeTruthy();
});

test('unsupported account protocol gives an upgrade instruction and never refreshes or replays the request', async () => {
  let posts = 0;
  const api = new WebAccountClient({
    request: async (url) => {
      if (url.endsWith('/csrf')) return csrf();
      posts++;
      return {
        status: 426,
        body: {
          ok: false,
          error: { code: 'PROTOCOL_UNSUPPORTED', message: 'Refresh the client', retryable: false },
          requestId: randomUUID(),
        },
      };
    },
  });
  expect(
    await api.roomTicket(randomUUID(), { protocol: 2, mode: 'friend', lineupId: randomUUID(), expectedRevision: 0 }),
  ).toMatchObject({ ok: false, error: { code: 'PROTOCOL_UNSUPPORTED', retryable: false } });
  expect(roomFailureText('PROTOCOL_UNSUPPORTED')).toContain('刷新客户端');
  expect(posts).toBe(1);
});

test('unknown room issuance failures do not automatically create a second room', async () => {
  let posts = 0;
  const api = new WebAccountClient({
    request: async (url) => {
      if (url.endsWith('/csrf')) return csrf();
      posts++;
      return failure('UNAVAILABLE', 503);
    },
  });
  expect(
    await api.roomTicket(randomUUID(), { protocol: 2, mode: 'friend', lineupId: randomUUID(), expectedRevision: 0 }),
  ).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
  expect(posts).toBe(1);
});

test('credential failures are never refreshed or replayed; invalid registration stays at the boundary', async () => {
  const requests: string[] = [];
  const api = new WebAccountClient({
    request: async (url) => {
      requests.push(url);
      return url.endsWith('/csrf') ? csrf() : failure('UNAUTHENTICATED');
    },
  });
  expect(await api.register({ email: 'x@example.test', password: 'short', nickname: '昵称' })).toMatchObject({
    ok: false,
    error: { code: 'INVALID_REQUEST' },
  });
  expect(requests).toHaveLength(0);
  expect(await api.login({ email: 'x@example.test', password: 'wrong' })).toMatchObject({ ok: false });
  expect(await api.reauthenticate({ method: 'password', password: 'wrong' })).toMatchObject({ ok: false });
  expect(requests.filter((url) => url.endsWith('/login'))).toHaveLength(1);
  expect(requests.filter((url) => url.endsWith('/reauthenticate'))).toHaveLength(1);
  expect(requests.some((url) => url.endsWith('/refresh'))).toBe(false);
});

test('late parallel 401 responses share a failed refresh result and do not start a refresh storm', async () => {
  let reads = 0;
  let refreshes = 0;
  let release!: () => void;
  const late = new Promise<void>((resolve) => {
    release = resolve;
  });
  const api = new WebAccountClient({
    request: async (url) => {
      if (url.endsWith('/csrf')) return csrf();
      if (url.endsWith('/refresh')) {
        refreshes++;
        return failure('UNAVAILABLE', 503);
      }
      if (reads++ > 0) await late;
      return failure('UNAUTHENTICATED');
    },
  });
  const first = api.current();
  const second = api.current();
  const third = api.current();
  expect(await first).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE', retryable: true } });
  release();
  for (const result of await Promise.all([second, third]))
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
  expect(refreshes).toBe(1);
});

test('a protected request retries at most once after refresh and never loops on persistent 401', async () => {
  let reads = 0;
  let refreshes = 0;
  const api = new WebAccountClient({
    request: async (url) => {
      if (url.endsWith('/csrf')) return csrf();
      if (url.endsWith('/refresh')) {
        refreshes++;
        return success({ refreshed: true });
      }
      reads++;
      return failure('UNAUTHENTICATED');
    },
  });
  expect(await api.current()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  expect({ reads, refreshes }).toEqual({ reads: 2, refreshes: 1 });
});

test('account responses reject malformed data; network errors remain retryable and invalid targets never leave the client', async () => {
  let requests = 0;
  const api = new WebAccountClient({
    request: async () => {
      requests++;
      return success({ userId: 'invalid', role: 'admin', profile: null });
    },
  });
  expect(await api.current()).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE', retryable: false } });
  expect(await api.revoke('../another-user')).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE' } });
  expect(requests).toBe(1);
  const offline = new WebAccountClient({
    request: async () => {
      throw new Error('private transport detail');
    },
  });
  expect(await offline.current()).toEqual({ ok: false, error: { code: 'NETWORK_ERROR', retryable: true } });
});

test('a new verified session discards its predecessor CSRF cache and late CSRF responses cannot overwrite it', async () => {
  let sessionId = randomUUID();
  const userId = randomUUID();
  const oldToken = csrfValue(),
    newToken = csrfValue();
  let csrfReads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const headers: string[] = [];
  const api = new WebAccountClient({
    request: async (url, options) => {
      if (url.endsWith('/me')) return success({ userId, sessionId, profile: null });
      if (url.endsWith('/csrf')) {
        if (++csrfReads === 1) {
          await gate;
          return success({ csrfToken: oldToken });
        }
        return success({ csrfToken: newToken });
      }
      headers.push(options?.headers?.['X-CSRF-Token'] ?? 'missing');
      return success({ loggedOut: true });
    },
  });
  await api.current();
  const oldRequest = api.logout({ operationId: randomUUID(), allSessions: false });
  sessionId = randomUUID();
  await api.current();
  const newRequest = api.logout({ operationId: randomUUID(), allSessions: false });
  release();
  await Promise.all([oldRequest, newRequest]);
  await api.logout({ operationId: randomUUID(), allSessions: false });
  expect(headers.at(-1)).toBe(newToken);
  expect(csrfReads).toBe(2);
});
