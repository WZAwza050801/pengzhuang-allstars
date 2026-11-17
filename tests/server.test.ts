import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import { expect, test } from 'vitest';
import { createGameServer } from '../server/app';
import { asyncRoute, type ErrorEvent } from '../server/api/http';
import { ApiErrorSchema } from '@pengzhuang/contracts';
import { DEFAULT_DATA } from '../shared/data';
import { startRuntime } from '../server/runtime';
import { readRuntimeConfig } from '../config/runtime';
import type { SqlExecutor } from '../packages/persistence/src/database';

async function request(
  origin: string,
  route: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }>(
    (resolve, reject) => {
      const call = httpRequest(new URL(route, origin), { method: init.method, headers: init.headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text: Buffer.concat(chunks).toString(),
          }),
        );
      });
      call.on('error', reject);
      if (init.body) call.write(init.body);
      call.end();
    },
  );
}

test('real HTTP routing separates API/SPA, propagates request ids, validates JSON, redacts async failures and cleans up', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'allstars-api-'));
  await writeFile(path.join(dir, 'index.html'), '<html>test SPA</html>');
  const errors: ErrorEvent[] = [];
  const closed: number[] = [];
  let unavailable = false;
  const repository: SqlExecutor = {
    async query() {
      if (unavailable) throw new Error('secret DSN');
      return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
    },
  };
  const clock = { nowMs: () => 100, wallMs: () => 200 };
  const sink = {
    async record(): Promise<'stored'> {
      return 'stored';
    },
  };
  const server = createGameServer({
    repository,
    clock,
    outcomeSink: sink,
    clientDirectory: dir,
    closeResources: [
      async () => {
        closed.push(1);
      },
      async () => {
        closed.push(2);
      },
    ],
    onError: (event) => {
      errors.push(event);
    },
    modules: [
      {
        area: 'matches',
        createRouter(context) {
          expect(context.repository).toBe(repository);
          expect(context.clock).toBe(clock);
          expect(context.outcomeSink).toBe(sink);
          const router = Router();
          router.get(
            '/failure',
            asyncRoute(async () => {
              throw new Error('password:never-log-this');
            }),
          );
          router.post('/echo', (req, res) => res.json(req.body));
          return router;
        },
      },
    ],
  });
  try {
    await server.gameServer.listen(0);
    const addr = server.httpServer.address();
    if (!addr || typeof addr === 'string') throw new Error('No port');
    const origin = `http://127.0.0.1:${addr.port}`;
    expect((await request(origin, '/page')).text).toContain('test SPA');
    for (const route of ['/api', '/api/v9/unknown', '/api/v1/auth/login']) {
      const response = await request(origin, route);
      expect(response.status).toBe(404);
      const body = ApiErrorSchema.parse(JSON.parse(response.text));
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.requestId).toBe(response.headers['x-request-id']);
    }
    const failed = await request(origin, '/api/v1/matches/failure', { headers: { 'x-request-id': 'untrusted' } });
    const failure = ApiErrorSchema.parse(JSON.parse(failed.text));
    expect(failed.status).toBe(500);
    expect(JSON.stringify(failure)).not.toContain('password');
    expect(failure.requestId).not.toBe('untrusted');
    expect(errors[0].requestId).toBe(failure.requestId);
    for (const [body, status] of [
      ['{', 400],
      [JSON.stringify({ value: 'x'.repeat(33000) }), 413],
    ] as const) {
      const res = await request(origin, '/api/v1/matches/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect(res.status).toBe(status);
      expect(ApiErrorSchema.parse(JSON.parse(res.text)).error.code).toBe('INVALID_REQUEST');
    }
    const catalog = JSON.parse((await request(origin, '/api/v1/catalog')).text);
    expect(catalog.data.dataVersion).toBe(DEFAULT_DATA.version);
    expect((await request(origin, '/readyz')).status).toBe(200);
    unavailable = true;
    expect((await request(origin, '/readyz')).status).toBe(503);
    expect((await request(origin, '/healthz')).status).toBe(200);
  } finally {
    const first = server.close();
    expect(server.close()).toBe(first);
    await first;
    await rm(dir, { recursive: true, force: true });
  }
  expect(closed).toEqual([2, 1]);
  expect(server.httpServer.listening).toBe(false);
}, 15000);

test('runtime starts and closes sequentially; bind failure releases resources and a subsequent start succeeds', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'allstars-runtime-'));
  const config = readRuntimeConfig({ APP_ENV: 'test', ROOM_STORE_DIR: dir });
  try {
    const runtime = await startRuntime(config, 0);
    expect(runtime.recovery).toEqual({ total: 0, restored: 0, failed: 0 });
    await runtime.close();
    const again = await startRuntime(config, 0);
    await again.close();
    const occupied = createServer();
    // Occupy the same wildcard address as Colyseus; Windows can bind an IPv4-only
    // listener alongside a wildcard IPv6 listener on the same port.
    await new Promise<void>((resolve) => occupied.listen(0, resolve));
    const addr = occupied.address();
    if (!addr || typeof addr === 'string') throw new Error('No port');
    try {
      await expect(startRuntime(config, addr.port)).rejects.toThrow('Server startup failed');
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
    const recovered = await startRuntime(config, 0);
    await recovered.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
