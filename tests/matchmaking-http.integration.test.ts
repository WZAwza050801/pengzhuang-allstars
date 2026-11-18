import './node-transport.setup';
import { beforeAll, afterAll, beforeEach, afterEach, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Client, type Room } from 'colyseus.js';
import { AccountRepository, Database, migrateDatabase } from '@pengzhuang/persistence';
import { createDataFixture } from './helpers/data-factory';
import { Sessions } from '../server/accounts/sessions';
import { Lineups } from '../server/accounts/lineups';
import { MatchTickets } from '../server/matches/tickets';
import { MatchmakingQueue } from '../server/matches/matchmaking';
import { MatchOutcomes } from '../server/matches/outcomes';
import { OutcomeJournal } from '../server/matches/outcome-journal';
import { WebSessions } from '../server/api/web-sessions';
import { createGameServer } from '../server/app';
import { DEFAULT_DATA } from '../shared/data';
import { S2C, type MatchStartMsg } from '../shared/protocol';
import { QueueStatusSchema, QueueOptionsSchema } from '../packages/contracts/src/matchmaking';
import { jsonRequest } from './helpers/json-http';

let db: Database, fixture: Awaited<ReturnType<typeof createDataFixture>>, sessions: Sessions, lineups: Lineups;
let queue: MatchmakingQueue, server: ReturnType<typeof createGameServer>, origin: string;
const issuer = 'http://localhost:2567',
  key = randomBytes(32).toString('base64url'),
  opened: Room[] = [];
beforeAll(async () => {
  db = new Database({ connectionString: process.env.TEST_DATABASE_URL! });
  fixture = await createDataFixture(db);
  await migrateDatabase(db);
  sessions = new Sessions(db, key, issuer, fixture.players.initialize);
  lineups = new Lineups(db, fixture.players.initialize, () => DEFAULT_DATA);
});
async function boot(maintenance = false) {
  const web = new WebSessions(sessions, { cookieSecure: false, allowedOrigins: [issuer] }, key);
  queue = new MatchmakingQueue({ db, lineups, resolveData: () => DEFAULT_DATA });
  const outcomes = new MatchOutcomes({
    db,
    assets: fixture.assets,
    policy: () => fixture.policy,
    journal: new OutcomeJournal(path.join(process.env.PG_TEST_TMP_DIR!, `mm01-http-${randomUUID()}`)),
    onEvent: () => undefined,
  });
  server = createGameServer({
    repository: db,
    clientDirectory: null,
    lobbyMaintenance: maintenance,
    modules: [web.module()],
    matchmakingQueue: queue,
    accountRooms: { tickets: new MatchTickets(db, lineups, () => DEFAULT_DATA), web, outcomes },
    closeResources: [() => outcomes.close()],
  });
  await server.gameServer.listen(0);
  await server.startMatchmaking();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP port');
  origin = `http://127.0.0.1:${address.port}`;
}
beforeEach(() => boot());
afterEach(async () => {
  await Promise.all(
    opened
      .splice(0)
      .filter((room) => room.connection?.isOpen)
      .map((room) => room.leave()),
  );
  await server?.close();
});
afterAll(async () => {
  await fixture?.close();
  await db?.close();
});
async function owner() {
  const csrf = (await jsonRequest(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
  const user = await new AccountRepository(db).createUser(),
    issued = await db.transaction((tx) => sessions.issue(tx, user.id, csrf));
  const principal = await sessions.authenticate(issued.accessToken),
    lineup = (await lineups.list(principal, {})).lineups[0];
  return {
    principal,
    body: {
      intentId: randomUUID(),
      mode: 'friend',
      protocol: 2,
      lineupId: lineup.id,
      expectedRevision: lineup.revision,
      configVersion: DEFAULT_DATA.version,
      region: 'local',
    },
    headers: {
      origin: issuer,
      'x-account-id': user.id,
      'x-csrf-token': csrf,
      cookie: `pz_csrf=${csrf}; pz_access=${issued.accessToken}; pz_refresh=${issued.refreshToken}`,
    },
  };
}
type Owner = Awaited<ReturnType<typeof owner>>;
const request = (user: Owner, suffix: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') =>
  jsonRequest(origin, `/api/v1/matchmaking${suffix}`, { method, headers: user.headers, body });
async function until<T>(read: () => Promise<T | undefined | false | null>) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('HTTP queue state timeout');
}

test('public options and owner-only queue routes enforce identity, Origin, CSRF and strict commands', async () => {
  const options = await jsonRequest(origin, '/api/v1/matchmaking/options');
  expect(options.status).toBe(200);
  expect(QueueOptionsSchema.safeParse(options.data.data).success).toBe(true);
  const [a, b] = await Promise.all([owner(), owner()]);
  expect((await jsonRequest(origin, '/api/v1/matchmaking/entries/current')).status).toBe(401);
  const missing = { ...a.headers };
  delete (missing as Partial<typeof missing>)['x-account-id'];
  expect((await jsonRequest(origin, '/api/v1/matchmaking/entries/current', { headers: missing })).status).toBe(409);
  expect(
    (
      await jsonRequest(origin, '/api/v1/matchmaking/entries', {
        method: 'POST',
        headers: { ...a.headers, 'x-csrf-token': 'wrong' },
        body: a.body,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await jsonRequest(origin, '/api/v1/matchmaking/entries/current', {
        headers: { ...a.headers, origin: 'https://untrusted.example' },
      })
    ).status,
  ).toBe(403);
  expect((await request(a, '/entries', { ...a.body, userId: b.principal.userId })).status).toBe(400);
  expect((await request(a, '/entries', { ...a.body, rating: 9999 })).status).toBe(400);
  expect((await request(a, '/entries', { ...a.body, protocol: 1 })).status).toBe(426);
  expect((await request(a, '/entries', { ...a.body, configVersion: 'obsolete' })).status).toBe(409);
  expect((await request(a, '/entries/current?userId=other')).status).toBe(400);
});

test('HTTP duplicate intent and cancel retry preserve the accepted entry, with outsider reads indistinguishable', async () => {
  const [a, b] = await Promise.all([owner(), owner()]);
  const values = await Promise.all(Array.from({ length: 4 }, () => request(a, '/entries', a.body)));
  expect(values.map((value) => value.status)).toEqual([200, 200, 200, 200]);
  const entry = values[0].data.data.entry;
  expect(new Set(values.map((value) => value.data.data.entry.id)).size).toBe(1);
  expect(QueueStatusSchema.safeParse(values[0].data.data).success).toBe(true);
  expect((await request(b, `/entries/${entry.id}`)).status).toBe(404);
  expect((await request(b, `/entries/${entry.id}`, {}, 'DELETE')).status).toBe(404);
  expect((await request(a, `/entries/${entry.id}`, {}, 'DELETE')).data.data.entry.state).toBe('cancelled');
  expect((await request(a, '/entries', a.body)).data.data.entry).toMatchObject({ id: entry.id, state: 'cancelled' });
  expect((await request(a, '/entries', { ...a.body, intentId: randomUUID() })).data.data.entry.id).not.toBe(entry.id);
});

test('automatic HTTP pairing issues fresh original-seat tickets and both real SDK clients start exactly one match', async () => {
  const [a, b, outsider] = await Promise.all([owner(), owner(), owner()]);
  const ae = (await request(a, '/entries', a.body)).data.data.entry,
    be = (await request(b, '/entries', b.body)).data.data.entry;
  const matched = await until(async () => {
    const value = (await request(a, `/entries/${ae.id}`)).data.data.entry;
    return value?.assignment?.state === 'ready' ? value : null;
  });
  expect((await request(b, `/entries/${be.id}`)).data.data.entry.assignment.id).toBe(matched.assignment.id);
  expect((await request(outsider, `/entries/${ae.id}/ticket`, { protocol: 2 })).status).toBe(404);
  const at = await request(a, `/entries/${ae.id}/ticket`, { protocol: 2 }),
    bt = await request(b, `/entries/${be.id}/ticket`, { protocol: 2 });
  expect(at.status).toBe(200);
  expect(bt.status).toBe(200);
  const sdk = new Client(origin.replace('http:', 'ws:'));
  const first = await sdk.joinById(at.data.data.roomCode, { protocol: 2, ticket: at.data.data.ticket });
  opened.push(first);
  let start: MatchStartMsg | undefined;
  first.onMessage('*', (type, value) => {
    if (type === S2C.matchStart) start = value as MatchStartMsg;
  });
  const second = await sdk.joinById(bt.data.data.roomCode, { protocol: 2, ticket: bt.data.data.ticket });
  opened.push(second);
  second.onMessage('*', () => undefined);
  first.send('ready', { ready: true });
  second.send('ready', { ready: true });
  await until(async () => start);
  expect(
    (await db.query('SELECT match_id FROM matchmaking_assignments WHERE id=$1', [matched.assignment.id])).rows[0]
      .match_id,
  ).toBe(start!.matchId);
  expect(
    (await db.query('SELECT count(*)::text AS n FROM match_participants WHERE user_id=$1', [a.principal.userId]))
      .rows[0].n,
  ).toBe('1');
});

test('maintenance blocks new admissions and pairing while allowing own queue lookup and cancellation', async () => {
  await server.close();
  await boot(true);
  const [a, b] = await Promise.all([owner(), owner()]);
  const queued = await queue.enqueue(a.principal, a.body);
  await queue.enqueue(b.principal, b.body);
  await server.matchmaking!.pump();
  expect((await request(a, '/entries/current')).data.data.entry.state).toBe('queued');
  expect((await request(a, '/entries', { ...a.body, intentId: randomUUID() })).status).toBe(503);
  expect((await request(a, `/entries/${queued.entry!.id}`, {}, 'DELETE')).data.data.entry.state).toBe('cancelled');
});

test('an actual queue insert failure returns retryable 503 without an entry and the same intent retries safely', async () => {
  const a = await owner();
  await db.query(`CREATE FUNCTION queue_http_fail_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'queue_http_fail_fixture';END $$;
    CREATE TRIGGER queue_http_fail_fixture BEFORE INSERT ON matchmaking_entries FOR EACH ROW EXECUTE FUNCTION queue_http_fail_fixture()`);
  try {
    const failed = await request(a, '/entries', a.body);
    expect(failed.status).toBe(503);
    expect(failed.data.error).toMatchObject({ code: 'UNAVAILABLE', retryable: true });
    expect((await db.query('SELECT * FROM matchmaking_entries WHERE user_id=$1', [a.principal.userId])).rowCount).toBe(
      0,
    );
  } finally {
    await db.query(
      'DROP TRIGGER queue_http_fail_fixture ON matchmaking_entries;DROP FUNCTION queue_http_fail_fixture()',
    );
  }
  expect((await request(a, '/entries', a.body)).data.data.entry.state).toBe('queued');
});
