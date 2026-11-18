import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { WebAccountClient } from '../packages/platform/src/account-client';

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
