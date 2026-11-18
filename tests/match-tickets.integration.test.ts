import './node-transport.setup';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { Client, type Room } from 'colyseus.js';
import { matchMaker } from 'colyseus';
import { AccountRepository, Database, migrateDatabase } from '@pengzhuang/persistence';
import { readRuntimeConfig } from '../config/runtime';
import { createBundledEconomyConfiguration } from '../config/economy';
import { DEFAULT_DATA } from '../shared/data';
import {
  ACCOUNT_ROOM_NAME,
  ROOM_NAME,
  PROTOCOL_VERSION,
  S2C,
  type RoomSnapshot,
  type MatchStartMsg,
} from '../shared/protocol';
import { createGameServer } from '../server/app';
import { startRuntime } from '../server/runtime';
import { PlayerData } from '../server/accounts/player-data';
import { Lineups } from '../server/accounts/lineups';
import { Sessions } from '../server/accounts/sessions';
import { WebSessions } from '../server/api/web-sessions';
import { MatchTickets, type AccountRoomTarget } from '../server/matches/tickets';
import { MatchTicketResultSchema } from '../packages/contracts/src/match-tickets';
import { jsonRequest } from './helpers/json-http';

let db: Database;
let server: ReturnType<typeof createGameServer>;
let sessions: Sessions;
let players: PlayerData;
let lineups: Lineups;
let tickets: MatchTickets;
let origin: string;
let sdk: Client;
const opened: Room[] = [];
const issuer = 'http://localhost:2567';
const signingKey = randomBytes(32).toString('base64url');
beforeAll(async () => {
  const config = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
  if (!config.databaseUrl || !process.env.PG_TEST_TMP_DIR) throw new Error('Isolated PostgreSQL required');
  db = new Database({ connectionString: config.databaseUrl });
  await migrateDatabase(db);
  players = new PlayerData(db, createBundledEconomyConfiguration().policy, DEFAULT_DATA);
  lineups = new Lineups(db, players.initialize, () => DEFAULT_DATA);
  const key = signingKey;
  sessions = new Sessions(db, key, issuer, players.initialize);
  const web = new WebSessions(sessions, { cookieSecure: false, allowedOrigins: [issuer] }, key);
  tickets = new MatchTickets(db, lineups, () => DEFAULT_DATA);
  server = createGameServer({
    repository: db,
    clientDirectory: null,
    modules: [web.module()],
    accountRooms: { tickets, web },
  });
  await server.gameServer.listen(0);
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  origin = `http://127.0.0.1:${address.port}`;
  sdk = new Client(origin.replace('http:', 'ws:'));
});
afterAll(async () => {
  await Promise.all(opened.filter((room) => room.connection?.isOpen).map((room) => room.leave()));
  await server?.close();
  await db?.close();
});
async function owner() {
  const csrf = (await jsonRequest(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
  const user = await new AccountRepository(db).createUser();
  const credentials = await db.transaction((tx) => sessions.issue(tx, user.id, csrf));
  const principal = await sessions.authenticate(credentials.accessToken);
  const lineup = (await lineups.list(principal, {})).lineups[0];
  return {
    principal,
    lineup,
    headers: {
      origin: issuer,
      'x-csrf-token': csrf,
      'x-account-id': user.id,
      cookie: `pz_csrf=${csrf}; pz_access=${credentials.accessToken}`,
    },
  };
}
type Owner = Awaited<ReturnType<typeof owner>>;
const command = (account: Owner, roomCode?: string) => ({
  protocol: PROTOCOL_VERSION,
  mode: 'friend',
  lineupId: account.lineup.id,
  expectedRevision: account.lineup.revision,
  ...(roomCode ? { roomCode } : {}),
});
function post(account: Owner, input: unknown = command(account), headers = account.headers) {
  return jsonRequest(origin, '/api/v1/matches/tickets', { method: 'POST', headers, body: input });
}
async function issue(account: Owner, roomCode?: string) {
  const response = await post(account, command(account, roomCode));
  expect(response.status).toBe(200);
  return MatchTicketResultSchema.parse(response.data.data);
}
type Ticket = Awaited<ReturnType<typeof issue>>;
const target = (ticket: Ticket): AccountRoomTarget => ({
  code: ticket.roomCode,
  data: DEFAULT_DATA,
  mode: ticket.mode,
  selection: () => undefined,
  canEnter: () => true,
});
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
async function until<T>(read: () => T | null | undefined | false): Promise<T> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Room state timeout');
}
function watch(room: Room) {
  opened.push(room);
  const messages: { type: string; data: unknown }[] = [];
  room.onMessage('*', (type, data) => messages.push({ type: String(type), data }));
  room.onError(() => undefined);
  return {
    room,
    latest: <T>(type: string) => messages.filter((message) => message.type === type).at(-1)?.data as T | undefined,
  };
}
const join = async (ticket: Ticket) =>
  watch(await sdk.joinById(ticket.roomCode, { protocol: PROTOCOL_VERSION, ticket: ticket.ticket }));

test('HTTP tickets require real authentication, same-origin CSRF, account hint, strict payload and protocol', async () => {
  const account = await owner();
  const preflight = await jsonRequest(origin, '/api/v1/matches/tickets', {
    method: 'OPTIONS',
    headers: {
      origin: issuer,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,x-csrf-token,x-account-id',
    },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers['access-control-allow-origin']).toBe(issuer);
  expect(
    (await jsonRequest(origin, '/api/v1/matches/tickets', { method: 'POST', body: command(account) })).status,
  ).toBe(403);
  expect(
    (await post(account, command(account), { ...account.headers, cookie: account.headers.cookie.split(';')[0] }))
      .status,
  ).toBe(401);
  expect(
    (await post(account, command(account), { ...account.headers, origin: 'https://untrusted.example' })).status,
  ).toBe(403);
  expect(
    (await post(account, command(account), { ...account.headers, 'x-account-id': randomUUID() })).data.error.code,
  ).toBe('ACCOUNT_CHANGED');
  for (const extra of [
    { userId: randomUUID() },
    { nickname: 'pretend' },
    { levels: [10, 10, 10, 10, 10] },
    { snapshot: {} },
    { protocol: 999 },
    { mode: 'practice' },
  ])
    expect((await post(account, { ...command(account), ...extra })).status).toBe(400);
  expect(
    (await db.query('SELECT nonce_hash FROM match_tickets WHERE user_id = $1', [account.principal.userId])).rows,
  ).toHaveLength(0);
});

test('foreign lineups, stale revisions, guest rooms, unknown rooms and different modes are denied without tickets', async () => {
  const account = await owner(),
    foreign = await owner();
  expect((await post(account, { ...command(account), lineupId: foreign.lineup.id })).status).toBe(404);
  expect((await post(account, { ...command(account), expectedRevision: 9 })).status).toBe(409);
  expect((await post(account, command(account, 'AAAAAA'))).status).toBe(404);
  const guest = watch(await sdk.create(ROOM_NAME, { protocol: PROTOCOL_VERSION, nickname: 'guest' }));
  expect((await post(account, command(account, guest.room.roomId))).status).toBe(404);
  const first = await issue(foreign);
  expect((await post(account, { ...command(account, first.roomCode), mode: 'ranked' })).status).toBe(404);
  expect(
    (await db.query('SELECT nonce_hash FROM match_tickets WHERE user_id = $1', [account.principal.userId])).rows,
  ).toHaveLength(0);
});

test('one nonce has one winner under concurrent consumers, including another service instance; hashes only at rest', async () => {
  const account = await owner(),
    ticket = await issue(account);
  const other = new MatchTickets(db, lineups, () => DEFAULT_DATA);
  const claims = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) => (i % 2 ? tickets : other).consume(ticket.ticket, target(ticket))),
  );
  expect(claims.filter((claim) => claim.status === 'fulfilled')).toHaveLength(1);
  const winner = claims.find((claim) => claim.status === 'fulfilled');
  expect(winner?.status === 'fulfilled' && winner.value).toMatchObject({
    userId: account.principal.userId,
    authSessionId: account.principal.sessionId,
  });
  const row = (await db.query('SELECT * FROM match_tickets WHERE nonce_hash = $1', [hash(ticket.ticket)])).rows[0];
  expect(row.consumed_at).toBeInstanceOf(Date);
  expect(JSON.stringify(row)).not.toContain(ticket.ticket);
  await expect(tickets.consume(ticket.ticket, target(ticket))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
});

test('wrong room/mode/config cannot consume a valid ticket; expiry rejects the correct destination', async () => {
  const account = await owner(),
    ticket = await issue(account);
  for (const wrong of [
    { code: 'AAAAAA' },
    { mode: 'growth' as const },
    { data: { ...DEFAULT_DATA, version: 'wrong' } },
  ])
    await expect(tickets.consume(ticket.ticket, { ...target(ticket), ...wrong })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  expect(
    (await db.query('SELECT consumed_at FROM match_tickets WHERE nonce_hash = $1', [hash(ticket.ticket)])).rows[0]
      .consumed_at,
  ).toBeNull();
  await db.query(
    "UPDATE match_tickets SET expires_at = clock_timestamp() - interval '1 second' WHERE nonce_hash = $1",
    [hash(ticket.ticket)],
  );
  await expect(tickets.consume(ticket.ticket, target(ticket))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
});

test.each(['ban', 'revoke', 'expire', 'disable'] as const)(
  'account/session/card %s after issuance prevents entry and does not burn the nonce',
  async (kind) => {
    const account = await owner(),
      ticket = await issue(account);
    if (kind === 'ban')
      await db.query("UPDATE users SET status = 'banned', banned_at = clock_timestamp() WHERE id = $1", [
        account.principal.userId,
      ]);
    if (kind === 'revoke')
      await db.query('UPDATE sessions SET revoked_at = clock_timestamp() WHERE id = $1', [account.principal.sessionId]);
    if (kind === 'expire')
      await db.query(
        "UPDATE sessions SET created_at = clock_timestamp() - interval '2 days', expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
        [account.principal.sessionId],
      );
    if (kind === 'disable')
      await db.query("UPDATE owned_cards SET status = 'disabled' WHERE id = $1", [account.lineup.ownedCardIds[0]]);
    await expect(join(ticket)).rejects.toThrow(kind === 'disable' ? 'forbidden' : 'unauthenticated');
    expect(
      (await db.query('SELECT consumed_at FROM match_tickets WHERE nonce_hash = $1', [hash(ticket.ticket)])).rows[0]
        .consumed_at,
    ).toBeNull();
  },
);

test('issuance and consumption database faults leave no partial ticket and permit a bounded manual retry', async () => {
  const account = await owner();
  await db.query(
    "CREATE FUNCTION net01_fail_ticket() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private simulated SQL detail'; END $$",
  );
  await db.query(
    'CREATE TRIGGER net01_fail_issue BEFORE INSERT ON match_tickets FOR EACH ROW EXECUTE FUNCTION net01_fail_ticket()',
  );
  try {
    const response = await post(account);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.data)).not.toContain('private simulated');
  } finally {
    await db.query('DROP TRIGGER net01_fail_issue ON match_tickets');
  }
  const ticket = await issue(account);
  await db.query(
    'CREATE TRIGGER net01_fail_consume BEFORE UPDATE ON match_tickets FOR EACH ROW EXECUTE FUNCTION net01_fail_ticket()',
  );
  try {
    await expect(tickets.consume(ticket.ticket, target(ticket))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  } finally {
    await db.query('DROP TRIGGER net01_fail_consume ON match_tickets');
    await db.query('DROP FUNCTION net01_fail_ticket()');
  }
  expect((await tickets.consume(ticket.ticket, target(ticket))).userId).toBe(account.principal.userId);
});

test('real SDK account rooms use server profile and frozen owned lineup; client identities, seat tokens and lineup writes fail', async () => {
  const a = await owner(),
    b = await owner();
  await db.query("UPDATE profiles SET nickname = '相同昵称' WHERE user_id = ANY($1::uuid[])", [
    [a.principal.userId, b.principal.userId],
  ]);
  const ta = await issue(a),
    tb = await issue(b, ta.roomCode);
  await expect(
    sdk.create(ACCOUNT_ROOM_NAME, { protocol: PROTOCOL_VERSION, nickname: 'pretend', mode: 'friend' }),
  ).rejects.toThrow('forbidden');
  await expect(
    sdk.joinById(ta.roomCode, {
      protocol: PROTOCOL_VERSION,
      nickname: '相同昵称',
      seatToken: randomBytes(16).toString('base64url'),
    }),
  ).rejects.toThrow('unauthenticated');
  await expect(
    sdk.joinById(ta.roomCode, { protocol: PROTOCOL_VERSION, ticket: ta.ticket, userId: b.principal.userId }),
  ).rejects.toThrow('unauthenticated');
  const wa = await join(ta),
    wb = await join(tb);
  const snapshot = await until(() => wa.latest<RoomSnapshot>(S2C.room)?.seats[1] && wa.latest<RoomSnapshot>(S2C.room));
  expect(snapshot.identity).toBe('account');
  expect(snapshot.account).toEqual({ userId: a.principal.userId, lineupId: a.lineup.id, revision: 0 });
  expect(snapshot.seatToken).toBeUndefined();
  expect(JSON.stringify(snapshot)).not.toContain(b.principal.userId);
  expect(snapshot.seats.map((seat) => seat?.nickname)).toEqual(['相同昵称', '相同昵称']);
  wa.room.send('set_lineup', { lineup: DEFAULT_DATA.rules.defaultLineup, levels: Array(5).fill(10) });
  expect((await until(() => wa.latest<{ code: string }>(S2C.error))).code).toBe('forbidden');
  for (const peer of [wa, wb]) peer.room.send('ready', { ready: true });
  const start = await until(() => wa.latest<MatchStartMsg>(S2C.matchStart));
  expect(start.levels).toEqual([Array(5).fill(5), Array(5).fill(5)]);
  expect(start.state.pieces).toHaveLength(10);
  const row = (await db.query('SELECT lineup_snapshot FROM match_tickets WHERE nonce_hash = $1', [hash(ta.ticket)]))
    .rows[0].lineup_snapshot;
  expect(start.lineups[0]).toEqual(row.cards.map((card: { playerDefId: string }) => card.playerDefId));
  await expect(join(ta)).rejects.toThrow('unauthenticated');
});

test('fresh tickets re-enter only their account seat; bans and session revocation still block reconnection', async () => {
  const a = await owner(),
    b = await owner(),
    outsider = await owner();
  const ta = await issue(a),
    wa = await join(ta),
    wb = await join(await issue(b, ta.roomCode));
  for (const peer of [wa, wb]) peer.room.send('ready', { ready: true });
  await until(() => wa.latest<MatchStartMsg>(S2C.matchStart));
  expect((await post(outsider, command(outsider, ta.roomCode))).status).toBe(404);
  await wa.room.leave(false);
  const next = await issue(a, ta.roomCode);
  const replacement = await join(next);
  expect((await until(() => replacement.latest<RoomSnapshot>(S2C.room))).mySeat).toBe(0);
  const blocked = await issue(a, ta.roomCode);
  await db.query('UPDATE sessions SET revoked_at = clock_timestamp() WHERE id = $1', [a.principal.sessionId]);
  await expect(join(blocked)).rejects.toThrow('unauthenticated');
});

test('ticket snapshots preserve original card levels despite later upgrades and growth uses server-owned levels', async () => {
  const account = await owner();
  const first = await post(account, { ...command(account), mode: 'growth' });
  expect(first.status).toBe(200);
  const ticket = MatchTicketResultSchema.parse(first.data.data);
  await db.query('UPDATE owned_cards SET level = 10, version = version + 1 WHERE id = $1', [
    account.lineup.ownedCardIds[0],
  ]);
  const auth = await tickets.consume(ticket.ticket, target(ticket));
  expect(auth.snapshot.cards.map((card) => card.level)).toEqual(Array(5).fill(1));
  expect(Object.isFrozen(auth.snapshot.cards)).toBe(true);
  const second = await post(account, { ...command(account), mode: 'growth' });
  expect(second.status).toBe(200);
  const next = MatchTicketResultSchema.parse(second.data.data),
    joined = await join(next);
  expect((await until(() => joined.latest<RoomSnapshot>(S2C.room))).seats[0]?.levels).toEqual([10, 1, 1, 1, 1]);
});

test('account issuance is bounded across concurrent requests and unauthenticated direct creation allocates no rooms', async () => {
  const account = await owner();
  const first = await issue(account),
    joined = await join(first);
  await until(() => joined.latest<RoomSnapshot>(S2C.room));
  const issued = await Promise.all(Array.from({ length: 15 }, () => post(account, command(account, first.roomCode))));
  expect(issued.filter((response) => response.status === 200)).toHaveLength(11);
  expect(issued.filter((response) => response.status === 429)).toHaveLength(4);
  const before = (await matchMaker.query({ name: ACCOUNT_ROOM_NAME })).length;
  for (let i = 0; i < 3; i++)
    await expect(sdk.create(ACCOUNT_ROOM_NAME, { creationKey: randomUUID() })).rejects.toThrow('forbidden');
  expect((await matchMaker.query({ name: ACCOUNT_ROOM_NAME })).length).toBe(before);
});

test('concurrent real WebSocket replays admit exactly one connection', async () => {
  const account = await owner(),
    ticket = await issue(account);
  const results = await Promise.allSettled([join(ticket), join(ticket)]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const success = results.find((result) => result.status === 'fulfilled');
  if (success?.status !== 'fulfilled') throw new Error('No successful join');
  const snapshot = await until(() => success.value.latest<RoomSnapshot>(S2C.room));
  expect(snapshot.seats.filter(Boolean)).toHaveLength(1);
});

test('production runtime mounts real ticket issuance and account room authentication', async () => {
  const account = await owner();
  await server.close();
  server = await startRuntime(
    readRuntimeConfig({
      ...process.env,
      APP_ENV: 'test',
      SESSION_SIGNING_KEY: signingKey,
      PUBLIC_ORIGIN: issuer,
      ALLOWED_ORIGINS: issuer,
      ROOM_STORE_DIR: path.join(process.env.PG_TEST_TMP_DIR!, 'net01-runtime-rooms'),
    }),
    0,
  );
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No runtime port');
  origin = `http://127.0.0.1:${address.port}`;
  sdk = new Client(origin.replace('http:', 'ws:'));
  const ticket = await issue(account),
    connection = await join(ticket);
  expect((await until(() => connection.latest<RoomSnapshot>(S2C.room))).account?.userId).toBe(account.principal.userId);
});

test('a late third-account ticket cannot occupy either seat, while a fresh own ticket replaces a live connection', async () => {
  const a = await owner(),
    b = await owner(),
    c = await owner();
  const ta = await issue(a),
    tb = await issue(b, ta.roomCode),
    tc = await issue(c, ta.roomCode);
  const wa = await join(ta),
    wb = await join(tb);
  await until(() => wb.latest<RoomSnapshot>(S2C.room));
  await expect(join(tc)).rejects.toThrow('unauthenticated');
  const replacement = await join(await issue(a, ta.roomCode));
  const snapshot = await until(() => replacement.latest<RoomSnapshot>(S2C.room));
  expect(snapshot.mySeat).toBe(0);
  expect(snapshot.seats.filter(Boolean)).toHaveLength(2);
  expect(snapshot.account?.userId).toBe(a.principal.userId);
  await until(() => !wa.room.connection.isOpen);
  expect(wb.room.connection.isOpen).toBe(true);
});
