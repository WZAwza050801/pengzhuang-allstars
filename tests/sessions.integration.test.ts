import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Router } from 'express';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { AccountRepository, Database, EmailAuthRepository, migrateDatabase } from '@pengzhuang/persistence';
import { readRuntimeConfig } from '../config/runtime';
import { createGameServer } from '../server/app';
import { Sessions, type SessionCredentials } from '../server/accounts/sessions';
import { WebSessions } from '../server/api/web-sessions';
import { asyncRoute } from '../server/api/http';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function request(origin: string, route: string, method = 'GET', headers: Record<string, string> = {}, body?: unknown) {
  return new Promise<{
    status: number;
    headers: import('node:http').IncomingHttpHeaders;
    data: ReturnType<typeof JSON.parse>;
  }>((resolve, reject) => {
    const call = httpRequest(
      new URL(route, origin),
      { method, headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const content = Buffer.concat(chunks).toString();
            resolve({ status: res.statusCode ?? 0, headers: res.headers, data: content ? JSON.parse(content) : null });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    call.setTimeout(15000, () => call.destroy(new Error('Test HTTP timeout')));
    call.on('error', reject);
    call.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

describe('secure sessions with real PostgreSQL and browser cookies', () => {
  let db: Database;
  let sessions: Sessions;
  let web: WebSessions;
  let server: ReturnType<typeof createGameServer>;
  let origin: string;
  let fixtureUserId: string;
  const secret = randomBytes(32).toString('base64url');
  const issuer = 'https://game.example.test';
  const allowedOrigins = [issuer];

  beforeAll(async () => {
    const cfg = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
    if (!cfg.databaseUrl) throw new Error('Real isolated PostgreSQL required');
    db = new Database({ connectionString: cfg.databaseUrl });
    await migrateDatabase(db);
    sessions = new Sessions(db, secret, issuer);
    web = new WebSessions(sessions, { cookieSecure: true, allowedOrigins }, secret);
    server = createGameServer({
      repository: db,
      clientDirectory: null,
      modules: [
        web.module(),
        {
          area: 'me',
          createRouter() {
            const router = Router();
            router.use(web.boundary);
            // Test-only adapter supplies an already-authenticated fixture identity.
            // Actual password + session issuance is exercised in email-auth.integration.
            router.post(
              '/fixture',
              asyncRoute(async (req, res) => {
                const credentials = await db.transaction((tx) => sessions.issue(tx, fixtureUserId, web.csrf(req)));
                web.setCredentials(res, credentials);
                res.json({ ok: true, data: { userId: fixtureUserId } });
              }),
            );
            router.get('/probe', web.requireAccess, (_req, res) => res.json({ ok: true, data: res.locals.principal }));
            router.post('/probe', web.requireAccess, (_req, res) => res.json({ ok: true, data: res.locals.principal }));
            return router;
          },
        },
      ],
    });
    await server.gameServer.listen(0);
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No server address');
    origin = `http://localhost:${address.port}`;
    allowedOrigins.push(origin);
  });
  afterAll(async () => {
    await server?.close();
    await db?.close();
  });

  async function issue(csrf = randomBytes(32).toString('base64url'), userId?: string) {
    userId ??= (await new AccountRepository(db).createUser()).id;
    return { userId, csrf, ...(await db.transaction((tx) => sessions.issue(tx, userId, csrf))) };
  }
  const sid = (credentials: SessionCredentials) => credentials.refreshToken.split('.')[0];

  test('stores only credential hashes, caps lifetime, and checks durable revocation/status on every authentication', async () => {
    const credentials = await issue();
    const principal = await sessions.authenticate(credentials.accessToken);
    expect(principal.userId).toBe(credentials.userId);
    const row = (await db.query('SELECT * FROM sessions WHERE id = $1', [principal.sessionId])).rows[0];
    expect(row.refresh_token_hash).toBe(digest(credentials.refreshToken));
    expect(row.csrf_token_hash).toBe(digest(credentials.csrf));
    expect(JSON.stringify(row).includes(credentials.refreshToken)).toBe(false);
    expect(row.expires_at.getTime() - row.created_at.getTime()).toBeLessThanOrEqual(30 * 86_400_000);
    const recreated = new Sessions(db, secret, issuer);
    expect(await recreated.authenticate(credentials.accessToken)).toEqual(principal);
    await new AccountRepository(db).transitionStatus(credentials.userId, 'banned');
    await expect(recreated.authenticate(credentials.accessToken)).rejects.toMatchObject({ status: 401 });
    await expect(recreated.refresh(credentials.refreshToken, credentials.csrf)).rejects.toMatchObject({ status: 401 });
    await new AccountRepository(db).transitionStatus(credentials.userId, 'active');
    await new AccountRepository(db).revokeSession({ userId: credentials.userId, sessionId: principal.sessionId });
    await expect(sessions.authenticate(credentials.accessToken)).rejects.toMatchObject({ status: 401 });
  });

  test('parallel refresh retries return the same successor and stay valid across service instances', async () => {
    const credentials = await issue();
    const recreated = new Sessions(db, secret, issuer);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 ? sessions : recreated).refresh(credentials.refreshToken, credentials.csrf),
      ),
    );
    expect(new Set(results.map((result) => result.refreshToken)).size).toBe(1);
    expect(results[0].refreshToken).not.toBe(credentials.refreshToken);
    expect(results.every((result) => result.expiresAt.getTime() === credentials.expiresAt.getTime())).toBe(true);
    const next = await recreated.refresh(results[0].refreshToken, credentials.csrf);
    const delayed = await sessions.refresh(credentials.refreshToken, credentials.csrf);
    expect(delayed.refreshToken).toBe(next.refreshToken);
    expect(
      (await db.query('SELECT refresh_generation, revoked_at FROM sessions WHERE id = $1', [sid(credentials)])).rows[0],
    ).toMatchObject({ refresh_generation: 2, revoked_at: null });
    expect(
      (await db.query('SELECT * FROM session_refresh_history WHERE session_id = $1', [sid(credentials)])).rows,
    ).toHaveLength(2);
    expect(await recreated.authenticate(delayed.accessToken)).toMatchObject({ userId: credentials.userId });
  });

  test('replay after the grace window commits family revocation while another device remains valid', async () => {
    const credentials = await issue();
    const other = await issue(randomBytes(32).toString('base64url'), credentials.userId);
    const next = await sessions.refresh(credentials.refreshToken, credentials.csrf);
    await db.query(
      "UPDATE session_refresh_history SET consumed_at = clock_timestamp() - interval '11 seconds' WHERE session_id = $1",
      [sid(credentials)],
    );
    await expect(sessions.refresh(credentials.refreshToken, credentials.csrf)).rejects.toMatchObject({ status: 401 });
    expect(
      (await db.query('SELECT revoked_at FROM sessions WHERE id = $1', [sid(credentials)])).rows[0].revoked_at,
    ).not.toBeNull();
    await expect(sessions.authenticate(next.accessToken)).rejects.toMatchObject({ status: 401 });
    await expect(sessions.refresh(next.refreshToken, credentials.csrf)).rejects.toMatchObject({ status: 401 });
    expect(await sessions.authenticate(other.accessToken)).toMatchObject({ userId: credentials.userId });
  });

  test('unknown/forged refresh and mismatched CSRF do not revoke or rotate a legitimate session', async () => {
    const credentials = await issue();
    const forged = `${sid(credentials)}.0.${randomBytes(32).toString('base64url')}`;
    for (const token of ['bad', forged])
      await expect(sessions.refresh(token, credentials.csrf)).rejects.toMatchObject({ status: 401 });
    await expect(sessions.refresh(credentials.refreshToken, 'wrong-csrf')).rejects.toMatchObject({ status: 403 });
    await expect(sessions.authenticate(credentials.accessToken, 'wrong-csrf')).rejects.toMatchObject({ status: 403 });
    expect(await sessions.authenticate(credentials.accessToken, credentials.csrf)).toMatchObject({
      userId: credentials.userId,
    });
    expect(
      (await db.query('SELECT refresh_generation, revoked_at FROM sessions WHERE id = $1', [sid(credentials)])).rows[0],
    ).toMatchObject({ refresh_generation: 0, revoked_at: null });
  });

  test('expired database sessions reject unexpired signed tokens and refresh', async () => {
    const credentials = await issue();
    await db.query(
      "UPDATE sessions SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE id = $1",
      [sid(credentials)],
    );
    await expect(sessions.authenticate(credentials.accessToken)).rejects.toMatchObject({ status: 401 });
    await expect(sessions.refresh(credentials.refreshToken, credentials.csrf)).rejects.toMatchObject({ status: 401 });
  });

  test('failed rotation rolls back both history and successor so retry succeeds', async () => {
    const credentials = await issue();
    await db.query(
      "CREATE FUNCTION session_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected rotation failure'; END $$",
    );
    await db.query(
      'CREATE TRIGGER session_test_failure BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION session_test_failure()',
    );
    try {
      await expect(sessions.refresh(credentials.refreshToken, credentials.csrf)).rejects.toThrow(
        'injected rotation failure',
      );
      expect(
        (await db.query('SELECT * FROM session_refresh_history WHERE session_id = $1', [sid(credentials)])).rows,
      ).toHaveLength(0);
      expect(
        (await db.query('SELECT refresh_token_hash FROM sessions WHERE id = $1', [sid(credentials)])).rows[0]
          .refresh_token_hash,
      ).toBe(digest(credentials.refreshToken));
    } finally {
      await db.query('DROP TRIGGER session_test_failure ON sessions');
      await db.query('DROP FUNCTION session_test_failure()');
    }
    expect((await sessions.refresh(credentials.refreshToken, credentials.csrf)).refreshToken).not.toBe(
      credentials.refreshToken,
    );
  });

  test('password-reset locking rejects a waiting refresh after revocation commits', async () => {
    const credentials = await issue();
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reset = db.transaction(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [credentials.userId]);
      locked();
      await ready;
      await tx.query('UPDATE sessions SET revoked_at = clock_timestamp() WHERE user_id = $1 AND revoked_at IS NULL', [
        credentials.userId,
      ]);
    });
    await acquired;
    const refreshing = sessions.refresh(credentials.refreshToken, credentials.csrf);
    release();
    await reset;
    await expect(refreshing).rejects.toMatchObject({ status: 401 });
    await expect(sessions.authenticate(credentials.accessToken)).rejects.toMatchObject({ status: 401 });
  });

  test('a login waiting on password reset re-reads the committed credential after acquiring the user lock', async () => {
    const account = new AccountRepository(db);
    const user = await account.createUser();
    const email = `race-${user.id}@example.test`;
    await account.linkIdentity({
      userId: user.id,
      provider: 'email',
      providerAppId: 'primary',
      providerSubject: email,
    });
    await account.setPasswordCredential({ userId: user.id, passwordHash: 'old-hash-sql-isolation-fixture' });
    await db.query('UPDATE auth_identities SET verified_at = clock_timestamp() WHERE user_id = $1', [user.id]);
    let acquired!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    let release!: () => void;
    const canCommit = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reset = db.transaction(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      await new AccountRepository(tx).setPasswordCredential({
        userId: user.id,
        passwordHash: 'new-hash-sql-isolation-fixture',
      });
      acquired();
      await canCommit;
    });
    await locked;
    const login = db.transaction((tx) =>
      new EmailAuthRepository(tx).authenticate(email, async (hash) => hash === 'old-hash-sql-isolation-fixture'),
    );
    let blocked = false;
    try {
      for (let index = 0; index < 100; index++) {
        blocked =
          (
            await db.query(
              "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE OF u%'",
            )
          ).rowCount !== 0;
        if (blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      release();
    }
    await reset;
    const result = await login;
    expect(blocked).toBe(true);
    expect(result).toBeNull();
  });

  test('a revocation transaction that began before session creation uses actual revocation time', async () => {
    for (const action of ['all', 'one']) {
      let credentials!: Awaited<ReturnType<typeof issue>>;
      await db.transaction(async (tx) => {
        await tx.query('SELECT now()');
        await new Promise((resolve) => setTimeout(resolve, 5));
        credentials = await issue();
        if (action === 'all') await new EmailAuthRepository(tx).revokeSessions(credentials.userId);
        else
          expect(
            await new AccountRepository(tx).revokeSession({ userId: credentials.userId, sessionId: sid(credentials) }),
          ).toBe(true);
      });
      await expect(sessions.authenticate(credentials.accessToken)).rejects.toMatchObject({ status: 401 });
    }
  });

  async function csrfHeaders() {
    const response = await request(origin, '/api/v1/auth/csrf', 'GET', { origin });
    const csrf = response.data.data.csrfToken;
    return { origin, cookie: `${web.names.csrf}=${csrf}`, 'x-csrf-token': csrf };
  }
  test('HTTP enforces Origin/CSRF, strict refresh bodies, allowlisted CORS and secure cookie attributes', async () => {
    fixtureUserId = (await new AccountRepository(db).createUser()).id;
    const headers = await csrfHeaders();
    const login = await request(origin, '/api/v1/me/fixture', 'POST', headers, {});
    expect(login.status).toBe(200);
    const cookies = login.headers['set-cookie']!;
    expect(cookies).toHaveLength(2);
    expect(
      cookies.every(
        (value) =>
          value.startsWith('__Host-') &&
          value.includes('HttpOnly') &&
          value.includes('Secure') &&
          value.includes('SameSite=Lax') &&
          value.includes('Path=/') &&
          !value.includes('Domain='),
      ),
    ).toBe(true);
    headers.cookie += `; ${cookies.map((value) => value.split(';')[0]).join('; ')}`;
    expect((await request(origin, '/api/v1/me/probe', 'GET', headers)).data.data.userId).toBe(fixtureUserId);
    const missingOrigin = { ...headers };
    delete (missingOrigin as Partial<typeof headers>).origin;
    const missingCsrf = { ...headers };
    delete (missingCsrf as Partial<typeof headers>)['x-csrf-token'];
    for (const invalid of [
      missingOrigin,
      missingCsrf,
      { ...headers, 'x-csrf-token': 'wrong' },
      { ...headers, origin: 'https://evil.example' },
      { ...headers, origin: 'null' },
    ]) {
      expect((await request(origin, '/api/v1/auth/refresh', 'POST', invalid, {})).status).toBe(403);
    }
    expect(
      (await request(origin, '/api/v1/auth/refresh', 'POST', headers, { refreshToken: 'client-supplied' })).status,
    ).toBe(400);
    expect((await request(origin, '/api/v1/auth/refresh', 'POST', headers, [])).status).toBe(400);
    expect((await request(origin, '/api/v1/auth/refresh', 'POST', headers, {})).status).toBe(200);
    const preflight = await request(origin, '/api/v1/auth/refresh', 'OPTIONS', {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,x-csrf-token',
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    expect(preflight.headers.vary).toContain('Origin');
    const forbidden = await request(origin, '/api/v1/auth/refresh', 'OPTIONS', {
      origin: 'https://evil.example',
      'access-control-request-method': 'POST',
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers['access-control-allow-origin']).toBeUndefined();
    expect(
      (await request(origin, '/api/v1/auth/refresh', 'OPTIONS', { origin, 'access-control-request-method': 'TRACE' }))
        .status,
    ).toBe(403);
    expect(
      (
        await request(origin, '/api/v1/auth/refresh', 'OPTIONS', {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'x-arbitrary',
        })
      ).status,
    ).toBe(403);
  });

  test('credential ambiguity and another session CSRF are rejected by the reusable auth middleware', async () => {
    const headers = await csrfHeaders();
    const credentials = await issue(headers['x-csrf-token']);
    const valid = { ...headers, cookie: `${headers.cookie}; ${web.names.access}=${credentials.accessToken}` };
    expect((await request(origin, '/api/v1/me/probe', 'POST', valid, {})).status).toBe(200);
    const other = await csrfHeaders();
    expect(
      (
        await request(
          origin,
          '/api/v1/me/probe',
          'POST',
          { ...other, cookie: `${other.cookie}; ${web.names.access}=${credentials.accessToken}` },
          {},
        )
      ).status,
    ).toBe(403);
    expect(
      (await request(origin, '/api/v1/me/probe', 'GET', { authorization: `Bearer ${credentials.accessToken}` })).status,
    ).toBe(200);
    expect(
      (
        await request(origin, '/api/v1/me/probe', 'GET', {
          ...valid,
          authorization: `Bearer ${credentials.accessToken}`,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(origin, '/api/v1/me/probe', 'GET', {
          cookie: `${web.names.access}=${credentials.accessToken}; ${web.names.access}=${credentials.accessToken}`,
        })
      ).status,
    ).toBe(403);
    expect((await request(origin, '/api/v1/me/probe')).status).toBe(401);
  });

  test('Chromium honors HttpOnly cookies; multiple tabs refresh using shared cookies without losing login', async () => {
    fixtureUserId = (await new AccountRepository(db).createUser()).id;
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${origin}/healthz`);
      const csrf = await page.evaluate(async () => (await (await fetch('/api/v1/auth/csrf')).json()).data.csrfToken);
      expect(
        await page.evaluate(
          async (token) =>
            (
              await fetch('/api/v1/me/fixture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
                body: '{}',
              })
            ).status,
          csrf,
        ),
      ).toBe(200);
      const cookies = await context.cookies();
      expect(
        cookies
          .filter((cookie) => cookie.httpOnly)
          .map((cookie) => cookie.name)
          .sort(),
      ).toEqual([web.names.access, web.names.refresh].sort());
      expect(cookies.every((cookie) => cookie.secure && cookie.sameSite === 'Lax')).toBe(true);
      const readable = await page.evaluate(() => document.cookie);
      expect(readable).toContain(web.names.csrf);
      expect(readable).not.toContain(`${web.names.access}=`);
      expect(readable).not.toContain(`${web.names.refresh}=`);
      expect(
        await page.evaluate(
          async () =>
            (
              await fetch('/api/v1/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
              })
            ).status,
        ),
      ).toBe(403);
      const second = await context.newPage();
      await second.goto(`${origin}/healthz`);
      const statuses = await Promise.all(
        [page, second, page, second].map((tab) =>
          tab.evaluate(
            async (token) =>
              (
                await fetch('/api/v1/auth/refresh', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
                  body: '{}',
                })
              ).status,
            csrf,
          ),
        ),
      );
      expect(statuses).toEqual([200, 200, 200, 200]);
      for (const tab of [page, second])
        expect(await tab.evaluate(async () => (await (await fetch('/api/v1/me/probe')).json()).data.userId)).toBe(
          fixtureUserId,
        );
      await context.close();
    } finally {
      await browser.close();
    }
  });
});
