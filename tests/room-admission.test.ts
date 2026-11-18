import { expect, test } from 'vitest';
import { RoomAdmission } from '../server/matches/admission';
import { createGameServer } from '../server/app';
import { Client } from 'colyseus.js';
import WebSocket from 'ws';
import { ROOM_NAME, PROTOCOL_VERSION } from '../shared/protocol';
import { jsonRequest } from './helpers/json-http';

async function runtime(limits: Parameters<typeof createGameServer>[0] = {}) {
  const server = createGameServer({ clientDirectory: null, ...limits });
  await server.gameServer.listen(0);
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  return { ...server, origin: `http://127.0.0.1:${address.port}` };
}

test('creation and connection limits are shared across rooms, ignore caller forwarding headers, and expire', () => {
  let now = 0;
  const admission = new RoomAdmission(() => now, {
    windowMs: 1000,
    perIp: 3,
    global: 5,
    createsPerIp: 1,
    createsGlobal: 3,
    maxKeys: 3,
  });
  expect(admission.allow('a', 'create')).toBe(true);
  expect(admission.allow('a', 'create')).toBe(false);
  expect(admission.allow('a', 'connect')).toBe(true);
  expect(admission.allow('a', 'connect')).toBe(false);
  expect(admission.allow('b', 'create')).toBe(true);
  expect(admission.allow('c', 'create')).toBe(false);
  expect(admission.allow('d', 'connect')).toBe(false);
  now = 1000;
  expect(admission.allow('d', 'create')).toBe(true);
});

test('bounded key storage fails closed without evicting live limits', () => {
  const admission = new RoomAdmission(() => 0, { maxKeys: 1 });
  expect(admission.allow('a', 'connect')).toBe(true);
  expect(admission.allow('b', 'connect')).toBe(false);
  expect(admission.allow('a', 'connect')).toBe(true);
});

test('real matchmaking limits creation across room codes and does not trust forwarded addresses', async () => {
  const server = await runtime({ admissionLimits: { createsPerIp: 1 } });
  const sdk = new Client(server.origin.replace('http:', 'ws:'));
  try {
    const room = await sdk.create(ROOM_NAME, { protocol: PROTOCOL_VERSION, nickname: 'one' });
    room.onMessage('*', () => undefined);
    const denied = await jsonRequest(server.origin, `/matchmake/create/${ROOM_NAME}`, {
      method: 'POST',
      headers: { 'x-forwarded-for': 'different', 'x-real-ip': 'different' },
      body: { protocol: PROTOCOL_VERSION, nickname: 'two' },
    });
    expect(denied.status).toBe(429);
    expect(denied.data.error).toBe('rate-limited');
    const cors = await jsonRequest(server.origin, '/matchmake/joinById/AAAAAA', {
      method: 'POST',
      body: {},
      headers: { origin: 'http://127.0.0.1:9999' },
    });
    expect(cors.headers['access-control-allow-origin']).toBe('http://127.0.0.1:9999');
    expect(cors.headers['access-control-allow-credentials']).toBe('true');
    await room.leave();
  } finally {
    await server.close();
  }
});

test('connections share a global budget with HTTP, reject token URLs, and oversized matchmaking never creates rooms', async () => {
  const server = await runtime({ admissionLimits: { perIp: 3 } });
  try {
    expect(
      (
        await jsonRequest(server.origin, `/matchmake/create/${ROOM_NAME}`, {
          method: 'POST',
          body: { payload: 'x'.repeat(3000) },
        })
      ).status,
    ).toBe(413);
    const wsStatus = (suffix: string) =>
      new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(server.origin.replace('http:', 'ws:') + suffix);
        socket.once('unexpected-response', (_req, res) => {
          resolve(res.statusCode ?? 0);
          res.resume();
          socket.terminate();
        });
        socket.once('error', () => undefined);
        socket.once('open', () => {
          socket.terminate();
          reject(new Error('Unexpected upgrade'));
        });
      });
    expect(await wsStatus('/process/room?_authToken=hidden')).toBe(403);
    expect(await wsStatus('//[invalid')).toBe(400);
    await jsonRequest(server.origin, '/matchmake/joinById/AAAAAA', { method: 'POST', body: {} });
    await jsonRequest(server.origin, '/matchmake/joinById/BBBBBB', { method: 'POST', body: {} });
    expect(await wsStatus('/process/room?sessionId=absent')).toBe(429);
    expect((await jsonRequest(server.origin, '/matchmake/joinById/CCCCCC', { method: 'POST', body: {} })).status).toBe(
      429,
    );
  } finally {
    await server.close();
  }
});
