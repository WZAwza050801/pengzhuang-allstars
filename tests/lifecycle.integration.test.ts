import { randomBytes, randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { Database, AccountRepository, migrateDatabase } from '@pengzhuang/persistence';
import { UserDataRepository, MatchDataRepository } from '../packages/persistence/src/user-data';
import { readRuntimeConfig } from '../config/runtime';
import { createGameServer } from '../server/app';
import { startRuntime } from '../server/runtime';
import { EmailAccounts } from '../server/accounts/email-accounts';
import { createAccountMail } from '../server/accounts/mail';
import { Passwords } from '../server/accounts/passwords';
import { Sessions } from '../server/accounts/sessions';
import { AccountLifecycle } from '../server/accounts/lifecycle';
import { WechatProvider } from '../server/accounts/wechat-provider';
import { WechatAccounts } from '../server/accounts/wechat-accounts';
import { WebSessions } from '../server/api/web-sessions';
import { emailAuthModule } from '../server/api/email-auth';
import { currentUserModule } from '../server/api/current-user';
import { lifecycleModules } from '../server/api/lifecycle';
import { startMailpit } from './helpers/mailpit';
import { jsonRequest } from './helpers/json-http';

describe('account lifecycle with real PostgreSQL, HTTP and SMTP', () => {
  let db: Database;
  let mailpit: Awaited<ReturnType<typeof startMailpit>>;
  let server: ReturnType<typeof createGameServer>;
  let origin: string;
  let mail: EmailAccounts;
  let sessions: Sessions;
  let lifecycle: AccountLifecycle;
  let wechat: WechatAccounts;
  const passwords = new Passwords();
  const key = randomBytes(32).toString('base64url');
  const issuer = 'http://localhost:2567';
  const password = 'lifecycle-密码-123456';
  const codes = new Map<string, string>();
  const cfg = () =>
    readRuntimeConfig({
      ...process.env,
      APP_ENV: 'test',
      EMAIL_PROVIDER: 'mailpit',
      SMTP_URL: `smtp://127.0.0.1:${mailpit.smtpPort}`,
      PUBLIC_ORIGIN: issuer,
      ALLOWED_ORIGINS: issuer,
      SESSION_SIGNING_KEY: key,
    });
  beforeAll(async () => {
    const config = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
    if (!config.databaseUrl || !process.env.PG_TEST_TMP_DIR) throw new Error('Isolated PostgreSQL required');
    db = new Database({ connectionString: config.databaseUrl });
    await migrateDatabase(db);
    await db.query('DELETE FROM auth_rate_limits');
    mailpit = await startMailpit('lifecycle-mailpit');
    mail = new EmailAccounts(db, createAccountMail(cfg()), key, passwords);
    sessions = new Sessions(db, key, issuer);
    wechat = new WechatAccounts(
      db,
      new WechatProvider({ appId: 'wx0000000000000001', secret: 'mock-only-secret' }, async (input) => {
        const code = new URL(String(input)).searchParams.get('js_code')!;
        const openId = codes.get(code);
        return Response.json(openId ? { openid: openId, session_key: 'private-provider-key' } : { errcode: 40029 });
      }),
      key,
    );
    lifecycle = new AccountLifecycle(
      db,
      passwords,
      { enabled: true, graceHours: 168, version: 'test-policy-v1' },
      mail,
      wechat,
    );
    const web = new WebSessions(sessions, cfg(), key);
    server = createGameServer({
      repository: db,
      clientDirectory: null,
      modules: [web.module(), currentUserModule(web), ...lifecycleModules(lifecycle, web), emailAuthModule(mail, web)],
    });
    await server.gameServer.listen(0);
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    origin = `http://127.0.0.1:${address.port}`;
    mail.startMailDelivery();
  }, 30000);
  afterAll(async () => {
    await lifecycle?.close();
    await mail?.close();
    await server?.close();
    await db?.close();
    await mailpit?.close();
  });
  async function headers() {
    const csrf = (await jsonRequest(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
    return { origin: issuer, cookie: `pz_csrf=${csrf}`, 'x-csrf-token': csrf };
  }
  const call = (
    route: string,
    hdr: Record<string, string>,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ) => jsonRequest(origin, `/api/v1${route}`, { method, headers: hdr, body });
  const auth = (route: string, hdr: Record<string, string>, body: unknown) => call(`/auth/${route}`, hdr, body);
  function proofCode(openId: string) {
    const code = randomUUID();
    codes.set(code, openId);
    return code;
  }
  async function attach(userId: string, hdr = headers()) {
    const requestHeaders = await hdr;
    const credentials = await db.transaction((tx) => sessions.issue(tx, userId, requestHeaders['x-csrf-token']));
    requestHeaders.cookie += `; pz_access=${credentials.accessToken}; pz_refresh=${credentials.refreshToken}`;
    return {
      userId,
      headers: requestHeaders,
      credentials,
      principal: await sessions.authenticate(credentials.accessToken),
    };
  }
  async function account(registered = true) {
    const hdr = await headers();
    const email = `lc-${randomUUID()}@example.test`;
    if (registered) {
      expect((await auth('register', hdr, { email, password, nickname: '隐私昵称' })).status).toBe(202);
      const token = await mailpit.token(email, 'verify');
      expect((await auth('email/verify', hdr, { token })).status).toBe(200);
      const login = await auth('login', hdr, { email, password });
      expect(login.status).toBe(200);
      hdr.cookie += `; ${login.headers['set-cookie']!.map((cookie) => cookie.split(';')[0]).join('; ')}`;
      const access = login.headers['set-cookie']!.find((cookie) => cookie.startsWith('pz_access='))!
        .split(';')[0]
        .slice(10);
      return {
        userId: login.data.data.userId as string,
        email,
        headers: hdr,
        principal: await sessions.authenticate(access),
        openId: '',
      };
    }
    const repo = new AccountRepository(db);
    const user = await repo.createUser();
    const openId = `seeded-${randomUUID()}`;
    await repo.linkIdentity({
      userId: user.id,
      provider: 'wechat',
      providerAppId: 'wx0000000000000001',
      providerSubject: openId,
    });
    // Trusted fixture credential; reauthentication still executes the real Argon2 verifier.
    await repo.setPasswordCredential({ userId: user.id, passwordHash: await passwords.hash(password) });
    return { ...(await attach(user.id, Promise.resolve(hdr))), email, openId };
  }
  const reauth = (owner: { headers: Record<string, string> }) =>
    call('/me/reauthenticate', owner.headers, { method: 'password', password });
  const recovery = (owner: { email: string }) => ({ method: 'password', email: owner.email, password });

  test('stolen but non-step-up sessions, wrong credentials and expired grants cannot bind or delete', async () => {
    const owner = await account(false);
    expect(
      (await call('/me/identities/link', owner.headers, { provider: 'email', email: owner.email, password })).status,
    ).toBe(403);
    expect((await call('/me', owner.headers, { confirm: 'DELETE' }, 'DELETE')).status).toBe(403);
    expect((await call('/me/reauthenticate', owner.headers, { method: 'password', password: 'wrong' })).status).toBe(
      401,
    );
    expect((await reauth(owner)).status).toBe(200);
    const otherSession = await attach(owner.userId);
    expect((await call('/me', otherSession.headers, { confirm: 'DELETE' }, 'DELETE')).status).toBe(403);
    await db.query("UPDATE sessions SET reauthenticated_at = clock_timestamp() - interval '6 minutes' WHERE id = $1", [
      owner.principal.sessionId,
    ]);
    expect((await call('/me', owner.headers, { confirm: 'DELETE' }, 'DELETE')).status).toBe(403);
  });

  test('real mailbox proof is tied to the initiating account/session and binds an email/password atomically', async () => {
    const owner = await account(false);
    expect((await reauth(owner)).status).toBe(200);
    expect(
      (await call('/me/identities/link', owner.headers, { provider: 'email', email: owner.email, password })).status,
    ).toBe(202);
    const token = await mailpit.token(owner.email, 'link');
    const other = await attach(owner.userId);
    expect((await reauth(other)).status).toBe(200);
    expect((await call('/me/identities/confirm', other.headers, { token })).status).toBe(400);
    expect((await auth('email/verify', owner.headers, { token })).status).toBe(400);
    expect((await call('/me/identities/confirm', owner.headers, { token })).status).toBe(200);
    expect((await call('/me/identities/confirm', owner.headers, { token })).status).toBe(400);
    const login = await auth('login', owner.headers, { email: owner.email, password });
    expect(login.status).toBe(200);
    expect(login.data.data.userId).toBe(owner.userId);
    expect(
      (await db.query('SELECT * FROM identity_link_requests WHERE user_id = $1', [owner.userId])).rows,
    ).toHaveLength(0);
    const events = (await db.query('SELECT * FROM account_audit_events WHERE user_id = $1', [owner.userId])).rows;
    for (const value of [owner.email, password, token]) expect(JSON.stringify(events)).not.toContain(value);
  });

  test('existing-account and concurrent mailbox conflicts never merge owners or copy assets', async () => {
    const existing = await account();
    const first = await account(false);
    expect((await reauth(first)).status).toBe(200);
    await call('/me/identities/link', first.headers, { provider: 'email', email: existing.email, password });
    const token = await mailpit.token(existing.email, 'link');
    expect((await call('/me/identities/confirm', first.headers, { token })).status).toBe(409);
    expect((await auth('login', existing.headers, { email: existing.email, password })).data.data.userId).toBe(
      existing.userId,
    );
    const second = await account(false);
    expect((await reauth(second)).status).toBe(200);
    const target = `race-${randomUUID()}@example.test`;
    await call('/me/identities/link', first.headers, { provider: 'email', email: target, password });
    const one = await mailpit.token(target, 'link');
    await call('/me/identities/link', second.headers, { provider: 'email', email: target, password });
    const two = await mailpit.token(target, 'link', one);
    const results = await Promise.all([
      call('/me/identities/confirm', first.headers, { token: one }),
      call('/me/identities/confirm', second.headers, { token: two }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(
      (await db.query('SELECT id FROM users WHERE id = ANY($1::uuid[])', [[first.userId, second.userId]])).rows,
    ).toHaveLength(2);
  });

  test('expired binding token cannot change identity or password', async () => {
    const owner = await account(false);
    await reauth(owner);
    await call('/me/identities/link', owner.headers, { provider: 'email', email: owner.email, password });
    const token = await mailpit.token(owner.email, 'link');
    await db.query(
      "UPDATE verification_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE token_hash = $1",
      [createHash('sha256').update(token).digest('hex')],
    );
    expect((await call('/me/identities/confirm', owner.headers, { token })).status).toBe(400);
    await lifecycle.sweep();
    expect(
      (await db.query('SELECT * FROM identity_link_requests WHERE user_id = $1', [owner.userId])).rows,
    ).toHaveLength(0);
  });

  test('WeChat step-up/link uses verified owner and the same durable code-consumption boundary as login', async () => {
    const owner = await account();
    await reauth(owner);
    const openId = `linked-${randomUUID()}`;
    expect(
      (await call('/me/identities/link', owner.headers, { provider: 'wechat', code: proofCode(openId) })).status,
    ).toBe(200);
    const code = proofCode(openId);
    expect((await call('/me/reauthenticate', owner.headers, { method: 'wechat', code })).status).toBe(200);
    await expect(
      wechat.login(code, randomUUID(), { service: sessions, csrf: 'trusted-test-binding', deviceKind: 'desktop' }),
    ).rejects.toMatchObject({ status: 409 });
    const foreign = await account();
    await reauth(foreign);
    expect(
      (await call('/me/identities/link', foreign.headers, { provider: 'wechat', code: proofCode(openId) })).status,
    ).toBe(409);
    expect(
      (await call('/me/reauthenticate', foreign.headers, { method: 'wechat', code: proofCode(openId) })).status,
    ).toBe(401);
  });

  test('deletion freezes the owner and all sessions; fresh credentials can query and cancel without restoring sessions', async () => {
    const owner = await account();
    const other = await attach(owner.userId);
    await reauth(owner);
    const disabled = new AccountLifecycle(db, passwords, { ...lifecycle.policy, enabled: false }, mail, wechat);
    await expect(disabled.requestDeletion(owner.principal)).rejects.toMatchObject({ status: 503 });
    const deleted = await call('/me', owner.headers, { confirm: 'DELETE' }, 'DELETE');
    expect(deleted.status).toBe(202);
    expect(deleted.headers['set-cookie']).toHaveLength(2);
    expect(deleted.data.data.policyVersion).toBe('test-policy-v1');
    for (const identity of [owner, other]) expect((await call('/me', identity.headers)).status).toBe(401);
    expect((await auth('login', owner.headers, { email: owner.email, password })).status).toBe(401);
    expect((await auth('deletion/status', owner.headers, recovery(owner))).data.data.status).toBe('pending');
    expect((await auth('deletion/cancel', owner.headers, { ...recovery(owner), password: 'wrong' })).status).toBe(401);
    expect((await auth('deletion/cancel', owner.headers, recovery(owner))).status).toBe(200);
    expect((await auth('deletion/cancel', owner.headers, recovery(owner))).status).toBe(200);
    expect((await call('/me', owner.headers)).status).toBe(401);
    expect((await auth('login', owner.headers, { email: owner.email, password })).status).toBe(200);
    expect(
      (
        await db.query("SELECT id FROM account_audit_events WHERE user_id = $1 AND action = 'deletion_cancelled'", [
          owner.userId,
        ])
      ).rows,
    ).toHaveLength(1);
  });

  test('due deletion removes direct identifiers while preserving exact wallets, ledgers and match participant references', async () => {
    const owner = await account();
    const data = new UserDataRepository(db);
    await data.createProfile({ userId: owner.userId, nickname: '必须移除的昵称', avatarAssetId: 'private-avatar' });
    await data.createWallet(owner.userId, 'coins', 9007199254740993n);
    const ledger = await data.appendLedger({
      userId: owner.userId,
      currency: 'coins',
      delta: 9007199254740993n,
      balanceAfter: 9007199254740993n,
      reason: 'test.seed',
      sourceId: 'fixture',
      idempotencyKey: randomUUID(),
      payloadHash: 'a'.repeat(64),
    });
    const match = await new MatchDataRepository(db).createMatch({
      mode: 'friend',
      configVersion: 'test-v1',
      protocolVersion: 1,
    });
    await new MatchDataRepository(db).addParticipant({
      matchId: match.id,
      userId: owner.userId,
      side: 0,
      lineupSnapshot: Array.from({ length: 5 }, () => ({ playerDefId: 'p01' })),
    });
    await data.createLineup(owner.userId, '含个人信息的阵容名');
    await reauth(owner);
    expect((await call('/me', owner.headers, { confirm: 'DELETE' }, 'DELETE')).status).toBe(202);
    await lifecycle.sweep();
    expect((await new AccountRepository(db).getUser(owner.userId))?.status).toBe('deleting');
    await db.query(
      "UPDATE account_deletion_requests SET execute_at = clock_timestamp() - interval '1 second' WHERE user_id = $1",
      [owner.userId],
    );
    await new AccountLifecycle(db, passwords, { ...lifecycle.policy, enabled: false }, mail, wechat).sweep();
    expect((await new AccountRepository(db).getUser(owner.userId))?.status).toBe('deleting');
    await lifecycle.sweep();
    await lifecycle.sweep();
    expect((await new AccountRepository(db).getUser(owner.userId))?.status).toBe('deleted');
    expect(await data.getProfile(owner.userId)).toBeNull();
    for (const table of ['auth_identities', 'password_credentials', 'verification_tokens', 'identity_link_requests'])
      expect((await db.query(`SELECT user_id FROM ${table} WHERE user_id = $1`, [owner.userId])).rows).toHaveLength(0);
    expect((await data.getWallets(owner.userId))[0].balance).toBe('9007199254740993');
    expect(
      (await db.query('SELECT delta::text, balance_after::text FROM asset_ledger WHERE id = $1', [ledger.id])).rows[0],
    ).toEqual({ delta: ledger.delta, balance_after: ledger.balanceAfter });
    expect(
      (await db.query('SELECT user_id FROM match_participants WHERE match_id = $1', [match.id])).rows[0].user_id,
    ).toBe(owner.userId);
    expect((await db.query('SELECT name FROM lineups WHERE user_id = $1', [owner.userId])).rows[0].name).toBe(
      '已注销阵容',
    );
    expect((await auth('deletion/cancel', owner.headers, recovery(owner))).status).toBe(401);
    expect(
      (
        await db.query("SELECT id FROM account_audit_events WHERE user_id = $1 AND action = 'deletion_completed'", [
          owner.userId,
        ])
      ).rows,
    ).toHaveLength(1);
  });

  test('an audit write failure rolls back erasure; a restarted worker retries the same durable request', async () => {
    const owner = await account();
    const independent = await account();
    await reauth(owner);
    await reauth(independent);
    for (const target of [owner, independent])
      expect((await call('/me', target.headers, { confirm: 'DELETE' }, 'DELETE')).status).toBe(202);
    await db.query(
      "UPDATE account_deletion_requests SET execute_at = clock_timestamp() - interval '1 second' WHERE user_id = ANY($1::uuid[])",
      [[owner.userId, independent.userId]],
    );
    await db.query(
      `CREATE FUNCTION lifecycle_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'deletion_completed' AND NEW.user_id = '${owner.userId}'::uuid THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$`,
    );
    await db.query(
      'CREATE TRIGGER lifecycle_test_failure BEFORE INSERT ON account_audit_events FOR EACH ROW EXECUTE FUNCTION lifecycle_test_failure()',
    );
    try {
      await expect(lifecycle.sweep()).rejects.toMatchObject({
        errors: [expect.objectContaining({ message: 'injected audit failure' })],
      });
      expect((await new AccountRepository(db).getUser(owner.userId))?.status).toBe('deleting');
      expect((await new AccountRepository(db).getUser(independent.userId))?.status).toBe('deleted');
      expect((await db.query('SELECT id FROM auth_identities WHERE user_id = $1', [owner.userId])).rows).toHaveLength(
        1,
      );
      expect((await auth('deletion/cancel', owner.headers, recovery(owner))).status).toBe(409);
    } finally {
      await db.query('DROP TRIGGER lifecycle_test_failure ON account_audit_events');
      await db.query('DROP FUNCTION lifecycle_test_failure()');
    }
    await new AccountLifecycle(db, passwords, lifecycle.policy, mail, wechat).sweep();
    expect((await new AccountRepository(db).getUser(owner.userId))?.status).toBe('deleted');
  });

  test('ban/unban/expiry always revoke live sessions and cannot be invoked through a player route', async () => {
    const owner = await account();
    const device = await attach(owner.userId);
    await lifecycle.ban(owner.userId, 'security');
    for (const identity of [owner, device]) expect((await call('/me', identity.headers)).status).toBe(401);
    await expect(
      sessions.refresh(device.credentials.refreshToken, device.headers['x-csrf-token']),
    ).rejects.toMatchObject({ status: 401 });
    expect((await auth('login', owner.headers, { email: owner.email, password })).status).toBe(401);
    await lifecycle.unban(owner.userId);
    expect((await call('/me', owner.headers)).status).toBe(401);
    expect((await auth('login', owner.headers, { email: owner.email, password })).status).toBe(200);
    await lifecycle.ban(owner.userId, 'abuse', new Date(Date.now() + 60000));
    await db.query("UPDATE account_bans SET expires_at = clock_timestamp() - interval '1 second' WHERE user_id = $1", [
      owner.userId,
    ]);
    await lifecycle.sweep();
    expect((await new AccountRepository(db).getUser(owner.userId))?.status).toBe('active');
    const outsider = await account();
    expect((await call('/me/ban', outsider.headers, { userId: owner.userId, role: 'admin' })).status).toBe(404);
  });

  test('a ban during pending deletion blocks cancellation but does not prevent the scheduled privacy erasure', async () => {
    const owner = await account();
    await reauth(owner);
    await call('/me', owner.headers, { confirm: 'DELETE' }, 'DELETE');
    await lifecycle.ban(owner.userId, 'policy');
    expect((await auth('deletion/cancel', owner.headers, recovery(owner))).status).toBe(403);
    await db.query(
      "UPDATE account_deletion_requests SET execute_at = clock_timestamp() - interval '1 second' WHERE user_id = $1",
      [owner.userId],
    );
    await lifecycle.sweep();
    expect((await new AccountRepository(db).getUser(owner.userId))?.status).toBe('deleted');
    expect((await call('/me', owner.headers)).status).toBe(401);
  });

  test('audit events are append-only and HTTP schemas cannot mutate another identity or account status', async () => {
    const owner = await account();
    await reauth(owner);
    await expect(
      db.query("UPDATE account_audit_events SET action = 'unbanned' WHERE user_id = $1", [owner.userId]),
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(db.query('DELETE FROM account_audit_events WHERE user_id = $1', [owner.userId])).rejects.toMatchObject(
      { code: 'P0001' },
    );
    expect(
      (await call('/me/reauthenticate', owner.headers, { method: 'password', password, userId: randomUUID() })).status,
    ).toBe(400);
    expect((await call('/me', owner.headers, { confirm: 'DELETE', status: 'active' }, 'DELETE')).status).toBe(400);
    expect((await call('/me/identities/link', owner.headers, { provider: 'wechat', openid: 'forged' })).status).toBe(
      400,
    );
  });

  test('lower-level status transitions cannot resurrect a banned session after unban', async () => {
    const owner = await account();
    const repo = new AccountRepository(db);
    await repo.transitionStatus(owner.userId, 'banned');
    await repo.transitionStatus(owner.userId, 'active');
    expect((await call('/me', owner.headers)).status).toBe(401);
  });

  test('the real runtime starts the due-deletion worker and stops it on shutdown', async () => {
    await mail.close();
    await lifecycle.close();
    await server.close();
    const config = readRuntimeConfig({
      ...process.env,
      APP_ENV: 'test',
      EMAIL_PROVIDER: 'mailpit',
      SMTP_URL: `smtp://127.0.0.1:${mailpit.smtpPort}`,
      SESSION_SIGNING_KEY: key,
      PUBLIC_ORIGIN: issuer,
      ALLOWED_ORIGINS: issuer,
      ACCOUNT_DELETION_ENABLED: 'true',
      ACCOUNT_DELETION_GRACE_HOURS: '0',
      ACCOUNT_RETENTION_POLICY: 'runtime-test-v1',
      ROOM_STORE_DIR: path.join(process.env.PG_TEST_TMP_DIR!, 'lifecycle-runtime-rooms'),
    });
    server = await startRuntime(config, 0);
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No runtime port');
    origin = `http://127.0.0.1:${address.port}`;
    const owner = await account();
    await reauth(owner);
    expect((await call('/me', owner.headers, { confirm: 'DELETE' }, 'DELETE')).status).toBe(202);
    for (
      let index = 0;
      index < 100 && (await new AccountRepository(db).getUser(owner.userId))?.status !== 'deleted';
      index++
    )
      await new Promise((resolve) => setTimeout(resolve, 25));
    expect((await new AccountRepository(db).getUser(owner.userId))?.status).toBe('deleted');
    await server.close();
  });
});
