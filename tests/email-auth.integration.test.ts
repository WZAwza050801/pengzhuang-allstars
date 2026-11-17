import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { AccountRepository, Database, EmailAuthRepository, migrateDatabase } from '@pengzhuang/persistence';
import { readRuntimeConfig } from '../config/runtime';
import { createGameServer } from '../server/app';
import { EmailAccounts } from '../server/accounts/email-accounts';
import { createAccountMail } from '../server/accounts/mail';
import { emailAuthModule } from '../server/api/email-auth';
import { startRuntime } from '../server/runtime';
import { Sessions } from '../server/accounts/sessions';
import { WebSessions } from '../server/api/web-sessions';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
async function port() {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}
function request(origin: string, route: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    data: ReturnType<typeof JSON.parse>;
  }>((resolve, reject) => {
    const call = httpRequest(
      new URL(route, origin),
      { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...headers } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              data: JSON.parse(Buffer.concat(chunks).toString()),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    call.setTimeout(15000, () => call.destroy(new Error('Test HTTP timeout')));
    call.once('error', reject);
    call.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

describe('email account HTTP + real Mailpit SMTP + PostgreSQL', () => {
  let db: Database;
  let accounts: EmailAccounts;
  let server: ReturnType<typeof createGameServer>;
  let mailpit: ChildProcess;
  let origin: string;
  let inbox: string;
  let smtpPort: number;
  let csrf: string;
  const signingKey = randomBytes(32).toString('base64url');
  const password = 'correct-horse-游戏-12345';
  const source = () => randomUUID();
  const mailConfig = () =>
    readRuntimeConfig({
      APP_ENV: 'test',
      EMAIL_PROVIDER: 'mailpit',
      SMTP_URL: `smtp://127.0.0.1:${smtpPort}`,
      SESSION_SIGNING_KEY: signingKey,
      PUBLIC_ORIGIN: 'http://localhost:2567',
    });

  beforeAll(async () => {
    const config = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
    if (!config.databaseUrl || !process.env.PG_TEST_TMP_DIR)
      throw new Error('Isolated PostgreSQL and fixture directory required');
    db = new Database({ connectionString: config.databaseUrl });
    await migrateDatabase(db);
    smtpPort = await port();
    inbox = `http://127.0.0.1:${await port()}`;
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('MP_')) delete env[key];
    mailpit = spawn(
      process.env.MAILPIT_TEST_BIN ?? 'mailpit',
      [
        '--smtp',
        `127.0.0.1:${smtpPort}`,
        '--listen',
        new URL(inbox).host,
        '--database',
        path.join(process.env.PG_TEST_TMP_DIR, 'auth-mailpit.db'),
        '--disable-version-check',
        '--quiet',
      ],
      { env, stdio: 'ignore', windowsHide: true },
    );
    let failed = false;
    mailpit.on('error', () => {
      failed = true;
    });
    let ready = false;
    for (let index = 0; index < 100; index++) {
      if (failed || mailpit.exitCode !== null)
        throw new Error('Real Mailpit binary required (MAILPIT_TEST_BIN); no delivery mock allowed');
      try {
        ready = (await request(inbox, '/api/v1/messages')).status === 200;
      } catch {
        /* Startup wait. */
      }
      if (ready) break;
      await pause(50);
    }
    if (!ready) throw new Error('Mailpit did not become ready');
    accounts = new EmailAccounts(db, createAccountMail(mailConfig()), signingKey);
    const web = new WebSessions(new Sessions(db, signingKey, 'http://localhost:2567'), mailConfig(), signingKey);
    server = createGameServer({
      repository: db,
      clientDirectory: null,
      modules: [web.module(), emailAuthModule(accounts, web)],
    });
    await server.gameServer.listen(0);
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No HTTP port');
    origin = `http://127.0.0.1:${address.port}`;
    csrf = (await request(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
    accounts.startMailDelivery();
  }, 30000);

  afterAll(async () => {
    await accounts?.close();
    await server?.close();
    await db?.close();
    if (mailpit && mailpit.exitCode === null) {
      const exited = new Promise((resolve) => mailpit.once('exit', resolve));
      mailpit.kill();
      await exited;
    }
  });

  const post = (route: string, body: unknown, headers?: Record<string, string>) =>
    request(origin, `/api/v1/auth/${route}`, body, {
      origin: 'http://localhost:2567',
      cookie: `pz_csrf=${csrf}`,
      'x-csrf-token': csrf,
      ...headers,
    });
  async function deliveredToken(email: string, purpose: 'verify' | 'reset', exclude?: string): Promise<string> {
    for (let index = 0; index < 100; index++) {
      const list = (await request(inbox, '/api/v1/messages')).data;
      for (const item of list.messages ?? []) {
        if (!item.To?.some((to: { Address: string }) => to.Address === email)) continue;
        const message = (await request(inbox, `/api/v1/message/${item.ID}`)).data;
        const found = String(message.Text).match(new RegExp(`/account/${purpose}#([A-Za-z0-9_-]{43})`))?.[1];
        if (found && found !== exclude) return found;
      }
      await pause(50);
    }
    throw new Error('Expected real SMTP delivery was not observed');
  }
  async function verifiedAccount(email: string) {
    expect((await post('register', { email, password, nickname: '玩家' })).status).toBe(202);
    const token = await deliveredToken(email, 'verify');
    expect((await post('email/verify', { token })).status).toBe(200);
    return (await post('login', { email, password })).data.data.userId as string;
  }

  test('registers, receives a real SMTP message, verifies once and validates the password without leaking hashes', async () => {
    const email = 'registration@example.test';
    const response = await post('register', { email: email.toUpperCase(), password, nickname: '玩家' });
    expect(response.status).toBe(202);
    expect(response.headers['cache-control']).toBe('no-store');
    expect((await post('login', { email, password })).status).toBe(401);
    const token = await deliveredToken(email, 'verify');
    const stored = await db.query(
      'SELECT password_hash FROM password_credentials c JOIN auth_identities i ON c.user_id = i.user_id WHERE i.provider_subject = $1',
      [email],
    );
    expect(stored.rows[0].password_hash.startsWith('$argon2id$v=19$m=65536,t=3,p=1$')).toBe(true);
    expect(JSON.stringify((await db.query('SELECT token_hash FROM verification_tokens')).rows).includes(token)).toBe(
      false,
    );
    const results = await Promise.all([post('email/verify', { token }), post('email/verify', { token })]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    const loggedIn = await post('login', { email, password });
    expect(loggedIn.status).toBe(200);
    expect(Object.keys(loggedIn.data.data)).toEqual(['userId']);
    expect(loggedIn.headers['set-cookie']).toHaveLength(2);
    expect(
      (loggedIn.headers['set-cookie'] as string[]).every(
        (value) => value.includes('HttpOnly') && value.includes('SameSite=Lax'),
      ),
    ).toBe(true);
    expect(JSON.stringify(loggedIn.data).includes(password)).toBe(false);
  });

  test('concurrent duplicate registration has one identity and the same public acknowledgement', async () => {
    const email = 'duplicate@example.test';
    const results = await Promise.all([
      post('register', { email, password, nickname: 'A' }),
      post('register', { email: email.toUpperCase(), password: 'different-pass-123', nickname: 'B' }),
    ]);
    expect(results.map((result) => result.status)).toEqual([202, 202]);
    expect(results[0].data.data).toEqual(results[1].data.data);
    expect(
      (await db.query('SELECT count(*)::int AS count FROM auth_identities WHERE provider_subject = $1', [email]))
        .rows[0].count,
    ).toBe(1);
  });

  test('reset acknowledgements conceal account existence; reset is single-use and revokes sessions', async () => {
    const email = 'reset@example.test';
    const userId = await verifiedAccount(email);
    const login = await post('login', { email, password });
    const access = (login.headers['set-cookie'] as string[])
      .find((value) => value.startsWith('pz_access='))!
      .split(';')[0]
      .slice('pz_access='.length);
    const sessions = new Sessions(db, signingKey, 'http://localhost:2567');
    expect((await sessions.authenticate(access)).userId).toBe(userId);
    const session = await new AccountRepository(db).createSession({
      userId,
      refreshTokenHash: tokenHash('test-session'),
      familyId: randomUUID(),
      expiresAt: new Date(Date.now() + 60000),
    });
    const known = await post('password/reset-request', { email });
    const unknown = await post('password/reset-request', { email: 'missing@example.test' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.data.data).toEqual(unknown.data.data);
    const token = await deliveredToken(email, 'reset');
    expect((await post('email/verify', { token })).status).toBe(400);
    const nextPassword = 'new-password-012345';
    const resets = await Promise.all([
      post('password/reset', { token, password: nextPassword }),
      post('password/reset', { token, password: nextPassword }),
    ]);
    expect(resets.map((result) => result.status).sort()).toEqual([200, 400]);
    expect((await post('password/reset', { token, password: nextPassword })).status).toBe(400);
    expect((await post('login', { email, password })).status).toBe(401);
    expect((await post('login', { email, password: nextPassword })).status).toBe(200);
    await expect(sessions.authenticate(access)).rejects.toMatchObject({ status: 401 });
    expect(
      (await db.query('SELECT revoked_at FROM sessions WHERE id = $1', [session.id])).rows[0].revoked_at,
    ).not.toBeNull();
  });

  test('expired reset tokens and banned identities cannot authenticate', async () => {
    const email = 'expired@example.test';
    const userId = await verifiedAccount(email);
    await post('password/reset-request', { email });
    const token = await deliveredToken(email, 'reset');
    await db.query(
      "UPDATE verification_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE token_hash = $1",
      [tokenHash(token)],
    );
    expect((await post('password/reset', { token, password: 'expired-change-123' })).status).toBe(400);
    await new AccountRepository(db).transitionStatus(userId, 'banned');
    const banned = await post('login', { email, password });
    const unknown = await post('login', { email: 'unknown@example.test', password });
    expect(banned.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(banned.data.error).toEqual(unknown.data.error);
  });

  test('SMTP failure retains encrypted work; a new service instance can retry and clear it after real delivery', async () => {
    await accounts.close();
    const email = 'retry@example.test';
    await post('register', { email, password, nickname: '重试' });
    const brokenConfig = readRuntimeConfig({
      APP_ENV: 'test',
      EMAIL_PROVIDER: 'mailpit',
      SMTP_URL: `smtp://127.0.0.1:${await port()}`,
      SESSION_SIGNING_KEY: signingKey,
    });
    const broken = new EmailAccounts(db, createAccountMail(brokenConfig), signingKey);
    await broken.deliverPendingMail();
    const job = (
      await db.query(
        'SELECT j.* FROM account_mail_jobs j JOIN verification_tokens t ON j.token_hash = t.token_hash AND j.purpose = t.purpose JOIN auth_identities i ON i.user_id = t.user_id WHERE i.provider_subject = $1',
        [email],
      )
    ).rows[0];
    expect(job.attempts).toBe(1);
    expect(job.sent_at).toBeNull();
    expect(typeof job.encrypted_payload === 'string' && !job.encrypted_payload.includes(email)).toBe(true);
    await db.query('UPDATE account_mail_jobs SET next_attempt_at = now() WHERE id = $1', [job.id]);
    const restarted = new EmailAccounts(db, createAccountMail(mailConfig()), signingKey);
    await restarted.deliverPendingMail();
    await deliveredToken(email, 'verify');
    expect(
      (await db.query('SELECT encrypted_payload FROM account_mail_jobs WHERE id = $1', [job.id])).rows[0]
        .encrypted_payload,
    ).toBeNull();
    accounts.startMailDelivery();
  });

  test('rate limits survive service recreation and cannot be evaded by varying a request identifier', async () => {
    const ip = source();
    const email = 'limited@example.test';
    const session = { service: new Sessions(db, signingKey, 'http://localhost:2567'), csrf };
    for (let index = 0; index < 10; index++)
      await expect(accounts.login({ email, password }, ip, session)).rejects.toMatchObject({ status: 401 });
    const recreated = new EmailAccounts(db, createAccountMail(mailConfig()), signingKey);
    await expect(recreated.login({ email, password }, source(), session)).rejects.toMatchObject({ status: 429 });
  });

  test('invalid bodies, authority claims and unapproved origins are rejected at the HTTP boundary', async () => {
    expect((await post('register', { email: 'bad', password, nickname: '玩家' })).status).toBe(400);
    expect(
      (await post('register', { email: 'claims@example.test', password, nickname: '玩家', role: 'admin' })).status,
    ).toBe(400);
    expect((await post('password/reset', { token: 'bad', password })).status).toBe(400);
    expect(
      (await post('login', { email: 'unknown@example.test', password }, { origin: 'https://unapproved.example' }))
        .status,
    ).toBe(403);
  });

  test('verification resend replaces an expired token and keeps existence acknowledgements equal', async () => {
    const email = 'resend@example.test';
    await post('register', { email, password, nickname: '重发' });
    const previous = await deliveredToken(email, 'verify');
    await db.query(
      "UPDATE verification_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE token_hash = $1",
      [tokenHash(previous)],
    );
    const response = await post('email/verification-request', { email });
    const missing = await post('email/verification-request', { email: 'not-registered@example.test' });
    expect(response.status).toBe(202);
    expect(missing.data.data).toEqual(response.data.data);
    const fresh = await deliveredToken(email, 'verify', previous);
    expect((await post('email/verify', { token: previous })).status).toBe(400);
    expect((await post('email/verify', { token: fresh })).status).toBe(200);
  });

  test('failure while persisting the mail job rolls back user, identity, credential and token together', async () => {
    const email = 'rollback-email@example.test';
    const before = (await db.query('SELECT count(*)::int AS count FROM users')).rows[0].count;
    await db.query(
      `CREATE FUNCTION auth_test_reject_mail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected mail persistence failure'; END $$`,
    );
    await db.query(
      'CREATE TRIGGER auth_test_reject_mail BEFORE INSERT ON account_mail_jobs FOR EACH ROW EXECUTE FUNCTION auth_test_reject_mail()',
    );
    try {
      const response = await post('register', { email, password, nickname: '回滚' });
      expect(response.status).toBe(500);
      expect(response.data.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(response.data).includes('injected')).toBe(false);
      expect((await db.query('SELECT count(*)::int AS count FROM users')).rows[0].count).toBe(before);
      expect((await db.query('SELECT id FROM auth_identities WHERE provider_subject = $1', [email])).rows).toEqual([]);
    } finally {
      await db.query('DROP TRIGGER auth_test_reject_mail ON account_mail_jobs');
      await db.query('DROP FUNCTION auth_test_reject_mail()');
    }
    expect((await post('register', { email, password, nickname: '重试成功' })).status).toBe(202);
    await deliveredToken(email, 'verify');
  });

  test('session persistence failure fails login without issuing any credential cookies', async () => {
    const email = 'session-failure@example.test';
    await verifiedAccount(email);
    const count = (await db.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count;
    await db.query(
      "CREATE FUNCTION auth_test_reject_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected session failure'; END $$",
    );
    await db.query(
      'CREATE TRIGGER auth_test_reject_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION auth_test_reject_session()',
    );
    try {
      const result = await post('login', { email, password });
      expect(result.status).toBe(500);
      expect(result.headers['set-cookie']).toBeUndefined();
      expect((await db.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count).toBe(count);
    } finally {
      await db.query('DROP TRIGGER auth_test_reject_session ON sessions');
      await db.query('DROP FUNCTION auth_test_reject_session()');
    }
    expect((await post('login', { email, password })).status).toBe(200);
  });

  test('database rate buckets admit exactly the configured count under concurrent callers', async () => {
    const key = tokenHash(randomUUID());
    const results = await Promise.all(
      Array.from({ length: 8 }, () => new EmailAuthRepository(db).rateLimit(key, 900, 3)),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
  });

  test('the configured runtime mounts account routes and runs the SMTP worker through its real lifecycle', async () => {
    await accounts.close();
    await server.close();
    const config = readRuntimeConfig({
      ...process.env,
      APP_ENV: 'test',
      EMAIL_PROVIDER: 'mailpit',
      SMTP_URL: `smtp://127.0.0.1:${smtpPort}`,
      SESSION_SIGNING_KEY: signingKey,
      ROOM_STORE_DIR: path.join(process.env.PG_TEST_TMP_DIR!, 'runtime-rooms'),
    });
    server = await startRuntime(config, 0);
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Runtime did not bind');
    origin = `http://127.0.0.1:${address.port}`;
    const email = 'runtime-assembly@example.test';
    expect((await post('register', { email, password, nickname: '装配' })).status).toBe(202);
    const token = await deliveredToken(email, 'verify');
    expect((await post('email/verify', { token })).status).toBe(200);
    expect((await post('login', { email, password })).status).toBe(200);
    await server.close();
  });
});
