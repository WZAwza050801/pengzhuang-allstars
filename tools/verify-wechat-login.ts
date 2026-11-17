import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { readRuntimeConfig } from '../config/runtime';
import { CurrentUserSchema } from '../packages/contracts/src/accounts';
import { Database } from '../packages/persistence/src/database';
import { migrateDatabase } from '../packages/persistence/src/migrations';
import { startRuntime } from '../server/runtime';

let phase = 'configuration';
const reportFile = `work/wechat-acceptance-${randomUUID()}.json`;
let server: Awaited<ReturnType<typeof startRuntime>> | undefined;
let db: Database | undefined;
let roomFixture: string | undefined;
let verified = false;
try {
  // Explicit opt-in and test DSN; no production fallback or secret CLI arguments.
  if (process.env.WECHAT_ACCEPTANCE !== '1' || process.env.APP_ENV !== 'test' || process.env.NODE_ENV === 'production')
    throw new Error();
  const code = process.env.WECHAT_ACCEPT_VALID_CODE;
  const expired = process.env.WECHAT_ACCEPT_EXPIRED_CODE;
  if (!code || !expired || code === expired) throw new Error();
  const config = readRuntimeConfig({
    ...process.env,
    WECHAT_ENABLED: 'true',
    EMAIL_PROVIDER: 'disabled',
    PORT: '0',
    PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN ?? 'http://localhost:2567',
  });
  if (!config.databaseUrl || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.databaseUrl).hostname))
    throw new Error();
  db = new Database({ connectionString: config.databaseUrl });
  phase = 'migration';
  await migrateDatabase(db);
  phase = 'runtime';
  roomFixture = await mkdtemp(path.join(os.tmpdir(), 'allstars-wechat-acceptance-'));
  server = await startRuntime({ ...config, roomStoreDir: roomFixture }, 0);
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error();
  const origin = `http://127.0.0.1:${address.port}`;
  const cookies = new Map<string, string>();
  let csrf = '';
  async function call(route: string, body?: unknown, extra: Record<string, string> = {}) {
    const response = await fetch(`${origin}/api/v1${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        Origin: config.allowedOrigins[0],
        Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value) cookies.set(name, value);
      else cookies.delete(name);
    }
    return { status: response.status, data: (await response.json()) as ReturnType<typeof JSON.parse> };
  }
  phase = 'csrf';
  const bootstrap = await call('/auth/csrf');
  assert.equal(bootstrap.status, 200);
  csrf = z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/)
    .parse(bootstrap.data.data.csrfToken);
  phase = 'valid-code';
  const login = await call('/auth/wechat/exchange', { code });
  assert.equal(login.status, 200);
  const userId = z.uuid().parse(login.data.data.userId);
  phase = 'current-user';
  const me = await call('/me');
  assert.equal(me.status, 200);
  assert.equal(CurrentUserSchema.parse(me.data.data).userId, userId);
  phase = 'replay';
  assert.equal((await call('/auth/wechat/exchange', { code })).status, 409);
  phase = 'expired-code';
  assert.equal((await call('/auth/wechat/exchange', { code: expired })).status, 401);
  phase = 'logout';
  assert.equal((await call('/auth/logout', { allSessions: false }, { 'Idempotency-Key': randomUUID() })).status, 200);
  assert.equal((await call('/me')).status, 401);
  verified = true;
} catch {
  // Assertion/fetch/config errors can contain codes/cookies/secrets. Print only our fixed phase.
  console.error(
    JSON.stringify({
      event: 'wechat_acceptance_failed',
      phase,
      required:
        phase === 'configuration'
          ? [
              'WECHAT_ACCEPTANCE=1',
              'APP_ENV=test',
              'TEST_DATABASE_URL',
              'SESSION_SIGNING_KEY',
              'WECHAT_APP_ID',
              'WECHAT_APP_SECRET',
              'WECHAT_ACCEPT_VALID_CODE',
              'WECHAT_ACCEPT_EXPIRED_CODE',
            ]
          : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  await server?.close().catch(() => {
    console.error(JSON.stringify({ event: 'wechat_acceptance_cleanup_failed', resource: 'runtime' }));
    process.exitCode = 1;
  });
  await db?.close().catch(() => {
    console.error(JSON.stringify({ event: 'wechat_acceptance_cleanup_failed', resource: 'database' }));
    process.exitCode = 1;
  });
  if (
    roomFixture &&
    path.dirname(roomFixture) === path.resolve(os.tmpdir()) &&
    path.basename(roomFixture).startsWith('allstars-wechat-acceptance-')
  ) {
    await rm(roomFixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {
      console.error(JSON.stringify({ event: 'wechat_acceptance_cleanup_failed', resource: 'rooms' }));
      process.exitCode = 1;
    });
  }
}
if (verified && process.exitCode !== 1) {
  try {
    await mkdir('work', { recursive: true });
    await writeFile(
      reportFile,
      `${JSON.stringify({ date: new Date().toISOString(), mode: 'test', source: 'official code2Session', valid: true, currentUser: true, replayRejected: true, expiredRejected: true, logout: true }, null, 2)}\n`,
    );
    console.log(JSON.stringify({ event: 'wechat_acceptance_passed', cases: 6, report: reportFile }));
  } catch {
    console.error(JSON.stringify({ event: 'wechat_acceptance_failed', phase: 'report' }));
    process.exitCode = 1;
  }
}
