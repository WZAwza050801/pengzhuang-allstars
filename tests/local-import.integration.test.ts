import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { AccountRepository, Database, migrateDatabase } from '@pengzhuang/persistence';
import { UserDataRepository } from '../packages/persistence/src/user-data';
import { LifecycleRepository } from '../packages/persistence/src/lifecycle';
import { DEFAULT_DATA } from '../shared/data';
import { createBundledEconomyConfiguration } from '../config/economy';
import { readRuntimeConfig } from '../config/runtime';
import { PlayerData } from '../server/accounts/player-data';
import { LocalImports } from '../server/accounts/local-import';
import { Sessions } from '../server/accounts/sessions';
import { createGameServer } from '../server/app';
import { startRuntime } from '../server/runtime';
import { WebSessions } from '../server/api/web-sessions';
import { localImportModule } from '../server/api/local-import';
import { LocalImportReceiptSchema } from '../packages/contracts/src/local-import';
import { jsonRequest } from './helpers/json-http';

let db: Database;
let server: ReturnType<typeof createGameServer>;
let players: PlayerData;
let imports: LocalImports;
let sessions: Sessions;
let origin: string;
const issuer = 'http://localhost:2567';
const key = randomBytes(32).toString('base64url');
const team = [...DEFAULT_DATA.rules.defaultLineup];
const command = () => ({
  version: 'pz-local-v1',
  settings: { skinId: 'classic', muted: true },
  nicknameDraft: '旧昵称',
  lineups: [{ slot: 0, playerDefIds: team }],
  activeLineup: 0,
});
beforeAll(async () => {
  const config = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
  if (!config.databaseUrl || !process.env.PG_TEST_TMP_DIR) throw new Error('Isolated PostgreSQL required');
  db = new Database({ connectionString: config.databaseUrl });
  await migrateDatabase(db);
  players = new PlayerData(db, createBundledEconomyConfiguration().policy, DEFAULT_DATA);
  imports = new LocalImports(db, players.initialize, () => DEFAULT_DATA);
  sessions = new Sessions(db, key, issuer);
  const web = new WebSessions(sessions, { cookieSecure: false, allowedOrigins: [issuer] }, key);
  server = createGameServer({
    repository: db,
    clientDirectory: null,
    modules: [web.module(), localImportModule(imports, web)],
  });
  await server.gameServer.listen(0);
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await server?.close();
  await db?.close();
});
async function owner(initialize = true) {
  const csrf = (await jsonRequest(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
  const user = await new AccountRepository(db).createUser();
  if (initialize) await db.transaction((tx) => players.initialize(tx, user.id));
  const credentials = await db.transaction((tx) => sessions.issue(tx, user.id, csrf));
  return {
    userId: user.id,
    principal: await sessions.authenticate(credentials.accessToken),
    headers: {
      origin: issuer,
      cookie: `pz_csrf=${csrf}; pz_access=${credentials.accessToken}; pz_refresh=${credentials.refreshToken}`,
      'x-csrf-token': csrf,
      'x-account-id': user.id,
    },
  };
}
type Owner = Awaited<ReturnType<typeof owner>>;
const call = (account: Owner, body?: unknown, headers = account.headers) =>
  jsonRequest(origin, '/api/v1/me/local-import', { method: body === undefined ? 'GET' : 'POST', headers, body });
async function inventory(userId: string) {
  return {
    wallets: await new UserDataRepository(db).getWallets(userId),
    cards: await new UserDataRepository(db).listCards(userId),
    profile: await new UserDataRepository(db).getProfile(userId),
    counts: (
      await db.query(
        'SELECT (SELECT count(*) FROM asset_ledger WHERE user_id=$1)::int AS ledger, (SELECT count(*) FROM outbox_events WHERE aggregate_id=$1::text)::int AS outbox, (SELECT count(*) FROM lineups WHERE user_id=$1)::int AS lineups, (SELECT count(*) FROM asset_operations WHERE user_id=$1)::int AS operations',
        [userId],
      )
    ).rows[0],
  };
}
test('imports only preferences, maps owned definitions in slot order, and preserves cloud profile/lineup/assets', async () => {
  const account = await owner();
  const before = await inventory(account.userId);
  expect((await call(account)).data.data).toEqual({ receipt: null });
  const input = {
    ...command(),
    lineups: [...command().lineups, { slot: 1, playerDefIds: ['p9999', ...team.slice(1)] }],
    activeLineup: 1,
  };
  const response = await call(account, input);
  expect(response.status).toBe(200);
  const receipt = LocalImportReceiptSchema.parse(response.data.data);
  expect(receipt).toMatchObject({
    nicknameDraft: '旧昵称',
    settings: command().settings,
    activeLineup: null,
    skippedLineups: [1],
  });
  expect(receipt.lineups[0]).toEqual({
    slot: 0,
    ownedCardIds: team.map((id) => before.cards.find((card) => card.playerDefId === id)!.id),
  });
  expect(await inventory(account.userId)).toEqual(before);
  expect((await call(account)).data.data).toEqual({ receipt });
});
test('concurrent repeats and a fresh service instance return the same result without issuing starter rewards again', async () => {
  const account = await owner();
  const before = await inventory(account.userId);
  const results = await Promise.all(Array.from({ length: 6 }, () => call(account, command())));
  expect(results.every((item) => item.status === 200)).toBe(true);
  for (const item of results) expect(item.data.data).toEqual(results[0].data.data);
  expect(
    await new LocalImports(db, players.initialize, () => DEFAULT_DATA).import(account.principal, command()),
  ).toEqual(results[0].data.data);
  expect((await call(account, { ...command(), nicknameDraft: '变更' })).status).toBe(409);
  expect(await inventory(account.userId)).toEqual(before);
  expect(
    (await db.query('SELECT count(*)::int AS n FROM account_local_imports WHERE user_id=$1', [account.userId])).rows[0]
      .n,
  ).toBe(1);
});
test('asset fields and corrupt shapes are rejected rather than applied; inactive and unowned sets are skipped', async () => {
  const account = await owner();
  const before = await inventory(account.userId);
  for (const input of [
    { ...command(), balance: '999999' },
    { ...command(), level: 10 },
    { ...command(), userId: account.userId },
    { ...command(), settings: { skinId: 'evil' } },
    { ...command(), lineups: [{ slot: 0, playerDefIds: team.map((id) => ({ id, level: 10 })) }] },
  ])
    expect((await call(account, input)).status).toBe(400);
  expect(await inventory(account.userId)).toEqual(before);
  await db.query("UPDATE owned_cards SET status='disabled' WHERE id=$1", [before.cards[0].id]);
  const response = await call(account, command());
  expect(response.status).toBe(200);
  expect(response.data.data).toMatchObject({ lineups: [], activeLineup: null, skippedLineups: [0] });
});
test('account switch cannot submit a stale import; another account has an independent marker and owned card IDs', async () => {
  const first = await owner();
  const second = await owner();
  expect((await call(second, command(), { ...second.headers, 'x-account-id': first.userId })).status).toBe(409);
  expect((await call(second, undefined, { ...second.headers, 'x-account-id': first.userId })).status).toBe(409);
  expect((await call(second)).data.data.receipt).toBeNull();
  const a = await call(first, command());
  const b = await call(second, command());
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(
    b.data.data.lineups[0].ownedCardIds.some((id: string) => a.data.data.lineups[0].ownedCardIds.includes(id)),
  ).toBe(false);
  expect((await call(first)).data.data.receipt).toEqual(a.data.data);
});
test('session, CSRF and query boundaries reject unauthorized imports and later bans invalidate replay', async () => {
  const account = await owner();
  expect((await call(account, command(), { ...account.headers, 'x-csrf-token': 'bad' })).status).toBe(403);
  expect((await jsonRequest(origin, '/api/v1/me/local-import')).status).toBe(401);
  expect((await jsonRequest(origin, '/api/v1/me/local-import?userId=other', { headers: account.headers })).status).toBe(
    400,
  );
  expect((await call(account, command())).status).toBe(200);
  await db.query("UPDATE users SET status='banned',banned_at=clock_timestamp() WHERE id=$1", [account.userId]);
  expect((await call(account, command())).status).toBe(401);
});
test('failure while saving the marker rolls back even first-time initialization; same intent can retry', async () => {
  const account = await owner(false);
  await db.query(
    `CREATE FUNCTION fail_local_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected local import failure'; END $$; CREATE TRIGGER local_import_fault BEFORE INSERT ON account_local_imports FOR EACH ROW EXECUTE FUNCTION fail_local_import()`,
  );
  try {
    expect((await call(account, command())).status).toBe(500);
    expect((await call(account)).data.data.receipt).toBeNull();
    expect(await new UserDataRepository(db).getProfile(account.userId)).toBeNull();
    expect(await new UserDataRepository(db).getWallets(account.userId)).toHaveLength(0);
  } finally {
    await db.query('DROP TRIGGER local_import_fault ON account_local_imports; DROP FUNCTION fail_local_import()');
  }
  expect((await call(account, command())).status).toBe(200);
  expect((await inventory(account.userId)).wallets.find((row) => row.currency === 'coins')?.balance).toBe('300');
  expect((await call(account, command())).status).toBe(200);
  expect((await inventory(account.userId)).counts.ledger).toBe(2);
});
test('deletion erases imported nickname drafts and preferences while preserving the asset ledger', async () => {
  const account = await owner();
  await call(account, command());
  const id = (
    await db.query(
      "INSERT INTO account_deletion_requests(user_id,status,requested_at,execute_at,policy_version) VALUES ($1,'pending',now(),now()-interval '1 second','test-policy') RETURNING id",
      [account.userId],
    )
  ).rows[0].id;
  await db.transaction(async (tx) => {
    await new LifecycleRepository(tx).lockUser(account.userId);
    await tx.query("UPDATE users SET status='deleting',deletion_requested_at=clock_timestamp() WHERE id=$1", [
      account.userId,
    ]);
    expect(await new LifecycleRepository(tx).erase(account.userId, id)).toBe(true);
  });
  expect(
    (await db.query('SELECT user_id FROM account_local_imports WHERE user_id=$1', [account.userId])).rows,
  ).toHaveLength(0);
  expect((await inventory(account.userId)).counts.ledger).toBe(2);
});
test('production runtime mounts the import service', async () => {
  await server.close();
  server = await startRuntime(
    readRuntimeConfig({
      ...process.env,
      APP_ENV: 'test',
      EMAIL_PROVIDER: 'disabled',
      SESSION_SIGNING_KEY: key,
      PUBLIC_ORIGIN: issuer,
      ALLOWED_ORIGINS: issuer,
      ROOM_STORE_DIR: path.join(process.env.PG_TEST_TMP_DIR!, 'local-import-runtime'),
    }),
    0,
  );
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No runtime port');
  origin = `http://127.0.0.1:${address.port}`;
  const account = await owner();
  expect((await call(account, command())).status).toBe(200);
});
