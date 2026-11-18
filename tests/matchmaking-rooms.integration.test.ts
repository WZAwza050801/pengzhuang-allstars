import './node-transport.setup';
import { beforeAll, afterAll, beforeEach, afterEach, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { matchMaker } from 'colyseus';
import { Client, type Room } from 'colyseus.js';
import { AccountRepository, Database, migrateDatabase } from '@pengzhuang/persistence';
import { createDataFixture } from './helpers/data-factory';
import { Sessions } from '../server/accounts/sessions';
import { Lineups } from '../server/accounts/lineups';
import { MatchTickets } from '../server/matches/tickets';
import { MatchmakingQueue } from '../server/matches/matchmaking';
import { MatchmakingCoordinator } from '../server/matches/matchmaking-coordinator';
import { MatchOutcomes } from '../server/matches/outcomes';
import { OutcomeJournal } from '../server/matches/outcome-journal';
import { WebSessions } from '../server/api/web-sessions';
import { createGameServer } from '../server/app';
import { DEFAULT_DATA } from '../shared/data';
import { ACCOUNT_ROOM_NAME, S2C, type MatchStartMsg } from '../shared/protocol';
import { jsonRequest } from './helpers/json-http';

let db: Database, fixture: Awaited<ReturnType<typeof createDataFixture>>, sessions: Sessions, lineups: Lineups;
let server: ReturnType<typeof createGameServer>,
  queue: MatchmakingQueue,
  origin: string,
  sdk: Client,
  outcomes: MatchOutcomes;
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
beforeEach(async () => {
  const web = new WebSessions(sessions, { cookieSecure: false, allowedOrigins: [issuer] }, key);
  queue = new MatchmakingQueue({ db, lineups, resolveData: () => DEFAULT_DATA });
  outcomes = new MatchOutcomes({
    db,
    assets: fixture.assets,
    policy: () => fixture.policy,
    journal: new OutcomeJournal(path.join(process.env.PG_TEST_TMP_DIR!, `mm01-${randomUUID()}`)),
    onEvent: () => undefined,
  });
  server = createGameServer({
    repository: db,
    clientDirectory: null,
    modules: [web.module()],
    matchmakingQueue: queue,
    accountRooms: { tickets: new MatchTickets(db, lineups, () => DEFAULT_DATA), web, outcomes },
    closeResources: [() => outcomes.close()],
  });
  await server.gameServer.listen(0);
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No server port');
  origin = `http://127.0.0.1:${address.port}`;
  sdk = new Client(origin.replace('http:', 'ws:'));
});
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
async function until<T>(read: () => T | undefined | false | null | Promise<T | undefined | false | null>) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Queue room did not reach its expected state');
}
async function owner() {
  const csrf = (await jsonRequest(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
  const user = await new AccountRepository(db).createUser();
  const issued = await db.transaction((tx) => sessions.issue(tx, user.id, csrf)),
    principal = await sessions.authenticate(issued.accessToken);
  const lineup = (await lineups.list(principal, {})).lineups[0];
  return {
    principal,
    lineup,
    headers: {
      origin: issuer,
      'x-csrf-token': csrf,
      'x-account-id': user.id,
      cookie: `pz_csrf=${csrf}; pz_access=${issued.accessToken}; pz_refresh=${issued.refreshToken}`,
    },
  };
}
type Owner = Awaited<ReturnType<typeof owner>>;
async function enqueue(user: Owner) {
  return queue.enqueue(user.principal, {
    intentId: randomUUID(),
    mode: 'friend',
    protocol: 2,
    lineupId: user.lineup.id,
    expectedRevision: user.lineup.revision,
    configVersion: DEFAULT_DATA.version,
    region: 'local',
  });
}
async function ticket(user: Owner, roomCode?: string) {
  return jsonRequest(origin, '/api/v1/matches/tickets', {
    method: 'POST',
    headers: user.headers,
    body: {
      protocol: 2,
      mode: 'friend',
      lineupId: user.lineup.id,
      expectedRevision: user.lineup.revision,
      ...(roomCode ? { roomCode } : {}),
    },
  });
}
async function connect(value: { roomCode: string; ticket: string }) {
  const room = await sdk.joinById(value.roomCode, { protocol: 2, ticket: value.ticket });
  opened.push(room);
  const messages: { type: string; data: unknown }[] = [];
  room.onMessage('*', (type, data) => messages.push({ type: String(type), data }));
  room.onError(() => undefined);
  return {
    room,
    latest: <T>(type: string) => messages.filter((value) => value.type === type).at(-1)?.data as T | undefined,
  };
}
async function assigned(a: Owner, b: Owner) {
  await enqueue(a);
  await enqueue(b);
  await server.matchmaking!.pump();
  const value = (await queue.current(a.principal)).entry!;
  expect(value).toMatchObject({ state: 'matched', assignment: { state: 'ready' } });
  return value.assignment!;
}

test('a real matched room restricts tickets to both original accounts and binds the actual match before start publication', async () => {
  const [a, b, outsider] = await Promise.all([owner(), owner(), owner()]);
  const assignment = await assigned(a, b);
  expect((await ticket(outsider, assignment.roomCode)).status).toBe(404);
  const at = await ticket(a, assignment.roomCode),
    bt = await ticket(b, assignment.roomCode);
  expect(at.status).toBe(200);
  expect(bt.status).toBe(200);
  const first = await connect(at.data.data),
    second = await connect(bt.data.data);
  first.room.send('ready', { ready: true });
  second.room.send('ready', { ready: true });
  const start = await until(() => first.latest<MatchStartMsg>(S2C.matchStart));
  await until(() => second.latest<MatchStartMsg>(S2C.matchStart));
  const stored = (await db.query('SELECT match_id FROM matchmaking_assignments WHERE id=$1', [assignment.id])).rows[0];
  expect(stored.match_id).toBe(start.matchId);
  expect(
    (await db.query('SELECT count(*)::text AS n FROM match_participants WHERE match_id=$1', [start.matchId])).rows[0].n,
  ).toBe('2');
  expect((await db.query('SELECT * FROM match_recovery_heads WHERE match_id=$1', [start.matchId])).rowCount).toBe(1);
  expect((await queue.cancel(a.principal, (await queue.current(a.principal)).entry!.id)).entry!.state).toBe('matched');
});

test('a stale or replayed room ticket never admits, while a new ticket retains the original frozen selection', async () => {
  const [a, b] = await Promise.all([owner(), owner()]),
    assignment = await assigned(a, b);
  const stale = await ticket(a, assignment.roomCode);
  expect(stale.status).toBe(200);
  await db.query("UPDATE match_tickets SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1", [
    a.principal.userId,
  ]);
  await expect(sdk.joinById(assignment.roomCode, { protocol: 2, ticket: stale.data.data.ticket })).rejects.toThrow();
  await db.query('UPDATE owned_cards SET level=level+1,version=version+1 WHERE id=$1', [a.lineup.ownedCardIds[0]]);
  const fresh = await ticket(a, assignment.roomCode);
  expect(fresh.status).toBe(200);
  await connect(fresh.data.data);
  await expect(sdk.joinById(assignment.roomCode, { protocol: 2, ticket: fresh.data.data.ticket })).rejects.toThrow();
  expect(
    (
      await db.query('SELECT lineup_snapshot FROM match_tickets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [
        a.principal.userId,
      ])
    ).rows[0].lineup_snapshot.cards[0].ownedLevel,
  ).toBe(1);
});

test('SQL readiness failure preserves the already created real room and retries that exact assignment', async () => {
  const [a, b] = await Promise.all([owner(), owner()]);
  await enqueue(a);
  await enqueue(b);
  await db.query(`CREATE FUNCTION queue_ready_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.state='ready' THEN RAISE EXCEPTION 'queue_ready_fixture';END IF;RETURN NEW;END $$;
    CREATE TRIGGER queue_ready_fixture BEFORE UPDATE ON matchmaking_assignments FOR EACH ROW EXECUTE FUNCTION queue_ready_fixture()`);
  let assignment: Awaited<ReturnType<typeof assigned>> | undefined;
  try {
    await server.matchmaking!.pump();
    assignment = (await queue.current(a.principal)).entry!.assignment!;
    expect(assignment.state).toBe('preparing');
    expect(
      (await matchMaker.query({ name: ACCOUNT_ROOM_NAME })).filter((room) => room.roomId === assignment!.roomCode),
    ).toHaveLength(1);
    expect((await ticket(a, assignment.roomCode)).status).toBe(404);
  } finally {
    await db.query('DROP TRIGGER queue_ready_fixture ON matchmaking_assignments;DROP FUNCTION queue_ready_fixture()');
  }
  await server.matchmaking!.pump();
  expect((await queue.current(a.principal)).entry!.assignment).toMatchObject({
    id: assignment!.id,
    roomCode: assignment!.roomCode,
    state: 'ready',
  });
  expect(
    (await matchMaker.query({ name: ACCOUNT_ROOM_NAME })).filter((room) => room.roomId === assignment!.roomCode),
  ).toHaveLength(1);
});

test('a failure at the room allocator port fails the original pair and releases it for a real room retry', async () => {
  const [a, b] = await Promise.all([owner(), owner()]);
  await enqueue(a);
  await enqueue(b);
  const codes = ['UVWXYZ', 'VWXYZ2'];
  let released = 0;
  const failing = new MatchmakingCoordinator(queue, {
    find: () => undefined,
    reserve() {
      return {
        code: codes.shift()!,
        create: async () => {
          throw new Error('isolated room allocator failure');
        },
        release: async () => {
          released++;
        },
      };
    },
  });
  try {
    await failing.pump();
  } finally {
    await failing.close();
  }
  expect(released).toBe(2);
  expect((await queue.current(a.principal)).entry!.state).toBe('failed');
  expect((await queue.current(b.principal)).entry!.state).toBe('failed');
  expect(await matchMaker.query({ name: ACCOUNT_ROOM_NAME })).toHaveLength(0);
  await enqueue(a);
  await enqueue(b);
  await server.matchmaking!.pump();
  expect((await queue.current(a.principal)).entry!.assignment!.state).toBe('ready');
  expect(await matchMaker.query({ name: ACCOUNT_ROOM_NAME })).toHaveLength(1);
});

test('a queued account cannot obtain a second friend room and an existing game cannot enter matchmaking', async () => {
  const [a, b] = await Promise.all([owner(), owner()]);
  const at = await ticket(a),
    first = await connect(at.data.data),
    bt = await ticket(b, at.data.data.roomCode),
    second = await connect(bt.data.data);
  first.room.send('ready', { ready: true });
  second.room.send('ready', { ready: true });
  await until(() => first.latest<MatchStartMsg>(S2C.matchStart));
  await expect(enqueue(a)).rejects.toMatchObject({ code: 'CONFLICT' });
  const c = await owner();
  await enqueue(c);
  expect((await ticket(c)).status).toBe(409);
});

test('an already open friend lobby cannot bypass a successful queue assignment when both sides ready', async () => {
  const [a, b, c] = await Promise.all([owner(), owner(), owner()]);
  const at = await ticket(a),
    first = await connect(at.data.data),
    ct = await ticket(c, at.data.data.roomCode),
    other = await connect(ct.data.data);
  const assignment = await assigned(a, b);
  first.room.send('ready', { ready: true });
  other.room.send('ready', { ready: true });
  await until(() => first.latest(S2C.error) || other.latest(S2C.error));
  expect((await db.query('SELECT * FROM matches WHERE room_code=$1', [at.data.data.roomCode])).rowCount).toBe(0);
  const qa = await connect((await ticket(a, assignment.roomCode)).data.data),
    qb = await connect((await ticket(b, assignment.roomCode)).data.data);
  qa.room.send('ready', { ready: true });
  qb.room.send('ready', { ready: true });
  await until(() => qa.latest<MatchStartMsg>(S2C.matchStart));
  expect(
    (await db.query('SELECT count(*)::text AS n FROM match_participants WHERE user_id=$1', [a.principal.userId]))
      .rows[0].n,
  ).toBe('1');
});

test('cancel racing the live allocator creates either one original room or no room', async () => {
  const [a, b] = await Promise.all([owner(), owner()]);
  const entry = (await enqueue(a)).entry!;
  await enqueue(b);
  await Promise.all([queue.cancel(a.principal, entry.id), server.matchmaking!.pump()]);
  const current = (await queue.current(a.principal)).entry!;
  const rooms = await matchMaker.query({ name: ACCOUNT_ROOM_NAME });
  if (current.state === 'cancelled') expect(rooms).toHaveLength(0);
  else {
    expect(current.state).toBe('matched');
    expect(rooms.map((room) => room.roomId)).toEqual([current.assignment!.roomCode]);
  }
});

test('expired allocation and queue caches cannot admit stale tickets or block a new friend room', async () => {
  const [a, b] = await Promise.all([owner(), owner()]),
    assignment = await assigned(a, b);
  const original = await ticket(a, assignment.roomCode);
  expect(original.status).toBe(200);
  await db.query("UPDATE matchmaking_assignments SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [
    assignment.id,
  ]);
  await expect(sdk.joinById(assignment.roomCode, { protocol: 2, ticket: original.data.data.ticket })).rejects.toThrow();
  expect((await ticket(a)).status).toBe(200);
  await server.matchmaking!.pump();
  expect((await queue.current(b.principal)).entry!.state).toBe('expired');
});
