import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { AccountRepository, Database, migrateDatabase } from '@pengzhuang/persistence';
import { UserDataRepository, MatchDataRepository } from '../packages/persistence/src/user-data';
import { readRuntimeConfig } from '../config/runtime';
import { createBundledEconomyConfiguration } from '../config/economy';
import { DEFAULT_DATA } from '../shared/data';
import { createMatch } from '../shared/match';
import { createGameServer } from '../server/app';
import { startRuntime } from '../server/runtime';
import { PlayerData } from '../server/accounts/player-data';
import { Lineups } from '../server/accounts/lineups';
import { Sessions } from '../server/accounts/sessions';
import { WebSessions } from '../server/api/web-sessions';
import { lineupModule } from '../server/api/lineups';
import { currentUserModule } from '../server/api/current-user';
import { playerDataModule } from '../server/api/player-data';
import { SavedLineupSchema, LineupPageSchema } from '../packages/contracts/src/lineups';
import { jsonRequest } from './helpers/json-http';

let db: Database;
let server: ReturnType<typeof createGameServer>;
let players: PlayerData;
let lineups: Lineups;
let sessions: Sessions;
let origin: string;
const issuer = 'http://localhost:2567';
const key = randomBytes(32).toString('base64url');
beforeAll(async () => {
  const config = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
  if (!config.databaseUrl || !process.env.PG_TEST_TMP_DIR) throw new Error('Isolated PostgreSQL required');
  db = new Database({ connectionString: config.databaseUrl });
  await migrateDatabase(db);
  players = new PlayerData(db, createBundledEconomyConfiguration().policy, DEFAULT_DATA);
  lineups = new Lineups(db, players.initialize, () => DEFAULT_DATA);
  sessions = new Sessions(db, key, issuer, players.initialize);
  const web = new WebSessions(sessions, { cookieSecure: false, allowedOrigins: [issuer] }, key);
  server = createGameServer({
    repository: db,
    clientDirectory: null,
    modules: [web.module(), currentUserModule(web), playerDataModule(players, web), lineupModule(lineups, web)],
  });
  await listen();
});
async function listen() {
  await server.gameServer.listen(0);
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  origin = `http://127.0.0.1:${address.port}`;
}
afterAll(async () => {
  await server?.close();
  await db?.close();
});
const request = (
  route: string,
  headers: Record<string, string>,
  body?: unknown,
  method = body === undefined ? 'GET' : 'PUT',
) => jsonRequest(origin, `/api/v1/me${route}`, { method, headers, body });
async function owner() {
  const csrf = (await jsonRequest(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
  const user = await new AccountRepository(db).createUser();
  await db.transaction((tx) => players.initialize(tx, user.id));
  const credentials = await db.transaction((tx) => sessions.issue(tx, user.id, csrf));
  const headers = {
    origin: issuer,
    'x-csrf-token': csrf,
    cookie: `pz_csrf=${csrf}; pz_access=${credentials.accessToken}; pz_refresh=${credentials.refreshToken}`,
  };
  const list = await request('/lineups', headers);
  expect(list.status).toBe(200);
  return {
    userId: user.id,
    principal: await sessions.authenticate(credentials.accessToken),
    headers,
    lineup: LineupPageSchema.parse(list.data.data).lineups[0],
  };
}
const swap = (ids: readonly string[], a: number, b: number) => {
  const result = [...ids];
  [result[a], result[b]] = [result[b], result[a]];
  return result;
};
async function save(account: Awaited<ReturnType<typeof owner>>, ownedCardIds: string[], expectedRevision = 0) {
  return request(`/lineups/${account.lineup.id}`, account.headers, { ownedCardIds, expectedRevision });
}

test('the real HTTP save preserves legal slot order and uses only owned-card IDs plus revision', async () => {
  const account = await owner();
  const ids = swap(account.lineup.ownedCardIds, 3, 4);
  expect((await save(account, ids)).data.data).toEqual({ ...account.lineup, ownedCardIds: ids, revision: 1 });
  const read = await request(`/lineups/${account.lineup.id}`, account.headers);
  expect(SavedLineupSchema.parse(read.data.data).ownedCardIds).toEqual(ids);
  expect((await request('/lineups', account.headers)).data.data.lineups[0]).toEqual(read.data.data);
  expect((await save(account, ids)).status).toBe(409);
  for (const extra of [
    { levels: [10, 10, 10, 10, 10] },
    { playerDefIds: DEFAULT_DATA.rules.defaultLineup },
    { userId: randomUUID() },
    { mode: 'ranked' },
  ])
    expect(
      (
        await request(`/lineups/${account.lineup.id}`, account.headers, {
          ownedCardIds: ids,
          expectedRevision: 1,
          ...extra,
        })
      ).status,
    ).toBe(400);
});

test('foreign or absent lineups are indistinguishable; foreign, absent, duplicate and malformed slots cannot be saved', async () => {
  const account = await owner();
  const foreign = await owner();
  for (const id of [foreign.lineup.id, randomUUID()]) {
    expect((await request(`/lineups/${id}`, account.headers)).status).toBe(404);
    expect(
      (
        await request(`/lineups/${id}`, account.headers, {
          ownedCardIds: account.lineup.ownedCardIds,
          expectedRevision: 0,
        })
      ).status,
    ).toBe(404);
  }
  for (const ids of [
    [foreign.lineup.ownedCardIds[0], ...account.lineup.ownedCardIds.slice(1)],
    [randomUUID(), ...account.lineup.ownedCardIds.slice(1)],
    Array(5).fill(account.lineup.ownedCardIds[0]),
    account.lineup.ownedCardIds.slice(1),
    DEFAULT_DATA.rules.defaultLineup,
  ])
    expect((await save(account, ids)).status).toBe(400);
  expect((await request(`/lineups?userId=${foreign.userId}`, account.headers)).status).toBe(400);
  expect((await request('/lineups?limit=51', account.headers)).status).toBe(400);
  expect((await request(`/lineups/${account.lineup.id}`, account.headers)).data.data).toEqual(account.lineup);
  expect((await save(account, swap(account.lineup.ownedCardIds, 0, 3))).status).toBe(200);
});

test('concurrent saves from one prior revision have one winner and never interleave slots', async () => {
  const account = await owner();
  const candidates = [swap(account.lineup.ownedCardIds, 3, 4), swap(account.lineup.ownedCardIds, 1, 2)];
  const results = await Promise.all(candidates.map((ids) => save(account, ids)));
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  const winner = results.find((result) => result.status === 200)!;
  expect((await request(`/lineups/${account.lineup.id}`, account.headers)).data.data).toEqual(winner.data.data);
  expect(winner.data.data.revision).toBe(1);
});

test('a slot insertion failure rolls back both revision and slot replacement; the original request can retry', async () => {
  const account = await owner();
  const ids = swap(account.lineup.ownedCardIds, 3, 4);
  await db.query(
    "CREATE FUNCTION lineup_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected slot failure'; END $$",
  );
  await db.query(
    'CREATE TRIGGER lineup_test_failure BEFORE INSERT ON lineup_slots FOR EACH ROW EXECUTE FUNCTION lineup_test_failure()',
  );
  try {
    expect((await save(account, ids)).status).toBe(500);
    expect((await request(`/lineups/${account.lineup.id}`, account.headers)).data.data).toEqual(account.lineup);
  } finally {
    await db.query('DROP TRIGGER lineup_test_failure ON lineup_slots');
    await db.query('DROP FUNCTION lineup_test_failure()');
  }
  expect((await save(account, ids)).status).toBe(200);
});

test('server-owned levels become immutable growth snapshots while ranked/friend stay Lv5 in the real match state', async () => {
  const account = await owner();
  for (const [slot, id] of account.lineup.ownedCardIds.entries())
    await db.query('UPDATE owned_cards SET level = $2, version = version + 1 WHERE id = $1', [
      id,
      [1, 4, 7, 9, 10][slot],
    ]);
  const growth = await lineups.snapshot(account.principal, account.lineup.id, 0, 'growth');
  const ranked = await lineups.snapshot(account.principal, account.lineup.id, 0, 'ranked');
  const friend = await lineups.snapshot(account.principal, account.lineup.id, 0, 'friend');
  expect(growth.cards.map((card) => card.level)).toEqual([1, 4, 7, 9, 10]);
  for (const frozen of [ranked, friend]) expect(frozen.cards.map((card) => card.level)).toEqual([5, 5, 5, 5, 5]);
  const match = createMatch(
    DEFAULT_DATA,
    [growth.cards.map((card) => card.playerDefId), ranked.cards.map((card) => card.playerDefId)],
    { seed: 42, levels: [growth.cards.map((card) => card.level), ranked.cards.map((card) => card.level)] },
  );
  expect(match.pieces.map((piece) => piece.level)).toEqual([1, 4, 7, 9, 10, 5, 5, 5, 5, 5]);
  expect(growth.rules.gameDataVersion).toBe(DEFAULT_DATA.version);
  expect(Object.isFrozen(growth.cards[0].stats)).toBe(true);
  expect(() => {
    growth.cards[0].level = 10;
  }).toThrow();
  await db.query('UPDATE owned_cards SET level = 8, version = version + 1 WHERE id = $1', [
    account.lineup.ownedCardIds[0],
  ]);
  expect(growth.cards[0].level).toBe(1);
  expect((await lineups.snapshot(account.principal, account.lineup.id, 0, 'growth')).cards[0]).toMatchObject({
    ownedLevel: 8,
    cardVersion: 2,
    level: 8,
  });
});

test('card disablement is read immediately by saves and snapshot builds without rewriting stored slots', async () => {
  const account = await owner();
  await db.query("UPDATE owned_cards SET status = 'disabled', version = version + 1 WHERE id = $1", [
    account.lineup.ownedCardIds[2],
  ]);
  expect((await save(account, account.lineup.ownedCardIds)).status).toBe(400);
  await expect(lineups.snapshot(account.principal, account.lineup.id, 0, 'ranked')).rejects.toMatchObject({
    status: 409,
  });
  expect(
    (await request('/cards', account.headers)).data.data.cards.find(
      (card: { id: string }) => card.id === account.lineup.ownedCardIds[2],
    ).status,
  ).toBe('disabled');
  expect((await request(`/lineups/${account.lineup.id}`, account.headers)).data.data).toEqual(account.lineup);
  await db.query("UPDATE owned_cards SET status = 'active', version = version + 1 WHERE id = $1", [
    account.lineup.ownedCardIds[2],
  ]);
  expect((await lineups.snapshot(account.principal, account.lineup.id, 0, 'ranked')).cards[2].cardVersion).toBe(2);
});

test('unsupported source skills may remain in a friendly owned lineup but official snapshots reject them', async () => {
  const account = await owner();
  const def = Object.values(DEFAULT_DATA.players).find(
    (player) => player.position === 'FW' && player.skill === 'unimplemented',
  )!;
  const card = await new UserDataRepository(db).createCard({ userId: account.userId, playerDefId: def.id });
  const ids = [...account.lineup.ownedCardIds];
  ids[4] = card.id;
  expect((await save(account, ids)).status).toBe(200);
  expect((await lineups.snapshot(account.principal, account.lineup.id, 1, 'friend')).cards[4].stats.skill).toBeNull();
  for (const mode of ['growth', 'ranked'] as const)
    await expect(lineups.snapshot(account.principal, account.lineup.id, 1, mode)).rejects.toMatchObject({
      status: 409,
    });
});

test('a snapshot waiting on a card update uses the committed level/version rather than an earlier joined read', async () => {
  const account = await owner();
  const snapshot = await db.connection(async (connection) => {
    await connection.query('BEGIN');
    await connection.query('UPDATE owned_cards SET level = 9, version = version + 1 WHERE id = $1', [
      account.lineup.ownedCardIds[0],
    ]);
    const pending = lineups.snapshot(account.principal, account.lineup.id, 0, 'growth');
    let blocked = false;
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        blocked =
          (
            await db.query(
              "SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM owned_cards%FOR UPDATE%'",
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
  expect(snapshot.cards[0]).toMatchObject({ level: 9, ownedLevel: 9, cardVersion: 1 });
});

test('snapshot construction composes with match persistence in one transaction and follows account/session revocation', async () => {
  const account = await owner();
  let matchId = '';
  await expect(
    db.transaction(async (tx) => {
      const snapshot = await lineups.snapshotInTransaction(tx, account.principal, account.lineup.id, 0, 'ranked');
      const matches = new MatchDataRepository(tx);
      const match = await matches.createMatch({
        mode: 'ranked',
        configVersion: snapshot.rules.gameDataVersion,
        protocolVersion: 1,
      });
      matchId = match.id;
      await matches.addParticipant({ matchId, userId: account.userId, side: 0, lineupSnapshot: snapshot.cards });
      throw new Error('injected ticket caller rollback');
    }),
  ).rejects.toThrow('injected ticket caller rollback');
  expect((await db.query('SELECT id FROM matches WHERE id = $1', [matchId])).rows).toHaveLength(0);
  await expect(lineups.snapshot(account.principal, account.lineup.id, 1, 'ranked')).rejects.toMatchObject({
    status: 409,
  });
  const foreign = await owner();
  await expect(
    lineups.snapshot({ ...account.principal, userId: foreign.userId }, account.lineup.id, 0, 'ranked'),
  ).rejects.toMatchObject({ status: 401 });
  await new AccountRepository(db).transitionStatus(account.userId, 'banned');
  expect((await request('/lineups', account.headers)).status).toBe(401);
  await expect(lineups.snapshot(account.principal, account.lineup.id, 0, 'ranked')).rejects.toMatchObject({
    status: 401,
  });
});

test('lineup pages are bounded and cursor-based with no foreign IDs', async () => {
  const account = await owner();
  const repo = new UserDataRepository(db);
  for (let index = 0; index < 4; index++) {
    const row = await repo.createLineup(account.userId, `预设${index + 1}`);
    for (const [slot, ownedCardId] of account.lineup.ownedCardIds.entries())
      await repo.addLineupSlot({ userId: account.userId, lineupId: row.id, slot, ownedCardId });
  }
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page = LineupPageSchema.parse(
      (await request(`/lineups?limit=2${cursor ? `&cursor=${cursor}` : ''}`, account.headers)).data.data,
    );
    ids.push(...page.lineups.map((lineup) => lineup.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(ids).toHaveLength(5);
  expect(new Set(ids).size).toBe(5);
});

test('the production runtime mounts the same real lineup endpoints', async () => {
  const account = await owner();
  await server.close();
  server = await startRuntime(
    readRuntimeConfig({
      ...process.env,
      APP_ENV: 'test',
      SESSION_SIGNING_KEY: key,
      PUBLIC_ORIGIN: issuer,
      ALLOWED_ORIGINS: issuer,
      ROOM_STORE_DIR: path.join(process.env.PG_TEST_TMP_DIR!, 'lineup-runtime-rooms'),
    }),
    0,
  );
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No runtime port');
  origin = `http://127.0.0.1:${address.port}`;
  expect((await request('/lineups', account.headers)).status).toBe(200);
  expect((await save(account, swap(account.lineup.ownedCardIds, 3, 4))).status).toBe(200);
});
