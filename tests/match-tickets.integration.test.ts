import './node-transport.setup';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { beforeAll, afterAll, expect, test, vi } from 'vitest';
import { Client, type Room } from 'colyseus.js';
import { matchMaker } from 'colyseus';
import { AccountRepository, Database, migrateDatabase } from '@pengzhuang/persistence';
import { readRuntimeConfig } from '../config/runtime';
import { createBundledEconomyConfiguration } from '../config/economy';
import { DEFAULT_DATA } from '../shared/data';
import {
  ACCOUNT_ROOM_NAME,
  ROOM_NAME,
  ACCOUNT_PROTOCOL_VERSION as PROTOCOL_VERSION,
  PROTOCOL_VERSION as GUEST_PROTOCOL_VERSION,
  S2C,
  type RoomSnapshot,
  type MatchStartMsg,
  type ShotMsg,
  type ShotAckMsg,
  type ShotPacketMsg,
  type ErrorMsg,
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
import { MatchRoom } from '../server/rooms/MatchRoom';

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
  recovery: () => undefined,
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
    messages,
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
    { protocol: 1 },
    { mode: 'practice' },
  ])
    expect((await post(account, { ...command(account), ...extra })).status).toBe('protocol' in extra ? 426 : 400);
  expect((await post(account, { ...command(account), protocol: 1 })).data.error).toMatchObject({
    code: 'PROTOCOL_UNSUPPORTED',
    retryable: false,
  });
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
  const guest = watch(await sdk.create(ROOM_NAME, { protocol: GUEST_PROTOCOL_VERSION, nickname: 'guest' }));
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

test('v2 account shots acknowledge original sequences, reject changed payloads and bind receipts to the account', async () => {
  const accounts = [await owner(), await owner()];
  const first = await issue(accounts[0]);
  const peers = [await join(first), await join(await issue(accounts[1], first.roomCode))];
  peers.forEach((peer) => peer.room.send('ready', { ready: true }));
  const start = await until(() => peers[0].latest<MatchStartMsg>(S2C.matchStart));
  expect(start).toMatchObject({ protocol: 2, revision: 0 });
  await until(() => peers[1].latest<MatchStartMsg>(S2C.matchStart));
  const side = start.state.turn,
    actor = peers[side];
  const shot: ShotMsg = {
    protocol: 2,
    revision: 0,
    matchId: start.matchId,
    turnId: start.state.shotNo,
    clientShotId: 'same-intent',
    configVersion: start.configVersion,
    input: {
      pieceId: start.state.pieces.find((piece) => piece.side === side)!.id,
      dirX: 1,
      dirY: 0,
      power: 0.1,
      curve: 0,
    },
  };
  const rejected = async (peer: typeof actor, type: string, body: unknown, code: string) => {
    const from = peer.messages.length;
    peer.room.send(type, body);
    const reply = await until(
      () => peer.messages.slice(from).find((message) => message.type === S2C.error)?.data as ErrorMsg | undefined,
    );
    expect(reply.code).toBe(code);
  };
  await rejected(actor, 'shot', { ...shot, revision: 1 }, 'stale-state');
  await rejected(actor, 'shot', { ...shot, turnId: 1 }, 'stale-turn');
  await rejected(actor, 'shot', { ...shot, configVersion: 'other' }, 'config-mismatch');
  await rejected(actor, 'shot', { ...shot, protocol: 1 }, 'protocol-mismatch');
  actor.room.send('shot', shot);
  expect(await until(() => actor.latest<ShotAckMsg>(S2C.shotAck))).toMatchObject({
    protocol: 2,
    seq: 1,
    revision: 1,
    acceptedRevision: 1,
    duplicate: false,
  });
  const packet = await until(() => actor.latest<ShotPacketMsg>(S2C.shotPacket));
  expect(packet.state.rng).toBe(0);
  const original = structuredClone(packet);
  actor.room.send('shot', shot);
  await until(() => actor.latest<ShotAckMsg>(S2C.shotAck)?.duplicate);
  expect(actor.latest<ShotAckMsg>(S2C.shotAck)).toMatchObject({ seq: 1, acceptedRevision: 1 });
  for (const extra of [
    { input: { ...shot.input, power: 0.2 } },
    { turnId: 1 },
    { revision: 1 },
    { configVersion: 'other' },
  ])
    await rejected(actor, 'shot', { ...shot, ...extra }, 'shot-conflict');
  expect(actor.latest<ShotPacketMsg>(S2C.shotPacket)).toEqual(original);
  const nextSide = packet.state.turn,
    next = peers[nextSide];
  next.room.send('shot', {
    ...shot,
    revision: packet.revision,
    turnId: packet.state.shotNo,
    input: {
      ...shot.input,
      pieceId: packet.state.pieces.find((piece) => piece.side === nextSide && piece.out === 0 && piece.frozen === 0)!
        .id,
    },
  });
  expect(
    await until(() => next.latest<ShotAckMsg>(S2C.shotAck)?.seq === 2 && next.latest<ShotAckMsg>(S2C.shotAck)),
  ).toMatchObject({ seq: 2, duplicate: false });
  const replacement = await join(await issue(accounts[side], first.roomCode));
  await until(() => replacement.latest<RoomSnapshot>(S2C.room));
  replacement.room.send('shot', shot);
  expect(await until(() => replacement.latest<ShotAckMsg>(S2C.shotAck))).toMatchObject({
    seq: 1,
    acceptedRevision: 1,
    duplicate: true,
    revision: 2,
  });
  await rejected(replacement, 'surrender', {}, 'bad-message');
  await rejected(
    replacement,
    'surrender',
    { protocol: 2, matchId: 'wrong', configVersion: start.configVersion },
    'stale-match',
  );
  await rejected(
    replacement,
    'surrender',
    { protocol: 2, matchId: start.matchId, configVersion: 'wrong' },
    'config-mismatch',
  );
  replacement.room.send('surrender', { protocol: 2, matchId: start.matchId, configVersion: start.configVersion });
  await until(() => replacement.latest<{ state: { over: boolean } }>(S2C.update)?.state.over);
  const count = replacement.messages.length;
  replacement.room.send('shot', shot);
  expect(
    await until(
      () =>
        replacement.messages.slice(count).find((message) => message.type === S2C.shotAck)?.data as
          ShotAckMsg | undefined,
    ),
  ).toMatchObject({ seq: 1, acceptedRevision: 1, duplicate: true, revision: 3 });
});

test('old account ticket protocol fails closed without consuming its nonce', async () => {
  const account = await owner(),
    ticket = await issue(account);
  await db.query('UPDATE match_tickets SET protocol_version = 1 WHERE nonce_hash = $1', [hash(ticket.ticket)]);
  await expect(join(ticket)).rejects.toThrow('unauthenticated');
  expect(
    (await db.query('SELECT consumed_at FROM match_tickets WHERE nonce_hash = $1', [hash(ticket.ticket)])).rows[0]
      .consumed_at,
  ).toBeNull();
});

async function activeGame(reconnectMs = 60000) {
  const accounts = [await owner(), await owner()];
  const restore = MatchRoom.useTiming({ reconnectMs });
  let first: Ticket;
  try {
    first = await issue(accounts[0]);
  } finally {
    restore();
  }
  const peers = [await join(first!), await join(await issue(accounts[1], first!.roomCode))];
  peers.forEach((peer) => peer.room.send('ready', { ready: true }));
  const start = await until(() => peers[0].latest<MatchStartMsg>(S2C.matchStart));
  return { accounts, peers, start, code: first!.roomCode };
}
const activeMatch = (account: Owner, headers = account.headers, suffix = '') =>
  jsonRequest(origin, `/api/v1/me/active-match${suffix}`, { headers });
const reentry = (account: Owner, matchId: string, body: unknown = { protocol: 2 }, headers = account.headers) =>
  jsonRequest(origin, `/api/v1/matches/${matchId}/reentry`, { method: 'POST', headers, body });

test('active matches persist both participants atomically and expose only the authenticated owner recovery', async () => {
  const outsider = await owner();
  expect((await activeMatch(outsider)).data.data).toEqual({
    userId: outsider.principal.userId,
    state: 'none',
    match: null,
  });
  const game = await activeGame(),
    [a, b] = game.accounts;
  const rows = (
    await db.query(
      'SELECT m.room_code,m.protocol_version,p.user_id,p.side,p.lineup_snapshot FROM matches m JOIN match_participants p ON p.match_id=m.id WHERE m.id=$1 ORDER BY p.side',
      [game.start.matchId],
    )
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.user_id)).toEqual([a.principal.userId, b.principal.userId]);
  expect(
    rows.every((row) => row.lineup_snapshot.length === 5 && row.room_code === game.code && row.protocol_version === 2),
  ).toBe(true);
  const view = await activeMatch(a);
  expect(view.headers['cache-control']).toBe('no-store');
  for (const [path, method] of [
    ['/api/v1/me/active-match', 'GET'],
    [`/api/v1/matches/${game.start.matchId}/reentry`, 'POST'],
  ]) {
    const cors = await jsonRequest(origin, path, {
      method: 'OPTIONS',
      headers: {
        origin: issuer,
        'access-control-request-method': method,
        'access-control-request-headers': 'content-type,x-csrf-token,x-account-id',
      },
    });
    expect(cors.status).toBe(204);
    expect(cors.headers['access-control-allow-origin']).toBe(issuer);
  }
  expect(view.data.data).toMatchObject({
    userId: a.principal.userId,
    state: 'available',
    match: { matchId: game.start.matchId, roomCode: game.code, side: 0, reconnectMs: null },
  });
  expect(JSON.stringify(view.data.data)).not.toContain(b.principal.userId);
  for (const secret of ['ticket', 'seatToken', 'ownedCardId', 'rng', 'sessionId'])
    expect(JSON.stringify(view.data.data)).not.toContain(secret);
  expect((await activeMatch(outsider)).data.data.state).toBe('none');
  expect((await reentry(outsider, game.start.matchId)).status).toBe(404);
  expect((await reentry(a, randomUUID())).status).toBe(404);
  expect((await activeMatch(a, a.headers, `?userId=${b.principal.userId}`)).status).toBe(400);
  expect((await activeMatch(a, { ...a.headers, 'x-account-id': b.principal.userId })).status).toBe(409);
  expect((await activeMatch(a, { ...a.headers, cookie: '' })).status).toBe(401);
  for (const extra of [{ userId: b.principal.userId }, { side: 1 }, { lineupId: b.lineup.id }, { protocol: 1 }])
    expect((await reentry(a, game.start.matchId, { protocol: 2, ...extra })).status).toBe(400);
  await db.query('UPDATE matches SET protocol_version=1 WHERE id=$1', [game.start.matchId]);
  expect((await activeMatch(a)).data.data.state).toBe('unavailable');
  expect((await reentry(a, game.start.matchId)).status).toBe(503);
  await db.query('UPDATE matches SET protocol_version=2 WHERE id=$1', [game.start.matchId]);
});

test('fresh-session reentry reuses the original match and lineup after the cloud lineup has changed', async () => {
  const game = await activeGame(),
    a = game.accounts[0];
  await db.query('UPDATE lineups SET revision=revision+1 WHERE id=$1', [a.lineup.id]);
  await game.peers[0].room.leave(false);
  await until(() => game.peers[1].latest<RoomSnapshot>(S2C.room)?.seats[0]?.connected === false);
  expect((await activeMatch(a)).data.data.match.reconnectMs).toBeGreaterThan(0);
  const csrf = (await jsonRequest(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
  const credentials = await db.transaction((tx) => sessions.issue(tx, a.principal.userId, csrf));
  const headers = {
    ...a.headers,
    'x-csrf-token': csrf,
    cookie: `pz_csrf=${csrf}; pz_access=${credentials.accessToken}`,
  };
  const response = await reentry(a, game.start.matchId, { protocol: 2 }, headers);
  expect(response.status).toBe(200);
  const ticket = MatchTicketResultSchema.parse(response.data.data),
    resumed = await join(ticket);
  const snapshot = await until(() => resumed.latest<RoomSnapshot>(S2C.room));
  expect(snapshot.account).toMatchObject({ userId: a.principal.userId, revision: 0 });
  expect((await until(() => resumed.latest<{ matchId: string }>(S2C.resume))).matchId).toBe(game.start.matchId);
  expect(snapshot.seats[0]?.lineup).toEqual(game.start.lineups[0]);
  await expect(join(ticket)).rejects.toThrow('unauthenticated');
});

test('revocation and bans are rechecked at recovery discovery, issuance and final consumption', async () => {
  const game = await activeGame(),
    a = game.accounts[0],
    b = game.accounts[1];
  const beforeBan = await reentry(a, game.start.matchId);
  expect(beforeBan.status).toBe(200);
  await db.query("UPDATE users SET status='banned',banned_at=clock_timestamp() WHERE id=$1", [a.principal.userId]);
  expect((await activeMatch(a)).status).toBe(401);
  expect((await reentry(a, game.start.matchId)).status).toBe(401);
  await expect(join(MatchTicketResultSchema.parse(beforeBan.data.data))).rejects.toThrow('unauthenticated');
  await db.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1', [b.principal.sessionId]);
  expect((await activeMatch(b)).status).toBe(401);
  expect((await reentry(b, game.start.matchId)).status).toBe(401);
});

test('recovery windows expire to an explicit terminal state and no new ticket can revive the match', async () => {
  const game = await activeGame(150),
    a = game.accounts[0];
  await game.peers[0].room.leave(false);
  await vi.waitFor(async () => expect((await activeMatch(a)).data.data.state).toBe('expired'));
  expect((await reentry(a, game.start.matchId)).status).toBe(404);
  const record = (await db.query('SELECT recovery_close_reason FROM matches WHERE id=$1', [game.start.matchId]))
    .rows[0];
  expect(record.recovery_close_reason).toBe('expired');
});

test('ended matches retain an explicit recovery marker without pretending rewards were settled', async () => {
  const game = await activeGame(),
    a = game.accounts[0];
  game.peers[0].room.send('surrender', {
    protocol: 2,
    matchId: game.start.matchId,
    configVersion: game.start.configVersion,
  });
  await vi.waitFor(async () => expect((await activeMatch(a)).data.data.state).toBe('ended'));
  expect((await reentry(a, game.start.matchId)).status).toBe(404);
  const record = (
    await db.query('SELECT status,result,recovery_close_reason FROM matches WHERE id=$1', [game.start.matchId])
  ).rows[0];
  expect(record.status).not.toBe('settled');
  expect(record.result).toBeNull();
  expect(record.recovery_close_reason).toBe('ended');
});

test('a participant-write failure rolls the entire match start back and the same clients can retry', async () => {
  const a = await owner(),
    b = await owner(),
    first = await issue(a);
  const peers = [await join(first), await join(await issue(b, first.roomCode))];
  await db.query(`CREATE FUNCTION net03_fail_participant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.side=1 THEN RAISE EXCEPTION 'injected participant failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER net03_fail_participant BEFORE INSERT ON match_participants FOR EACH ROW EXECUTE FUNCTION net03_fail_participant()`);
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    peers.forEach((peer) => peer.room.send('ready', { ready: true }));
    await until(() => peers.some((peer) => peer.latest<ErrorMsg>(S2C.error)?.code === 'internal-error'));
    expect((await db.query('SELECT id FROM matches WHERE room_code=$1', [first.roomCode])).rows).toHaveLength(0);
    expect((matchMaker.getLocalRoomById(first.roomCode) as MatchRoom).inspect().phase).toBe('lobby');
    expect(peers[0].latest(S2C.matchStart)).toBeUndefined();
  } finally {
    await db.query('DROP TRIGGER net03_fail_participant ON match_participants; DROP FUNCTION net03_fail_participant()');
    logged.mockRestore();
  }
  peers.forEach((peer) => peer.room.send('ready', { ready: true }));
  const start = await until(() => peers[0].latest<MatchStartMsg>(S2C.matchStart));
  expect((await activeMatch(a)).data.data.match.matchId).toBe(start.matchId);
});

test('recovery discovery fails explicitly during a database outage and succeeds on a later bounded user retry', async () => {
  const game = await activeGame(),
    a = game.accounts[0];
  const original = db.transaction.bind(db);
  const fault = vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('private database detail'));
  const failed = await activeMatch(a);
  expect(failed.status).toBe(503);
  expect(JSON.stringify(failed.data)).not.toContain('private database detail');
  fault.mockImplementation(original);
  fault.mockRestore();
  expect((await activeMatch(a)).data.data.state).toBe('available');
});

test('leaving during the persisted start aborts that match instead of creating an orphan active seat', async () => {
  const a = await owner(),
    b = await owner(),
    first = await issue(a);
  const peers = [await join(first), await join(await issue(b, first.roomCode))];
  let release!: () => void,
    entered = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = tickets.recovery.started.bind(tickets.recovery);
  const delayed = vi.spyOn(tickets.recovery, 'started').mockImplementationOnce(async (input) => {
    entered = true;
    await gate;
    return original(input);
  });
  try {
    peers.forEach((peer) => peer.room.send('ready', { ready: true }));
    await until(() => entered);
    await peers[1].room.leave(false);
    release();
    await vi.waitFor(async () => expect((await activeMatch(a)).data.data.state).toBe('expired'));
    expect((matchMaker.getLocalRoomById(first.roomCode) as MatchRoom).inspect()).toMatchObject({
      phase: 'lobby',
      match: null,
    });
    expect(peers[0].latest(S2C.matchStart)).toBeUndefined();
    const replacement = await join(await issue(b, first.roomCode));
    peers[0].room.send('ready', { ready: true });
    replacement.room.send('ready', { ready: true });
    const start = await until(() => peers[0].latest<MatchStartMsg>(S2C.matchStart));
    expect((await activeMatch(a)).data.data.match.matchId).toBe(start.matchId);
  } finally {
    release();
    delayed.mockRestore();
  }
});

test('a more recent completed match does not hide an older match that is still recoverable', async () => {
  const game = await activeGame(),
    a = game.accounts[0],
    other = await owner();
  const second = await issue(a),
    peers = [await join(second), await join(await issue(other, second.roomCode))];
  peers.forEach((peer) => peer.room.send('ready', { ready: true }));
  const start = await until(() => peers[0].latest<MatchStartMsg>(S2C.matchStart));
  peers[0].room.send('surrender', { protocol: 2, matchId: start.matchId, configVersion: start.configVersion });
  await until(() => peers[0].latest<RoomSnapshot>(S2C.room)?.phase === 'ended');
  expect((await activeMatch(a)).data.data.match.matchId).toBe(game.start.matchId);
  expect((await reentry(a, game.start.matchId)).status).toBe(200);
});

test('production runtime mounts real ticket issuance and account room authentication', async () => {
  const account = await owner();
  const previous = await activeGame();
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
  expect((await activeMatch(previous.accounts[0])).data.data.state).toBe('unavailable');
  expect((await reentry(previous.accounts[0], previous.start.matchId)).status).toBe(503);
  const ticket = await issue(account),
    connection = await join(ticket);
  expect((await until(() => connection.latest<RoomSnapshot>(S2C.room))).account?.userId).toBe(account.principal.userId);
  expect((await jsonRequest(origin, '/api/v1/auth/options')).data.data.friendRoomsEnabled).toBe(true);
  expect((await jsonRequest(origin, '/api/v1/config/manifest')).data.data.availableModes).toEqual([
    'practice',
    'friend',
  ]);
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

test('maintenance disables account room creation on the server and keeps the manifest truthful', async () => {
  const account = await owner();
  await server.close();
  const web = new WebSessions(sessions, { cookieSecure: false, allowedOrigins: [issuer] }, signingKey);
  server = createGameServer({
    repository: db,
    clientDirectory: null,
    lobbyMaintenance: true,
    accountRooms: { tickets, web },
    modules: [web.module()],
  });
  await server.gameServer.listen(0);
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No maintenance port');
  origin = `http://127.0.0.1:${address.port}`;
  expect((await post(account)).status).toBe(503);
  expect((await jsonRequest(origin, '/api/v1/config/manifest')).data.data).toMatchObject({
    maintenance: true,
    availableModes: ['practice'],
  });
  expect(
    (await db.query('SELECT nonce_hash FROM match_tickets WHERE user_id = $1', [account.principal.userId])).rows,
  ).toHaveLength(0);
});
