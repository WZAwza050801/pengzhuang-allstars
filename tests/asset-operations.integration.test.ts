import { randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { AccountRepository, Database, migrateDatabase } from '@pengzhuang/persistence';
import { UserDataRepository } from '../packages/persistence/src/user-data';
import { DEFAULT_DATA } from '../shared/data';
import { createBundledEconomyConfiguration } from '../config/economy';
import { readRuntimeConfig } from '../config/runtime';
import { PlayerData } from '../server/accounts/player-data';
import { Assets, type AssetContext } from '../server/accounts/assets';
import { Sessions } from '../server/accounts/sessions';
import { createGameServer } from '../server/app';
import { startRuntime } from '../server/runtime';
import { WebSessions } from '../server/api/web-sessions';
import { assetModule } from '../server/api/assets';
import { playerDataModule } from '../server/api/player-data';
import {
  AssetOperationSchema,
  UpgradeQuoteSchema,
  CraftQuoteSchema,
  LedgerPageSchema,
} from '../packages/contracts/src/economy-operations';
import { economyCardPool } from '../packages/game-core/src/economy';
import { jsonRequest } from './helpers/json-http';

let db: Database;
let server: ReturnType<typeof createGameServer>;
let players: PlayerData;
let assets: Assets;
let sessions: Sessions;
let origin: string;
const issuer = 'http://localhost:2567';
const key = randomBytes(32).toString('base64url');
const policy = createBundledEconomyConfiguration().policy;
let context: AssetContext = { policy, data: DEFAULT_DATA };
const craftId = economyCardPool(DEFAULT_DATA).find((player) => !policy.starter.playerDefIds.includes(player.id))!.id;
beforeAll(async () => {
  const config = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
  if (!config.databaseUrl || !process.env.PG_TEST_TMP_DIR) throw new Error('Isolated PostgreSQL required');
  db = new Database({ connectionString: config.databaseUrl });
  await migrateDatabase(db);
  players = new PlayerData(db, policy, DEFAULT_DATA);
  assets = new Assets(db, players.initialize, () => context);
  sessions = new Sessions(db, key, issuer, players.initialize);
  const web = new WebSessions(sessions, { cookieSecure: false, allowedOrigins: [issuer] }, key);
  server = createGameServer({
    repository: db,
    clientDirectory: null,
    modules: [web.module(), playerDataModule(players, web), assetModule(assets, web)],
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
async function owner() {
  const csrf = (await jsonRequest(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
  const user = await new AccountRepository(db).createUser();
  await db.transaction((tx) => players.initialize(tx, user.id));
  const credentials = await db.transaction((tx) => sessions.issue(tx, user.id, csrf));
  return {
    userId: user.id,
    principal: await sessions.authenticate(credentials.accessToken),
    cards: await new UserDataRepository(db).listCards(user.id),
    headers: {
      origin: issuer,
      cookie: `pz_csrf=${csrf}; pz_access=${credentials.accessToken}; pz_refresh=${credentials.refreshToken}`,
      'x-csrf-token': csrf,
    },
  };
}
type Owner = Awaited<ReturnType<typeof owner>>;
const call = (
  route: string,
  headers: Record<string, string>,
  body?: unknown,
  operationId?: string,
  method = body === undefined ? 'GET' : 'POST',
) =>
  jsonRequest(origin, `/api/v1/me${route}`, {
    method,
    headers: { ...headers, ...(operationId ? { 'Idempotency-Key': operationId } : {}) },
    body,
  });
const command = (revision = 0) => ({ expectedRevision: revision, expectedEconomyVersion: policy.version });
const upgrade = (account: Owner, cardId = account.cards[0].id, operationId = randomUUID(), body: unknown = command()) =>
  call(`/cards/${cardId}/upgrade`, account.headers, body, operationId);
function grant(userId: string, values: Record<string, unknown>) {
  const operationId = randomUUID();
  return { userId, operationId, sourceId: operationId, reason: 'admin.correction', ...values };
}
const wallet = async (userId: string, currency = 'coins') =>
  (await new UserDataRepository(db).getWallets(userId)).find((item) => item.currency === currency)!;
const operationCount = async (userId: string) =>
  (await db.query('SELECT count(*)::int AS n FROM asset_operations WHERE user_id = $1', [userId])).rows[0].n;
async function assertConserved(userId: string) {
  const rows = (
    await db.query(
      'SELECT w.currency, w.balance::text, sum(l.delta)::text AS net FROM wallets w JOIN asset_ledger l ON l.user_id = w.user_id AND l.currency = w.currency WHERE w.user_id = $1 GROUP BY w.currency,w.balance',
      [userId],
    )
  ).rows;
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(row.net).toBe(row.balance);
}

test('upgrade quotes use the server price and successful receipts remain stable after later upgrades', async () => {
  const account = await owner();
  const id = account.cards[0].id;
  const operationId = randomUUID();
  const quote = UpgradeQuoteSchema.parse((await call(`/cards/${id}/upgrade-quote`, account.headers)).data.data);
  expect(quote).toMatchObject({
    coins: '100',
    currentLevel: 1,
    nextLevel: 2,
    expectedRevision: 0,
    economyVersion: policy.version,
  });
  const first = await upgrade(account, id, operationId);
  expect(first.status).toBe(200);
  const result = AssetOperationSchema.parse(first.data.data);
  expect(result.wallets[0].balance).toBe('200');
  expect(result.cards[0]).toMatchObject({ id, level: 2, version: 1 });
  expect(result.ledgerIds).toHaveLength(1);
  expect((await upgrade(account, id, randomUUID(), command(1))).status).toBe(200);
  const replay = await upgrade(account, id, operationId);
  expect(replay.data.data).toEqual(result);
  expect((await wallet(account.userId)).balance).toBe('50');
  expect(await operationCount(account.userId)).toBe(2);
  await assertConserved(account.userId);
});

test('concurrent retries and another service instance return one durable result', async () => {
  const account = await owner();
  const operationId = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => upgrade(account, account.cards[0].id, operationId)),
  );
  for (const result of results) {
    expect(result.status).toBe(200);
    expect(result.data.data).toEqual(results[0].data.data);
  }
  const replacement = new Assets(db, players.initialize, () => context);
  expect(await replacement.upgrade(account.principal, account.cards[0].id, operationId, command())).toEqual(
    results[0].data.data,
  );
  expect(await operationCount(account.userId)).toBe(1);
  expect((await wallet(account.userId)).balance).toBe('200');
});

test('one key cannot switch payload, target or operation kind; different users have separate key scopes', async () => {
  const account = await owner();
  const other = await owner();
  const operationId = randomUUID();
  expect((await upgrade(account, account.cards[0].id, operationId)).status).toBe(200);
  expect((await upgrade(account, account.cards[0].id, operationId, command(1))).status).toBe(409);
  expect((await upgrade(account, account.cards[1].id, operationId)).status).toBe(409);
  expect(
    (await call('/cards/craft', account.headers, { ...command(), playerDefId: craftId }, operationId)).status,
  ).toBe(409);
  expect((await upgrade(other, other.cards[0].id, operationId)).status).toBe(200);
  expect((await wallet(account.userId)).balance).toBe('200');
});

test('different upgrade intents serialize card revisions and shared-wallet spending', async () => {
  const account = await owner();
  const results = await Promise.all([upgrade(account), upgrade(account)]);
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  const competing = await owner();
  await assets.debitTrusted({
    userId: competing.userId,
    operationId: randomUUID(),
    sourceId: randomUUID(),
    reason: 'admin.correction',
    currency: 'coins',
    amount: '150',
  });
  const spending = await Promise.all([
    upgrade(competing, competing.cards[0].id),
    upgrade(competing, competing.cards[1].id),
  ]);
  expect(spending.map((result) => result.status).sort()).toEqual([200, 409]);
  expect(spending.find((result) => result.status === 409)!.data.error.code).toBe('INSUFFICIENT_FUNDS');
  expect((await wallet(competing.userId)).balance).toBe('50');
  await assertConserved(competing.userId);
});

test('ownership, card availability, CSRF and strict bodies reject forged asset authority', async () => {
  const account = await owner();
  const other = await owner();
  for (const id of [other.cards[0].id, randomUUID()]) {
    expect((await upgrade(account, id)).status).toBe(404);
    expect((await call(`/cards/${id}/upgrade-quote`, account.headers)).status).toBe(404);
  }
  for (const extra of [{ coins: '0' }, { resultingLevel: 10 }, { userId: other.userId }, { role: 'admin' }])
    expect((await upgrade(account, account.cards[0].id, randomUUID(), { ...command(), ...extra })).status).toBe(400);
  expect((await call(`/cards/${account.cards[0].id}/upgrade`, account.headers, command())).status).toBe(400);
  expect(
    (
      await call(
        `/cards/${account.cards[0].id}/upgrade`,
        { ...account.headers, 'x-csrf-token': 'forged' },
        command(),
        randomUUID(),
      )
    ).status,
  ).toBe(403);
  await db.query("UPDATE owned_cards SET status = 'disabled', version = version + 1 WHERE id = $1", [
    account.cards[0].id,
  ]);
  expect((await upgrade(account, account.cards[0].id, randomUUID(), command(1))).status).toBe(409);
  for (const route of ['/grant', '/debit'])
    expect((await call(route, account.headers, { coins: '9999', role: 'admin' }, randomUUID())).status).toBe(404);
  expect((await wallet(account.userId)).balance).toBe('300');
  expect(await operationCount(account.userId)).toBe(0);
});

test('new operations reject stale prices while a committed receipt survives an active-price change', async () => {
  const account = await owner();
  const operationId = randomUUID();
  const first = await upgrade(account, account.cards[0].id, operationId);
  try {
    context = {
      ...context,
      policy: { ...policy, version: 'economy-test-current', upgrade: { ...policy.upgrade, baseCoins: '1000' } },
    };
    expect((await upgrade(account, account.cards[0].id, operationId)).data.data).toEqual(first.data.data);
    expect((await upgrade(account, account.cards[1].id)).status).toBe(409);
    const quote = UpgradeQuoteSchema.parse(
      (await call(`/cards/${account.cards[1].id}/upgrade-quote`, account.headers)).data.data,
    );
    expect(quote).toMatchObject({ coins: '1000', economyVersion: 'economy-test-current' });
    expect(
      (
        await upgrade(account, account.cards[1].id, randomUUID(), {
          expectedRevision: 0,
          expectedEconomyVersion: quote.economyVersion,
        })
      ).data.error.code,
    ).toBe('INSUFFICIENT_FUNDS');
  } finally {
    context = { policy, data: DEFAULT_DATA };
  }
  expect((await wallet(account.userId)).balance).toBe('200');
});

test('crafting checks the fragment-wallet revision, current quote, unique ownership and retry receipt', async () => {
  const account = await owner();
  await assets.grantTrusted(grant(account.userId, { fragments: '1000' }));
  const quote = CraftQuoteSchema.parse(
    (await call(`/cards/craft-quote?playerDefId=${craftId}`, account.headers)).data.data,
  );
  const body = {
    playerDefId: craftId,
    expectedRevision: quote.expectedRevision,
    expectedEconomyVersion: quote.economyVersion,
  };
  const operationId = randomUUID();
  const result = await call('/cards/craft', account.headers, body, operationId);
  expect(result.status).toBe(200);
  expect(result.data.data.cards[0]).toMatchObject({ playerDefId: craftId, level: 1, version: 0, status: 'active' });
  expect((await wallet(account.userId, 'fragments')).balance).toBe((1000n - BigInt(quote.fragments)).toString());
  expect((await call('/cards/craft', account.headers, body, operationId)).data.data).toEqual(result.data.data);
  expect((await call('/cards/craft', account.headers, body, randomUUID())).status).toBe(409);
  expect((await call(`/cards/craft-quote?playerDefId=${craftId}`, account.headers)).status).toBe(409);
  expect(
    (await db.query('SELECT id FROM owned_cards WHERE user_id = $1 AND player_def_id = $2', [account.userId, craftId]))
      .rows,
  ).toHaveLength(1);
  await assertConserved(account.userId);
});

test('trusted multi-asset grants convert duplicates and exact bigint debits never lose precision', async () => {
  const account = await owner();
  const value = grant(account.userId, {
    coins: '9007199254740993',
    fragments: '7',
    playerDefIds: [craftId, 'p01', craftId],
  });
  const result = await assets.grantTrusted(value);
  expect(result.wallets[0].balance).toBe('9007199254741293');
  expect(result.cards).toHaveLength(2);
  expect(result.ledgerIds).toHaveLength(3);
  expect(
    (await db.query('SELECT id FROM owned_cards WHERE user_id = $1 AND player_def_id = $2', [account.userId, craftId]))
      .rows,
  ).toHaveLength(1);
  expect(await assets.grantTrusted(value)).toEqual(result);
  await expect(assets.grantTrusted({ ...value, operationId: randomUUID() })).rejects.toMatchObject({ status: 409 });
  const debit = {
    userId: account.userId,
    operationId: randomUUID(),
    sourceId: randomUUID(),
    reason: 'admin.correction',
    currency: 'coins',
    amount: '9007199254740993',
  };
  const deducted = await assets.debitTrusted(debit);
  expect(deducted.wallets[0].balance).toBe('300');
  expect(await assets.debitTrusted(debit)).toEqual(deducted);
  expect(
    (await db.query('SELECT delta::text AS delta FROM asset_ledger WHERE id = $1', [deducted.ledgerIds[0]])).rows[0]
      .delta,
  ).toBe('-9007199254740993');
  await assertConserved(account.userId);
});

test('int64 overflow, invalid credits and insufficient debits fail without recording effects', async () => {
  const account = await owner();
  await assets.grantTrusted(grant(account.userId, { coins: (9223372036854775807n - 300n).toString() }));
  await expect(assets.grantTrusted(grant(account.userId, { coins: '1' }))).rejects.toMatchObject({ status: 400 });
  await expect(assets.grantTrusted(grant(account.userId, { coins: '-1' }))).rejects.toMatchObject({ status: 400 });
  await expect(assets.grantTrusted(grant(account.userId, { coins: Number('9007199254740993') }))).rejects.toMatchObject(
    {
      status: 400,
    },
  );
  expect((await wallet(account.userId)).balance).toBe('9223372036854775807');
  expect(await operationCount(account.userId)).toBe(1);
  await assets.debitTrusted({
    userId: account.userId,
    operationId: randomUUID(),
    sourceId: randomUUID(),
    reason: 'admin.correction',
    currency: 'coins',
    amount: '9223372036854775807',
  });
  await expect(
    assets.debitTrusted({
      userId: account.userId,
      operationId: randomUUID(),
      sourceId: randomUUID(),
      reason: 'admin.correction',
      currency: 'coins',
      amount: '1',
    }),
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  expect((await wallet(account.userId)).balance).toBe('0');
  await assertConserved(account.userId);
});

test.each(['wallets', 'owned_cards', 'asset_ledger', 'asset_operations', 'outbox_events'])(
  'failure at %s rolls back wallet/card/ledger/receipt/outbox; the same request can retry',
  async (table) => {
    const account = await owner();
    const operationId = randomUUID();
    const guard = table === 'outbox_events' ? "IF NEW.type <> 'asset.changed' THEN RETURN NEW; END IF;" : '';
    await db.query(
      `CREATE FUNCTION asset_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${guard} RAISE EXCEPTION 'injected asset boundary failure'; END $$`,
    );
    await db.query(
      `CREATE TRIGGER asset_test_failure BEFORE ${['wallets', 'owned_cards'].includes(table) ? 'UPDATE' : 'INSERT'} ON ${table} FOR EACH ROW EXECUTE FUNCTION asset_test_failure()`,
    );
    try {
      expect((await upgrade(account, account.cards[0].id, operationId)).status).toBe(500);
      expect((await wallet(account.userId)).balance).toBe('300');
      expect(await operationCount(account.userId)).toBe(0);
      expect(
        (await new UserDataRepository(db).listCards(account.userId)).find((card) => card.id === account.cards[0].id),
      ).toMatchObject({ level: 1, version: 0 });
      expect(
        (
          await db.query("SELECT id FROM outbox_events WHERE aggregate_id = $1 AND type = 'asset.changed'", [
            account.userId,
          ])
        ).rows,
      ).toHaveLength(0);
      await assertConserved(account.userId);
    } finally {
      await db.query(`DROP TRIGGER asset_test_failure ON ${table}`);
      await db.query('DROP FUNCTION asset_test_failure()');
    }
    expect((await upgrade(account, account.cards[0].id, operationId)).status).toBe(200);
  },
);

test.each(['40P01', '40001'])(
  '%s retries the complete real transaction up to a successful third attempt',
  async (code) => {
    const account = await owner();
    await db.query('CREATE SEQUENCE asset_retry_probe');
    await db.query(
      `CREATE FUNCTION asset_retry_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF nextval('asset_retry_probe') <= 2 THEN RAISE EXCEPTION 'injected retry' USING ERRCODE = '${code}'; END IF; RETURN NEW; END $$`,
    );
    await db.query(
      'CREATE TRIGGER asset_retry_failure BEFORE INSERT ON asset_operations FOR EACH ROW EXECUTE FUNCTION asset_retry_failure()',
    );
    try {
      expect((await upgrade(account)).status).toBe(200);
      expect((await db.query('SELECT last_value::int AS n FROM asset_retry_probe')).rows[0].n).toBe(3);
      expect((await wallet(account.userId)).balance).toBe('200');
      expect(await operationCount(account.userId)).toBe(1);
      await assertConserved(account.userId);
    } finally {
      await db.query('DROP TRIGGER asset_retry_failure ON asset_operations');
      await db.query('DROP FUNCTION asset_retry_failure()');
      await db.query('DROP SEQUENCE asset_retry_probe');
    }
  },
);

test.each([
  ['40001', 3, 503],
  ['P0001', 1, 500],
] as const)('persistent %s stops after %s attempts with status %s and no effects', async (code, attempts, status) => {
  const account = await owner();
  await db.query('CREATE SEQUENCE asset_retry_probe');
  await db.query(
    `CREATE FUNCTION asset_retry_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('asset_retry_probe'); RAISE EXCEPTION 'injected persistent error' USING ERRCODE = '${code}'; END $$`,
  );
  await db.query(
    'CREATE TRIGGER asset_retry_failure BEFORE INSERT ON asset_operations FOR EACH ROW EXECUTE FUNCTION asset_retry_failure()',
  );
  try {
    const response = await upgrade(account);
    expect(response.status).toBe(status);
    expect(response.data.error.retryable).toBe(status === 503);
    expect((await db.query('SELECT last_value::int AS n FROM asset_retry_probe')).rows[0].n).toBe(attempts);
    expect((await wallet(account.userId)).balance).toBe('300');
    expect(await operationCount(account.userId)).toBe(0);
    await assertConserved(account.userId);
  } finally {
    await db.query('DROP TRIGGER asset_retry_failure ON asset_operations');
    await db.query('DROP FUNCTION asset_retry_failure()');
    await db.query('DROP SEQUENCE asset_retry_probe');
  }
});

test('a competing trusted debit commits first and a waiting upgrade reads the reduced wallet', async () => {
  const account = await owner();
  const response = await db.connection(async (connection) => {
    await connection.query('BEGIN');
    await assets.debitInTransaction(connection, {
      userId: account.userId,
      operationId: randomUUID(),
      sourceId: randomUUID(),
      reason: 'admin.correction',
      currency: 'coins',
      amount: '250',
    });
    const pending = upgrade(account);
    let blocked = false;
    try {
      for (let i = 0; i < 100; i++) {
        blocked =
          (
            await db.query(
              "SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM users%FOR UPDATE%'",
            )
          ).rowCount! > 0;
        if (blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
    } finally {
      await connection.query('COMMIT');
    }
    return pending;
  });
  expect(response.data.error.code).toBe('INSUFFICIENT_FUNDS');
  expect((await wallet(account.userId)).balance).toBe('50');
  expect(await operationCount(account.userId)).toBe(1);
  await assertConserved(account.userId);
});

test('a real response lost after commit is safely confirmed by retrying the same key and payload', async () => {
  const account = await owner();
  const operationId = randomUUID();
  const body = JSON.stringify(command());
  await new Promise<void>((resolve, reject) => {
    const request = httpRequest(
      new URL(`/api/v1/me/cards/${account.cards[0].id}/upgrade`, origin),
      {
        method: 'POST',
        headers: {
          ...account.headers,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'Idempotency-Key': operationId,
        },
      },
      (response) => {
        expect(response.statusCode).toBe(200);
        response.destroy();
        resolve();
      },
    );
    request.once('error', reject);
    request.end(body);
  });
  expect(await operationCount(account.userId)).toBe(1);
  expect((await upgrade(account, account.cards[0].id, operationId)).data.data.cards[0].level).toBe(2);
  expect((await wallet(account.userId)).balance).toBe('200');
  expect(await operationCount(account.userId)).toBe(1);
});

test('trusted ports compose in an outer transaction and account revocation blocks cached user operations', async () => {
  const account = await owner();
  await expect(
    db.transaction(async (tx) => {
      await assets.grantInTransaction(tx, grant(account.userId, { coins: '10' }));
      await assets.debitInTransaction(tx, {
        userId: account.userId,
        operationId: randomUUID(),
        sourceId: randomUUID(),
        reason: 'admin.correction',
        currency: 'coins',
        amount: '5',
      });
      throw new Error('outer caller rollback');
    }),
  ).rejects.toThrow('outer caller rollback');
  expect(await operationCount(account.userId)).toBe(0);
  expect((await wallet(account.userId)).balance).toBe('300');
  const operationId = randomUUID();
  expect((await upgrade(account, account.cards[0].id, operationId)).status).toBe(200);
  await new AccountRepository(db).transitionStatus(account.userId, 'banned');
  expect((await upgrade(account, account.cards[0].id, operationId)).status).toBe(401);
  await expect(assets.grantTrusted(grant(account.userId, { coins: '1' }))).rejects.toMatchObject({ status: 401 });
});

test('ledger history is append-only, private and paginates microsecond timestamps without losing rows', async () => {
  const account = await owner();
  const other = await owner();
  await db.query('CREATE SEQUENCE asset_history_clock START 101');
  await db.query(
    "CREATE FUNCTION asset_history_time() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.created_at = '2026-01-01 00:00:00+00'::timestamptz + nextval('asset_history_clock') * interval '1 microsecond'; RETURN NEW; END $$",
  );
  await db.query(
    'CREATE TRIGGER asset_history_time BEFORE INSERT ON asset_ledger FOR EACH ROW EXECUTE FUNCTION asset_history_time()',
  );
  try {
    for (let i = 0; i < 5; i++) await assets.grantTrusted(grant(account.userId, { coins: '1' }));
  } finally {
    await db.query('DROP TRIGGER asset_history_time ON asset_ledger');
    await db.query('DROP FUNCTION asset_history_time()');
    await db.query('DROP SEQUENCE asset_history_clock');
  }
  const ids: string[] = [];
  let cursor: string | null = null;
  let precise = false;
  do {
    const page = LedgerPageSchema.parse(
      (await call(`/ledger?limit=2${cursor ? `&cursor=${cursor}` : ''}`, account.headers)).data.data,
    );
    ids.push(...page.entries.map((entry) => entry.id));
    cursor = page.nextCursor;
    if (cursor && /00010[1-5]Z/.test(Buffer.from(cursor, 'base64url').toString('utf8'))) precise = true;
  } while (cursor);
  expect(ids).toHaveLength(7);
  expect(new Set(ids).size).toBe(7);
  expect(precise).toBe(true);
  expect((await call('/ledger', other.headers)).data.data.entries).toHaveLength(2);
  expect((await call(`/ledger?userId=${other.userId}`, account.headers)).status).toBe(400);
  const invalid = Buffer.from(JSON.stringify({ createdAt: '0000-01-01T00:00:00Z', id: randomUUID() })).toString(
    'base64url',
  );
  expect((await call(`/ledger?cursor=${invalid}`, account.headers)).status).toBe(400);
  await expect(db.query('DELETE FROM asset_operations WHERE user_id = $1', [account.userId])).rejects.toMatchObject({
    code: 'P0001',
  });
  await expect(
    db.query('UPDATE asset_ledger SET delta = 0 WHERE user_id = $1', [account.userId]),
  ).rejects.toMatchObject({ code: 'P0001' });
});

test('a trusted command and pinned policy cannot change while waiting for the user lock', async () => {
  const account = await owner();
  const pinned: AssetContext = { policy: structuredClone(policy), data: DEFAULT_DATA };
  const value = { ...grant(account.userId, {}), coins: '1', playerDefIds: ['p01'] };
  const result = await db.connection(async (connection) => {
    await connection.query('BEGIN');
    await connection.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [account.userId]);
    const pending = assets.grantTrusted(value, pinned);
    value.coins = '999';
    value.playerDefIds.length = 0;
    for (const rarity of Object.keys(pinned.policy.duplicateFragments) as (keyof typeof policy.duplicateFragments)[])
      pinned.policy.duplicateFragments[rarity] = '999';
    await connection.query('COMMIT');
    return pending;
  });
  expect(result.wallets[0].balance).toBe('301');
  expect(result.cards.map((card) => card.playerDefId)).toEqual(['p01']);
  expect(BigInt(result.wallets[1].balance)).toBeGreaterThan(0n);
  expect(BigInt(result.wallets[1].balance)).toBeLessThanOrEqual(100n);
  await assertConserved(account.userId);
});

test('a stale account header rejects an upgrade before binding its key or writing assets', async () => {
  const first = await owner(),
    second = await owner();
  const operationId = randomUUID();
  const result = await call(
    `/cards/${second.cards[0].id}/upgrade`,
    { ...second.headers, 'X-Account-Id': first.userId },
    command(),
    operationId,
  );
  expect(result.status).toBe(409);
  expect(result.data.error.code).toBe('ACCOUNT_CHANGED');
  expect(await operationCount(second.userId)).toBe(0);
  expect((await wallet(second.userId)).balance).toBe('300');
  expect((await upgrade(second, second.cards[0].id, operationId)).status).toBe(200);
  expect((await wallet(second.userId)).balance).toBe('200');
});
test('the production runtime mounts the same quote, upgrade and ledger endpoints', async () => {
  const account = await owner();
  await server.close();
  server = await startRuntime(
    readRuntimeConfig({
      ...process.env,
      APP_ENV: 'test',
      SESSION_SIGNING_KEY: key,
      PUBLIC_ORIGIN: issuer,
      ALLOWED_ORIGINS: issuer,
      ROOM_STORE_DIR: path.join(process.env.PG_TEST_TMP_DIR!, 'asset-runtime-rooms'),
    }),
    0,
  );
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No runtime port');
  origin = `http://127.0.0.1:${address.port}`;
  expect((await call(`/cards/${account.cards[0].id}/upgrade-quote`, account.headers)).status).toBe(200);
  expect((await upgrade(account)).status).toBe(200);
  expect((await call('/ledger', account.headers)).data.data.entries).toHaveLength(3);
});
