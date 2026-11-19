import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, test, vi } from 'vitest';
import path from 'node:path';
import { AccountRepository, Database, migrateDatabase } from '@pengzhuang/persistence';
import { readRuntimeConfig } from '../config/runtime';
import { createGameServer } from '../server/app';
import { Sessions } from '../server/accounts/sessions';
import { WechatProvider } from '../server/accounts/wechat-provider';
import { WechatAccounts } from '../server/accounts/wechat-accounts';
import { WebSessions } from '../server/api/web-sessions';
import { wechatAuthModule } from '../server/api/wechat-auth';
import { currentUserModule } from '../server/api/current-user';
import { jsonRequest } from './helpers/json-http';
import { startRuntime } from '../server/runtime';

describe('WeChat provider mock contract with real PostgreSQL and HTTP', () => {
  let db: Database;
  let server: ReturnType<typeof createGameServer>;
  let origin: string;
  let web: WebSessions;
  let accounts: WechatAccounts;
  let sessions: Sessions;
  let mode: (code: string) => Promise<Response>;
  const signingKey = randomBytes(32).toString('base64url');
  const appId = 'wx0000000000000001';
  const secret = 'fake-private-WeChat-credential';
  const issuer = 'http://localhost:2567';
  const calls: string[] = [];
  const upstream: typeof fetch = async (input) => {
    const url = new URL(String(input));
    expect(url.searchParams.get('appid')).toBe(appId);
    expect(url.searchParams.get('secret')).toBe(secret);
    const code = url.searchParams.get('js_code')!;
    calls.push(code);
    return mode(code);
  };
  const accepted = (openId: string, unionid = 'same-unverified-union') =>
    Response.json({ openid: openId, session_key: 'private-upstream-session-key', unionid });
  beforeAll(async () => {
    const cfg = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
    if (!cfg.databaseUrl) throw new Error('Real isolated PostgreSQL required');
    db = new Database({ connectionString: cfg.databaseUrl });
    await migrateDatabase(db);
    sessions = new Sessions(db, signingKey, issuer);
    web = new WebSessions(sessions, { cookieSecure: false, allowedOrigins: [issuer] }, signingKey);
    accounts = new WechatAccounts(db, new WechatProvider({ appId, secret }, upstream), signingKey);
    server = createGameServer({
      repository: db,
      clientDirectory: null,
      modules: [web.module(), currentUserModule(web), wechatAuthModule(accounts, web)],
    });
    await server.gameServer.listen(0);
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await server?.close();
    await db?.close();
  });
  async function headers() {
    const csrf = (await jsonRequest(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
    return { origin: issuer, cookie: `pz_csrf=${csrf}`, 'x-csrf-token': csrf };
  }
  const exchange = (code: string, requestHeaders: Record<string, string>) =>
    jsonRequest(origin, '/api/v1/auth/wechat/exchange', { method: 'POST', headers: requestHeaders, body: { code } });
  const context = () => ({
    service: sessions,
    csrf: randomBytes(32).toString('base64url'),
    deviceKind: 'mobile' as const,
  });

  test('maps only the verified scope, issues application cookies and never returns upstream secrets', async () => {
    const openId = `openid-${randomUUID()}`;
    const code = randomUUID();
    const requestHeaders = await headers();
    mode = async () => accepted(openId);
    const response = await exchange(code, requestHeaders);
    expect(response.status).toBe(200);
    expect(response.headers['set-cookie']).toHaveLength(2);
    const userId = response.data.data.userId;
    expect(Object.keys(response.data.data)).toEqual(['userId']);
    for (const value of [openId, code, secret, 'private-upstream-session-key', 'same-unverified-union'])
      expect(JSON.stringify(response.data)).not.toContain(value);
    const identity = await new AccountRepository(db).findUserByIdentity({
      provider: 'wechat',
      providerAppId: appId,
      providerSubject: openId,
    });
    expect(identity?.id).toBe(userId);
    const cookie = `${requestHeaders.cookie}; ${response.headers['set-cookie']!.map((value) => value.split(';')[0]).join('; ')}`;
    expect((await jsonRequest(origin, '/api/v1/me', { headers: { cookie } })).data.data.userId).toBe(userId);
    const attempt = (await db.query('SELECT * FROM wechat_code_attempts WHERE user_id = $1', [userId])).rows[0];
    expect(attempt.status).toBe('succeeded');
    expect(attempt.code_hash).toMatch(/^[0-9a-f]{64}$/);
    for (const value of [code, secret, 'private-upstream-session-key', 'same-unverified-union'])
      expect(JSON.stringify(attempt)).not.toContain(value);
  });

  test('rejects duplicated and concurrent codes before upstream work and keeps this decision across instances', async () => {
    const code = randomUUID();
    const requestHeaders = await headers();
    const start = calls.length;
    mode = async () => accepted(`replay-${randomUUID()}`);
    const responses = await Promise.all([exchange(code, requestHeaders), exchange(code, requestHeaders)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(calls.length - start).toBe(1);
    const recreated = new WechatAccounts(db, new WechatProvider({ appId, secret }, upstream), signingKey);
    await expect(recreated.login(code, randomUUID(), context())).rejects.toMatchObject({ status: 409 });
    expect(calls.length - start).toBe(1);
  });

  test('simultaneous different codes for one OpenID converge on one user without orphan accounts', async () => {
    const openId = `parallel-${randomUUID()}`;
    const before = (await db.query('SELECT count(*)::int AS count FROM users')).rows[0].count;
    const requestHeaders = await headers();
    mode = async () => accepted(openId);
    const codes = Array.from({ length: 4 }, () => randomUUID());
    const responses = await Promise.all(codes.map((code) => exchange(code, requestHeaders)));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    expect(new Set(responses.map((response) => response.data.data.userId)).size).toBe(1);
    expect((await db.query('SELECT count(*)::int AS count FROM users')).rows[0].count).toBe(before + 1);
    for (const code of codes) expect(calls.filter((seen) => seen === code)).toHaveLength(1);
  });

  test('AppID namespaces and unqualified UnionID never silently merge identities', async () => {
    const openId = `isolated-${randomUUID()}`;
    mode = async () => accepted(openId);
    const one = await accounts.login(randomUUID(), randomUUID(), context());
    const otherApp = 'wx0000000000000002';
    const other = new WechatAccounts(
      db,
      new WechatProvider({ appId: otherApp, secret }, async () => accepted(openId)),
      signingKey,
    );
    const two = await other.login(randomUUID(), randomUUID(), context());
    expect(one.userId).not.toBe(two.userId);
    mode = async () => accepted(`another-${randomUUID()}`);
    const three = await accounts.login(randomUUID(), randomUUID(), context());
    expect(three.userId).not.toBe(one.userId);
  });

  test('provider errors and ambiguous response loss consume the attempt, redact details and require a fresh code', async () => {
    const code = randomUUID();
    const requestHeaders = await headers();
    const before = calls.length;
    mode = async () => {
      throw new Error(`${secret}:${code}:private-upstream-session-key`);
    };
    const response = await exchange(code, requestHeaders);
    expect(response.status).toBe(503);
    expect(response.headers['set-cookie']).toBeUndefined();
    for (const value of [secret, code, 'private-upstream-session-key'])
      expect(JSON.stringify(response.data)).not.toContain(value);
    expect((await exchange(code, requestHeaders)).status).toBe(409);
    expect(calls.length).toBe(before + 1);
    mode = async () => Response.json({ errcode: 40029, errmsg: secret });
    expect((await exchange(randomUUID(), requestHeaders)).status).toBe(401);
  });

  test('banned or deleting identities cannot obtain a new session', async () => {
    for (const status of ['banned', 'deleting'] as const) {
      const openId = `${status}-${randomUUID()}`;
      mode = async () => accepted(openId);
      const initial = await accounts.login(randomUUID(), randomUUID(), context());
      await new AccountRepository(db).transitionStatus(initial.userId, status);
      const before = (
        await db.query('SELECT count(*)::int AS count FROM sessions WHERE user_id = $1', [initial.userId])
      ).rows[0].count;
      await expect(accounts.login(randomUUID(), randomUUID(), context())).rejects.toMatchObject({ status: 401 });
      expect(
        (await db.query('SELECT count(*)::int AS count FROM sessions WHERE user_id = $1', [initial.userId])).rows[0]
          .count,
      ).toBe(before);
    }
  });

  test('session persistence failure rolls back new identity, account and credentials; old code is still consumed', async () => {
    const openId = `rollback-${randomUUID()}`;
    const code = randomUUID();
    const requestHeaders = await headers();
    mode = async () => accepted(openId);
    const before = (await db.query('SELECT count(*)::int AS count FROM users')).rows[0].count;
    await db.query(
      "CREATE FUNCTION wechat_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected session persistence failure'; END $$",
    );
    await db.query(
      'CREATE TRIGGER wechat_test_failure BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION wechat_test_failure()',
    );
    try {
      const response = await exchange(code, requestHeaders);
      expect(response.status).toBe(500);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect((await db.query('SELECT count(*)::int AS count FROM users')).rows[0].count).toBe(before);
      expect(
        (await db.query('SELECT id FROM auth_identities WHERE provider_subject = $1', [openId])).rows,
      ).toHaveLength(0);
    } finally {
      await db.query('DROP TRIGGER wechat_test_failure ON sessions');
      await db.query('DROP FUNCTION wechat_test_failure()');
    }
    expect((await exchange(code, requestHeaders)).status).toBe(409);
    expect((await exchange(randomUUID(), requestHeaders)).status).toBe(200);
  });

  test('expired local attempt cannot commit an identity or session after upstream response', async () => {
    const openId = `deadline-${randomUUID()}`;
    const before = (await db.query('SELECT count(*)::int AS count FROM users')).rows[0].count;
    mode = async () => {
      await db.query(
        "UPDATE wechat_code_attempts SET created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 hour' WHERE status = 'pending'",
      );
      return accepted(openId);
    };
    expect((await exchange(randomUUID(), await headers())).status).toBe(401);
    expect((await db.query('SELECT count(*)::int AS count FROM users')).rows[0].count).toBe(before);
  });

  test('the HTTP boundary rejects injected app/identity claims and missing CSRF without consuming a code', async () => {
    const code = randomUUID();
    const before = calls.length;
    const requestHeaders = await headers();
    for (const extra of [
      { appId: 'attacker' },
      { openid: 'forged' },
      { userId: randomUUID() },
      { unionid: 'forged' },
    ]) {
      expect(
        (
          await jsonRequest(origin, '/api/v1/auth/wechat/exchange', {
            method: 'POST',
            headers: requestHeaders,
            body: { code, ...extra },
          })
        ).status,
      ).toBe(400);
    }
    expect((await exchange(code, {})).status).toBe(403);
    expect((await exchange(code, { ...requestHeaders, origin: 'https://unapproved.example' })).status).toBe(403);
    expect(calls.length).toBe(before);
  });

  test('durable IP limit cannot be reset by a new service instance', async () => {
    const source = randomUUID();
    const key = createHash('sha256').update(`wechat-login:${appId}:${source}`).digest('hex');
    await db.query(
      'INSERT INTO auth_rate_limits(key_hash, bucket_start, attempts) VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / 900) * 900), 50)',
      [key],
    );
    const recreated = new WechatAccounts(db, new WechatProvider({ appId, secret }, upstream), signingKey);
    const before = calls.length;
    await expect(recreated.login(randomUUID(), source, context())).rejects.toMatchObject({ status: 429 });
    expect(calls.length).toBe(before);
  });

  test('configured runtime mounts the enabled provider and issues usable sessions through its real lifecycle', async () => {
    await server.close();
    const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(upstream);
    try {
      mode = async () => accepted(`runtime-${randomUUID()}`);
      const cfg = readRuntimeConfig({
        ...process.env,
        APP_ENV: 'test',
        PUBLIC_ORIGIN: issuer,
        ALLOWED_ORIGINS: issuer,
        WECHAT_ENABLED: 'true',
        WECHAT_APP_ID: appId,
        WECHAT_APP_SECRET: secret,
        SESSION_SIGNING_KEY: signingKey,
        EMAIL_PROVIDER: 'disabled',
        DEV_AUTH_BYPASS: 'false',
        COOKIE_SECURE: 'false',
        ROOM_STORE_DIR: path.join(process.env.PG_TEST_TMP_DIR!, 'wechat-runtime-rooms'),
      });
      server = await startRuntime(cfg, 0);
      const address = server.httpServer.address();
      if (!address || typeof address === 'string') throw new Error('No runtime port');
      origin = `http://127.0.0.1:${address.port}`;
      const requestHeaders = await headers();
      const response = await exchange(randomUUID(), requestHeaders);
      expect(response.status).toBe(200);
      const cookie = `${requestHeaders.cookie}; ${response.headers['set-cookie']!.map((value) => value.split(';')[0]).join('; ')}`;
      expect((await jsonRequest(origin, '/api/v1/me', { headers: { cookie } })).data.data.userId).toBe(
        response.data.data.userId,
      );
      await server.close();
    } finally {
      transport.mockRestore();
    }
  });
});
