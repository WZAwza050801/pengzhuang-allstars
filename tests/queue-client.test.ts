import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { WebAccountClient } from '../packages/platform/src/account-client';
import type { HttpRequest } from '../packages/platform/src/types';
import { DEFAULT_DATA } from '../shared/data';
import { rulesForMode } from '../config/modes';

const success = (data: unknown) => ({ status: 200, body: { ok: true, data, requestId: randomUUID() } });
const csrf = () =>
  success({ csrfToken: `${randomBytes(32).toString('base64url')}.${randomBytes(32).toString('base64url')}` });
function fixture() {
  const userId = randomUUID(),
    entry = {
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
  return { userId, entry, reply: { userId, serverNow: '2026-11-18T00:00:00.000Z', entry } };
}
test('queue reads bind owner and requested entry, rejecting mixed accounts and malformed paths before requests', async () => {
  const value = fixture(),
    requests: { url: string; input?: HttpRequest }[] = [];
  let payload: unknown = value.reply;
  const api = new WebAccountClient({
    request: async (url, input) => {
      requests.push({ url, input });
      return success(payload);
    },
  });
  expect(await api.queueStatus(value.userId)).toMatchObject({ ok: true, data: { entry: value.entry } });
  expect(requests.at(-1)).toMatchObject({
    url: '/api/v1/matchmaking/entries/current',
    input: { headers: { 'X-Account-Id': value.userId } },
  });
  payload = { ...value.reply, userId: randomUUID() };
  expect(await api.queueStatus(value.userId)).toMatchObject({ ok: false });
  payload = { ...value.reply, entry: { ...value.entry, id: randomUUID() } };
  expect(await api.queueStatus(value.userId, value.entry.id)).toMatchObject({ ok: false });
  const count = requests.length;
  expect(await api.queueStatus(value.userId, '../other')).toMatchObject({ ok: false });
  expect(await api.queueStatus('invalid')).toMatchObject({ ok: false });
  expect(requests).toHaveLength(count);
});
test('queue submit and cancel retain intent/owner binding and use protected writes', async () => {
  const value = fixture(),
    requests: { url: string; input?: HttpRequest }[] = [];
  let payload: unknown = value.reply;
  const api = new WebAccountClient({
    request: async (url, input) => {
      requests.push({ url, input });
      return url.endsWith('/csrf') ? csrf() : success(payload);
    },
  });
  const command = {
    intentId: value.entry.intentId,
    protocol: 2,
    mode: 'friend',
    lineupId: value.entry.lineupId,
    expectedRevision: 0,
    configVersion: value.entry.configVersion,
    region: 'local',
  };
  expect(await api.enterQueue(value.userId, command)).toMatchObject({ ok: true });
  expect(requests.at(-1)).toMatchObject({
    url: '/api/v1/matchmaking/entries',
    input: { method: 'POST', body: command, headers: { 'X-Account-Id': value.userId } },
  });
  expect(requests.at(-1)?.input?.headers?.['X-CSRF-Token']).toBeTruthy();
  payload = { ...value.reply, entry: { ...value.entry, intentId: randomUUID() } };
  expect(await api.enterQueue(value.userId, command)).toMatchObject({ ok: false });
  payload = { ...value.reply, entry: { ...value.entry, state: 'cancelled', reason: 'cancelled' } };
  expect(await api.cancelQueue(value.userId, value.entry.id)).toMatchObject({
    ok: true,
    data: { entry: { state: 'cancelled' } },
  });
  expect(requests.at(-1)).toMatchObject({
    url: `/api/v1/matchmaking/entries/${value.entry.id}`,
    input: { method: 'DELETE', headers: { 'X-Account-Id': value.userId } },
  });
});
test('matched entry tickets are fresh protected requests; invalid IDs cannot reach the network', async () => {
  const userId = randomUUID(),
    entryId = randomUUID(),
    requests: { url: string; input?: HttpRequest }[] = [];
  const reply = {
    protocol: 2,
    mode: 'friend',
    roomCode: 'ABCDEF',
    configVersion: 'fixture-v1',
    ticket: randomBytes(32).toString('base64url'),
    expiresAt: '2026-11-18T00:01:00.000Z',
  };
  const api = new WebAccountClient({
    request: async (url, input) => {
      requests.push({ url, input });
      return url.endsWith('/csrf') ? csrf() : success(reply);
    },
  });
  expect(await api.queueTicket(userId, entryId)).toMatchObject({ ok: true, data: reply });
  expect(requests.at(-1)).toMatchObject({
    url: `/api/v1/matchmaking/entries/${entryId}/ticket`,
    input: { method: 'POST', body: { protocol: 2 }, headers: { 'X-Account-Id': userId } },
  });
  const count = requests.length;
  expect(await api.queueTicket(userId, '../other')).toMatchObject({ ok: false });
  expect(await api.cancelQueue(userId, 'invalid')).toMatchObject({ ok: false });
  expect(requests).toHaveLength(count);
});
