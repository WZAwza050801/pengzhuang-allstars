import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { beforeAll, afterAll, test, expect } from 'vitest';
import { AccountRepository, Database, migrateDatabase } from '@pengzhuang/persistence';
import { UserDataRepository } from '../packages/persistence/src/user-data';
import { PlayerData } from '../server/accounts/player-data';
import { Sessions } from '../server/accounts/sessions';
import { Passwords } from '../server/accounts/passwords';
import { AccountLifecycle } from '../server/accounts/lifecycle';
import { WechatAccounts } from '../server/accounts/wechat-accounts';
import { WechatProvider } from '../server/accounts/wechat-provider';
import { startRuntime } from '../server/runtime';
import { readRuntimeConfig } from '../config/runtime';
import { createBundledEconomyConfiguration } from '../config/economy';
import { DEFAULT_DATA } from '../shared/data';
import { UserProfileSchema, CardPageSchema, WalletListSchema } from '../packages/contracts/src/player-data';
import { startMailpit } from './helpers/mailpit';
import { jsonRequest } from './helpers/json-http';

let db: Database;
let runtime: Awaited<ReturnType<typeof startRuntime>>;
let mailpit: Awaited<ReturnType<typeof startMailpit>>;
let origin: string;
let players: PlayerData;
let sessions: Sessions;
const policy = createBundledEconomyConfiguration().policy;
const key = randomBytes(32).toString('base64url');
const issuer = 'http://localhost:2567';
const password = '初始化-密码-123456';
beforeAll(async () => {
  const config = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
  if (!config.databaseUrl || !process.env.PG_TEST_TMP_DIR) throw new Error('Isolated database required');
  db = new Database({ connectionString: config.databaseUrl });
  await migrateDatabase(db);
  await db.query('DELETE FROM auth_rate_limits');
  players = new PlayerData(db, policy, DEFAULT_DATA);
  sessions = new Sessions(db, key, issuer, players.initialize);
  mailpit = await startMailpit('player-data-mailpit');
  runtime = await startRuntime(
    readRuntimeConfig({
      ...process.env,
      APP_ENV: 'test',
      PUBLIC_ORIGIN: issuer,
      ALLOWED_ORIGINS: issuer,
      SESSION_SIGNING_KEY: key,
      EMAIL_PROVIDER: 'mailpit',
      SMTP_URL: `smtp://127.0.0.1:${mailpit.smtpPort}`,
      ROOM_STORE_DIR: path.join(process.env.PG_TEST_TMP_DIR, 'player-data-rooms'),
    }),
    0,
  );
  const address = runtime.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No runtime port');
  origin = `http://127.0.0.1:${address.port}`;
}, 30000);
afterAll(async () => {
  await runtime?.close();
  await db?.close();
  await mailpit?.close();
});
async function headers() {
  const token = (await jsonRequest(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
  return { origin: issuer, cookie: `pz_csrf=${token}`, 'x-csrf-token': token };
}
const call = (
  route: string,
  hdr: Record<string, string>,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
) => jsonRequest(origin, `/api/v1${route}`, { method, headers: hdr, body });
async function login(email: string) {
  const hdr = await headers();
  const response = await call('/auth/login', hdr, { email, password });
  expect(response.status).toBe(200);
  hdr.cookie += `; ${response.headers['set-cookie']!.map((cookie) => cookie.split(';')[0]).join('; ')}`;
  return hdr;
}
async function owner() {
  const email = `data-${randomUUID()}@example.test`;
  const hdr = await headers();
  expect((await call('/auth/register', hdr, { email, password, nickname: '存档玩家' })).status).toBe(202);
  const token = await mailpit.token(email, 'verify');
  expect((await call('/auth/email/verify', hdr, { token })).status).toBe(200);
  const auth = await login(email);
  const me = await call('/me', auth);
  return { email, headers: auth, userId: me.data.data.userId as string };
}
async function count(table: string, userId: string) {
  return Number(
    (await db.query(`SELECT count(*)::int AS count FROM ${table} WHERE user_id = $1`, [userId])).rows[0].count,
  );
}

test('real registration grants a legal five-card save with exact wallets, receipt, ledger and outbox once', async () => {
  const account = await owner();
  const receipt = (await db.query('SELECT * FROM account_initializations WHERE user_id = $1', [account.userId]))
    .rows[0];
  expect(receipt).toMatchObject({
    grant_id: 'starter-v1',
    economy_version: policy.version,
    data_version: DEFAULT_DATA.version,
  });
  const lineup = (
    await db.query(
      'SELECT c.player_def_id, c.level FROM lineup_slots s JOIN owned_cards c ON c.id = s.owned_card_id WHERE s.lineup_id = $1 ORDER BY s.slot',
      [receipt.default_lineup_id],
    )
  ).rows;
  expect(lineup.map((row) => row.player_def_id)).toEqual(DEFAULT_DATA.rules.defaultLineup);
  expect(lineup.every((row) => row.level === 1)).toBe(true);
  expect(await count('owned_cards', account.userId)).toBe(5);
  expect((await call('/me/profile', account.headers)).data.data).toEqual({
    nickname: '存档玩家',
    avatarAssetId: 'avatar_default',
    level: 1,
    exp: '0',
    version: 0,
  });
  expect((await call('/me/wallet', account.headers)).data.data.wallets).toEqual([
    { currency: 'coins', balance: '300', version: 0 },
    { currency: 'fragments', balance: '0', version: 0 },
  ]);
  expect(
    (await call('/auth/register', await headers(), { email: account.email, password, nickname: '不覆盖' })).status,
  ).toBe(202);
  expect(await count('account_initializations', account.userId)).toBe(1);
  expect(await count('asset_ledger', account.userId)).toBe(2);
  expect(
    (
      await db.query("SELECT id FROM outbox_events WHERE aggregate_id = $1 AND type = 'account.initialized'", [
        account.userId,
      ])
    ).rows,
  ).toHaveLength(1);
});

test('concurrent initialization and later economic versions cannot grant or overwrite the starter twice', async () => {
  const user = await new AccountRepository(db).createUser();
  await Promise.all(Array.from({ length: 8 }, () => db.transaction((tx) => players.initialize(tx, user.id))));
  const changed = new PlayerData(
    db,
    { ...policy, version: 'economy-test-new-price-version', starter: { ...policy.starter, coins: '999' } },
    DEFAULT_DATA,
  );
  await db.transaction((tx) => changed.initialize(tx, user.id));
  expect(await count('account_initializations', user.id)).toBe(1);
  expect(await count('profiles', user.id)).toBe(1);
  expect(await count('lineups', user.id)).toBe(1);
  expect(await count('owned_cards', user.id)).toBe(5);
  expect(await count('asset_ledger', user.id)).toBe(2);
  expect((await new UserDataRepository(db).getWallets(user.id))[0].balance).toBe('300');
});

test('a failure after the durable receipt rolls back every grant and retry completes the same account', async () => {
  const user = await new AccountRepository(db).createUser();
  await db.query(
    "CREATE FUNCTION initialization_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type = 'account.initialized' THEN RAISE EXCEPTION 'injected outbox failure'; END IF; RETURN NEW; END $$",
  );
  await db.query(
    'CREATE TRIGGER initialization_test_failure BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION initialization_test_failure()',
  );
  try {
    await expect(db.transaction((tx) => players.initialize(tx, user.id))).rejects.toThrow('injected outbox failure');
    for (const table of [
      'profiles',
      'wallets',
      'owned_cards',
      'lineups',
      'lineup_slots',
      'asset_ledger',
      'account_initializations',
    ])
      expect(await count(table, user.id)).toBe(0);
  } finally {
    await db.query('DROP TRIGGER initialization_test_failure ON outbox_events');
    await db.query('DROP FUNCTION initialization_test_failure()');
  }
  await db.transaction((tx) => players.initialize(tx, user.id));
  expect(await count('asset_ledger', user.id)).toBe(2);
});

test('two real device sessions share one save and paginated cards never cross owners', async () => {
  const account = await owner();
  const otherDevice = await login(account.email);
  const stranger = await owner();
  for (const route of ['/me/profile', '/me/wallet']) {
    const a = await call(route, account.headers);
    const b = await call(route, otherDevice);
    expect(a.data.data).toEqual(b.data.data);
    expect((route.endsWith('wallet') ? WalletListSchema : UserProfileSchema).safeParse(a.data.data).success).toBe(true);
  }
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const response = await call(`/me/cards?limit=2${cursor ? `&cursor=${cursor}` : ''}`, otherDevice);
    const page = CardPageSchema.parse(response.data.data);
    ids.push(...page.cards.map((card) => card.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(new Set(ids).size).toBe(5);
  const foreign = (await call('/me/cards', stranger.headers)).data.data.cards.map((card: { id: string }) => card.id);
  expect(ids.every((id) => !foreign.includes(id))).toBe(true);
  expect((await call(`/me/cards?userId=${stranger.userId}`, account.headers)).status).toBe(400);
  expect((await call('/me/cards?limit=51', account.headers)).status).toBe(400);
  expect((await call('/me/wallet?balance=999', account.headers)).status).toBe(400);
});

test('profile updates use server revisions; forged authority, unsafe nicknames and unknown avatars are rejected', async () => {
  const account = await owner();
  const body = { nickname: '合法昵称', avatarAssetId: 'avatar_default', expectedRevision: 0 };
  const responses = await Promise.all(
    ['昵称甲', '昵称乙'].map((nickname) => call('/me/profile', account.headers, { ...body, nickname }, 'PATCH')),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  for (const extra of [
    { level: 99 },
    { coins: '9999' },
    { role: 'admin' },
    { userId: randomUUID() },
    { expectedRevision: Number.MAX_SAFE_INTEGER },
  ])
    expect(
      (await call('/me/profile', account.headers, { ...body, expectedRevision: 1, ...extra }, 'PATCH')).status,
    ).toBe(400);
  for (const change of [
    { nickname: '\u202e坏名字' },
    { avatarAssetId: 'unowned-upload' },
    { avatarAssetId: 'https://evil.test/a.png' },
  ])
    expect(
      (await call('/me/profile', account.headers, { ...body, expectedRevision: 1, ...change }, 'PATCH')).status,
    ).toBe(400);
  const updated = await call(
    '/me/profile',
    account.headers,
    { ...body, nickname: "脚'名", expectedRevision: 1 },
    'PATCH',
  );
  expect(updated.data.data).toMatchObject({ nickname: "脚'名", level: 1, exp: '0', version: 2 });
  expect((await call('/me/wallet', account.headers)).data.data.wallets[0].balance).toBe('300');
});

test('banned/deleting/deleted users cannot recreate a save and erasure retains the starter receipt for audit', async () => {
  const account = await owner();
  const repo = new AccountRepository(db);
  await repo.transitionStatus(account.userId, 'banned');
  await expect(db.transaction((tx) => players.initialize(tx, account.userId))).rejects.toMatchObject({ status: 401 });
  await repo.transitionStatus(account.userId, 'active');
  const auth = await login(account.email);
  expect((await call('/me/reauthenticate', auth, { method: 'password', password })).status).toBe(200);
  expect((await call('/me', auth, { confirm: 'DELETE' }, 'DELETE')).status).toBe(202);
  await expect(db.transaction((tx) => players.initialize(tx, account.userId))).rejects.toMatchObject({ status: 401 });
  await db.query(
    "UPDATE account_deletion_requests SET execute_at = clock_timestamp() - interval '1 second' WHERE user_id = $1",
    [account.userId],
  );
  await new AccountLifecycle(
    db,
    new Passwords(),
    { enabled: true, graceHours: 168, version: 'test' },
    null,
    null,
  ).sweep();
  for (let i = 0; i < 100 && (await repo.getUser(account.userId))?.status !== 'deleted'; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect((await repo.getUser(account.userId))?.status).toBe('deleted');
  await expect(db.transaction((tx) => players.initialize(tx, account.userId))).rejects.toMatchObject({ status: 401 });
  expect(await count('profiles', account.userId)).toBe(0);
  expect(await count('account_initializations', account.userId)).toBe(1);
  expect(await count('asset_ledger', account.userId)).toBe(2);
});

test('unreceipted existing business data is preserved for explicit migration rather than overwritten', async () => {
  const user = await new AccountRepository(db).createUser();
  const repo = new UserDataRepository(db);
  await repo.createWallet(user.id, 'coins', 9007199254740993n);
  await expect(db.transaction((tx) => players.initialize(tx, user.id))).rejects.toMatchObject({ status: 409 });
  expect((await repo.getWallets(user.id))[0].balance).toBe('9007199254740993');
  expect(await count('account_initializations', user.id)).toBe(0);
});

test('a legacy empty account gets its save on authenticated /me without any public grant endpoint', async () => {
  const user = await new AccountRepository(db).createUser();
  const hdr = await headers();
  const credentials = await db.transaction((tx) => sessions.issue(tx, user.id, hdr['x-csrf-token']));
  hdr.cookie += `; pz_access=${credentials.accessToken}; pz_refresh=${credentials.refreshToken}`;
  expect((await call('/me', hdr)).data.data.profile.nickname).toBe('新球员');
  expect(await count('owned_cards', user.id)).toBe(5);
  expect((await call('/me/initialize', hdr, { coins: '999' })).status).toBe(404);
});

test('verified WeChat login work reuses the same initializer without regranting on subsequent codes', async () => {
  const subject = randomUUID();
  const wechat = new WechatAccounts(
    db,
    new WechatProvider({ appId: 'wx0000000000000001', secret: 'fixture-secret' }, async () =>
      Response.json({ openid: subject, session_key: 'fixture-session-key' }),
    ),
    key,
    players.initialize,
  );
  const one = await wechat.login(randomUUID(), randomUUID(), {
    service: sessions,
    csrf: 'trusted-fixture',
    deviceKind: 'desktop',
  });
  const two = await wechat.login(randomUUID(), randomUUID(), {
    service: sessions,
    csrf: 'trusted-fixture',
    deviceKind: 'mobile',
  });
  expect(two.userId).toBe(one.userId);
  expect(await count('account_initializations', one.userId)).toBe(1);
  expect(await count('owned_cards', one.userId)).toBe(5);
  expect((await new UserDataRepository(db).getWallets(one.userId))[0].balance).toBe('300');
});

test('runtime lobby summary returns owned data and rejects another account or unsolicited query', async () => {
  const account = await owner();
  const hdr = { ...account.headers, 'x-account-id': account.userId };
  const result = await call('/me/lobby', hdr);
  expect(result.status).toBe(200);
  expect(result.data.data).toMatchObject({
    userId: account.userId,
    profile: { nickname: '存档玩家', level: 1, exp: '0' },
    cardCount: 5,
    defaultLineup: { readyCards: 5, revision: 0 },
  });
  expect(result.data.data.wallets.find((row: { currency: string }) => row.currency === 'coins').balance).toBe('300');
  const other = await owner();
  expect((await call('/me/lobby', { ...hdr, 'x-account-id': other.userId })).status).toBe(409);
  expect((await call('/me/lobby?userId=other', hdr)).status).toBe(400);
  const card = (await new UserDataRepository(db).listCards(account.userId))[0];
  await db.query("UPDATE owned_cards SET status='disabled' WHERE id=$1", [card.id]);
  expect((await call('/me/lobby', hdr)).data.data.defaultLineup.readyCards).toBe(4);
});

test('runtime exposes public maintenance, compatible mode rules and an empty versioned announcement feed', async () => {
  await runtime.close();
  runtime = await startRuntime(
    readRuntimeConfig({
      ...process.env,
      APP_ENV: 'test',
      PUBLIC_ORIGIN: issuer,
      ALLOWED_ORIGINS: issuer,
      SESSION_SIGNING_KEY: key,
      EMAIL_PROVIDER: 'disabled',
      LOBBY_MAINTENANCE: 'true',
      ROOM_STORE_DIR: path.join(process.env.PG_TEST_TMP_DIR!, 'lobby-maintenance-rooms'),
    }),
    0,
  );
  const address = runtime.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  origin = `http://127.0.0.1:${address.port}`;
  const manifest = await jsonRequest(origin, '/api/v1/config/manifest');
  expect(manifest.status).toBe(200);
  expect(manifest.data.data).toMatchObject({ maintenance: true, availableModes: ['practice'] });
  expect(manifest.data.data.modes).toHaveLength(4);
  expect(JSON.stringify(manifest.data)).not.toMatch(/sessionSigningKey|databaseUrl|smtpUrl|password|secret/);
  expect((await jsonRequest(origin, '/api/v1/announcements')).data.data).toEqual({
    version: 'lobby-1',
    announcements: [],
  });
  expect((await jsonRequest(origin, '/api/v1/config/manifest?key=secret')).status).toBe(400);
});
