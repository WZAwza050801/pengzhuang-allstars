import './node-transport.setup';
import { beforeAll, afterAll, expect, test, vi } from 'vitest';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { Client, type Room } from 'colyseus.js';
import { AccountRepository, Database, migrateDatabase } from '@pengzhuang/persistence';
import { createDataFixture } from './helpers/data-factory';
import { createGameServer } from '../server/app';
import { DEFAULT_DATA, buildGameData, type GameData } from '../shared/data';
import { Sessions } from '../server/accounts/sessions';
import { WebSessions } from '../server/api/web-sessions';
import { Lineups } from '../server/accounts/lineups';
import { MatchTickets } from '../server/matches/tickets';
import { MatchOutcomes } from '../server/matches/outcomes';
import { OutcomeJournal } from '../server/matches/outcome-journal';
import { RecoveryJournal } from '../server/matches/recovery-journal';
import { readRuntimeConfig } from '../config/runtime';
import { jsonRequest } from './helpers/json-http';
import {
  S2C,
  type MatchStartMsg,
  type ShotMsg,
  type ShotAckMsg,
  type ShotPacketMsg,
  type ErrorMsg,
  type ResumeMsg,
} from '../shared/protocol';

let db: Database, fixture: Awaited<ReturnType<typeof createDataFixture>>, server: ReturnType<typeof createGameServer>;
let sessions: Sessions, lineups: Lineups, origin: string, sdk: Client;
let outcomesDirectory: string,
  advertisedData: GameData = DEFAULT_DATA;
const opened: Room[] = [],
  issuer = 'http://localhost:2567',
  key = randomBytes(32).toString('base64url');
beforeAll(async () => {
  db = new Database({ connectionString: process.env.TEST_DATABASE_URL! });
  fixture = await createDataFixture(db);
  await migrateDatabase(db);
  lineups = new Lineups(db, fixture.players.initialize, () => DEFAULT_DATA);
  outcomesDirectory = path.join(process.env.PG_TEST_TMP_DIR!, `net05-room-outcomes-${randomUUID()}`);
  await boot();
});
async function boot() {
  sessions = new Sessions(db, key, issuer, fixture.players.initialize);
  const web = new WebSessions(
    sessions,
    readRuntimeConfig({ ...process.env, APP_ENV: 'test', PUBLIC_ORIGIN: issuer, SESSION_SIGNING_KEY: key }),
    key,
  );
  const outcomes = new MatchOutcomes({
    db,
    assets: fixture.assets,
    policy: () => fixture.policy,
    journal: new OutcomeJournal(outcomesDirectory),
    onEvent: () => undefined,
  });
  server = createGameServer({
    repository: db,
    clientDirectory: null,
    modules: [web.module()],
    accountRooms: { tickets: new MatchTickets(db, lineups, () => advertisedData), web, outcomes },
    closeResources: [() => outcomes.close()],
  });
  await outcomes.start();
  await server.gameServer.listen(0);
  await server.restoreAccountRooms();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  origin = `http://127.0.0.1:${address.port}`;
  sdk = new Client(origin.replace('http:', 'ws:'));
}
afterAll(async () => {
  await Promise.all(opened.filter((room) => room.connection?.isOpen).map((room) => room.leave()));
  await server?.close();
  await fixture?.close();
  await db?.close();
});
async function until<T>(read: () => T | null | undefined | false) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    const result = read();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Account checkpoint room timeout');
}
async function owner() {
  const csrf = (await jsonRequest(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
  const user = await new AccountRepository(db).createUser();
  const issued = await db.transaction((tx) => sessions.issue(tx, user.id, csrf)),
    principal = await sessions.authenticate(issued.accessToken);
  const lineup = (await lineups.list(principal, {})).lineups[0];
  return {
    userId: user.id,
    lineup,
    headers: {
      origin: issuer,
      'x-csrf-token': csrf,
      'x-account-id': user.id,
      cookie: `pz_csrf=${csrf}; pz_access=${issued.accessToken}`,
    },
  };
}
async function join(account: Awaited<ReturnType<typeof owner>>, code?: string) {
  const response = await jsonRequest(origin, '/api/v1/matches/tickets', {
    method: 'POST',
    headers: account.headers,
    body: {
      protocol: 2,
      mode: 'friend',
      lineupId: account.lineup.id,
      expectedRevision: account.lineup.revision,
      ...(code ? { roomCode: code } : {}),
    },
  });
  expect(response.status).toBe(200);
  return connect(response.data.data);
}
async function connect(ticket: { roomCode: string; ticket: string }) {
  const room = await sdk.joinById(ticket.roomCode, { protocol: 2, ticket: ticket.ticket });
  opened.push(room);
  const messages: { type: string; data: unknown }[] = [];
  room.onMessage('*', (type, data) => messages.push({ type: String(type), data }));
  room.onError(() => undefined);
  return {
    room,
    code: ticket.roomCode as string,
    messages,
    latest: <T>(type: string) => messages.filter((message) => message.type === type).at(-1)?.data as T | undefined,
  };
}
async function game() {
  const a = await owner(),
    b = await owner(),
    first = await join(a),
    second = await join(b, first.code);
  first.room.send('ready', { ready: true });
  second.room.send('ready', { ready: true });
  const start = await until(() => first.latest<MatchStartMsg>(S2C.matchStart));
  await until(() => second.latest<MatchStartMsg>(S2C.matchStart));
  return { accounts: [a, b], peers: [first, second], start, code: first.code };
}
function shot(start: MatchStartMsg): ShotMsg {
  return {
    protocol: 2,
    matchId: start.matchId,
    configVersion: start.configVersion,
    revision: start.revision,
    turnId: start.state.shotNo,
    clientShotId: randomUUID(),
    input: {
      pieceId: start.state.pieces.find((piece) => piece.side === start.state.turn)!.id,
      dirX: 1,
      dirY: 0,
      power: 0.2,
      curve: 0,
    },
  };
}
test('the real account room commits its initial snapshot before match_start and its shot receipt before acknowledgement', async () => {
  const playing = await game();
  const read = () =>
    db.query(
      'SELECT c.payload FROM match_recovery_heads h JOIN match_checkpoints c ON c.match_id=h.match_id AND c.ordinal=h.checkpoint WHERE h.match_id=$1',
      [playing.start.matchId],
    );
  expect((await read()).rowCount).toBe(1);
  const initial = (await read()).rows[0].payload;
  expect(initial).toMatchObject({ seq: 0, revision: 0, receipts: [], matchId: playing.start.matchId });
  const input = shot(playing.start),
    actor = playing.peers[playing.start.state.turn];
  actor.room.send('shot', input);
  await until(() => actor.latest<ShotAckMsg>(S2C.shotAck));
  const saved = (await read()).rows[0].payload;
  expect(saved.seq).toBe(1);
  expect(saved.receipts).toHaveLength(1);
  expect(saved.receipts[0].shotId).toBe(input.clientShotId);
  expect(saved.match.rng).not.toBe(0);
  const packet = actor.latest<ShotPacketMsg>(S2C.shotPacket)!;
  expect(packet.state.rng).toBe(0);
  expect(packet.seq).toBe(saved.seq);
});
test('a real checkpoint write failure sends no positive acknowledgement and the original shot succeeds once after storage recovers', async () => {
  const playing = await game(),
    input = shot(playing.start),
    actor = playing.peers[playing.start.state.turn];
  await db.query(`CREATE FUNCTION net05_fail_room_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.match_id='${playing.start.matchId}'::uuid AND NEW.ordinal>0 THEN RAISE EXCEPTION 'fixture checkpoint failure'; END IF; RETURN NEW; END $$`);
  await db.query(
    'CREATE TRIGGER net05_fail_room_checkpoint BEFORE INSERT ON match_checkpoints FOR EACH ROW EXECUTE FUNCTION net05_fail_room_checkpoint()',
  );
  try {
    actor.room.send('shot', input);
    await until(() => actor.latest<ErrorMsg>(S2C.error));
    expect(actor.latest<ShotAckMsg>(S2C.shotAck)).toBeUndefined();
    expect(actor.latest<ShotPacketMsg>(S2C.shotPacket)).toBeUndefined();
    expect(
      (
        await db.query('SELECT seq::text FROM match_checkpoints WHERE match_id=$1 ORDER BY ordinal DESC LIMIT 1', [
          playing.start.matchId,
        ])
      ).rows[0].seq,
    ).toBe('0');
  } finally {
    await db.query('DROP TRIGGER net05_fail_room_checkpoint ON match_checkpoints');
    await db.query('DROP FUNCTION net05_fail_room_checkpoint()');
  }
  actor.room.send('shot', input);
  await until(() => actor.latest<ShotAckMsg>(S2C.shotAck));
  expect(
    (
      await db.query('SELECT seq::text FROM match_checkpoints WHERE match_id=$1 ORDER BY ordinal DESC LIMIT 1', [
        playing.start.matchId,
      ])
    ).rows[0].seq,
  ).toBe('1');
});

test('a fresh server restores the original archived configuration, owned seat and hashed shot receipt', async () => {
  advertisedData = DEFAULT_DATA;
  const playing = await game(),
    input = shot(playing.start),
    side = playing.start.state.turn,
    actor = playing.peers[side];
  actor.room.send('shot', input);
  await until(() => actor.latest<ShotAckMsg>(S2C.shotAck));
  await actor.room.leave();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await join(playing.accounts[side === 0 ? 1 : 0], playing.code);
  await vi.waitFor(
    async () => {
      const value = (
        await db.query(
          'SELECT c.payload FROM match_recovery_heads h JOIN match_checkpoints c ON c.match_id=h.match_id AND c.ordinal=h.checkpoint WHERE h.match_id=$1',
          [playing.start.matchId],
        )
      ).rows[0].payload;
      expect(value.clocks.reconnectMs[side]).toBeLessThan(59000);
    },
    { timeout: 5000, interval: 20 },
  );
  const originalHash = (
    await db.query('SELECT configuration_hash FROM match_settlement_contexts WHERE match_id=$1', [
      playing.start.matchId,
    ])
  ).rows[0].configuration_hash;
  await server.close();
  const saved = (
    await db.query(
      'SELECT c.payload FROM match_recovery_heads h JOIN match_checkpoints c ON c.match_id=h.match_id AND c.ordinal=h.checkpoint WHERE h.match_id=$1',
      [playing.start.matchId],
    )
  ).rows[0].payload;
  await new Promise((resolve) => setTimeout(resolve, 2100));
  // A test-only newly activated package changes its version tag, keeping every physical parameter identical.
  advertisedData = buildGameData({ ...DEFAULT_DATA.physics, version: 'phys-9004' });
  const bootStarted = Date.now();
  await boot();
  const account = playing.accounts[side];
  const active = await jsonRequest(origin, '/api/v1/me/active-match', { headers: account.headers });
  expect(active.status).toBe(200);
  expect(active.data.data.state).toBe('available');
  expect(active.data.data.match).toMatchObject({
    matchId: playing.start.matchId,
    configVersion: playing.start.configVersion,
    side,
  });
  expect(playing.start.configVersion).not.toBe(advertisedData.version);
  expect(active.data.data.match.reconnectMs).toBeLessThanOrEqual(saved.clocks.reconnectMs[side]);
  expect(active.data.data.match.reconnectMs).toBeGreaterThan(
    saved.clocks.reconnectMs[side] - (Date.now() - bootStarted) - 250,
  );
  const reentry = await jsonRequest(origin, `/api/v1/matches/${playing.start.matchId}/reentry`, {
    method: 'POST',
    headers: account.headers,
    body: { protocol: 2 },
  });
  expect(reentry.status).toBe(200);
  const resumed = await connect(reentry.data.data),
    message = await until(() => resumed.latest<ResumeMsg>(S2C.resume));
  expect(message).toMatchObject({
    matchId: playing.start.matchId,
    seq: 1,
    configVersion: playing.start.configVersion,
    protocol: 2,
  });
  expect(message.state.rng).toBe(0);
  expect(message.state.shotNo).toBe(saved.match.shotNo);
  expect(message.state.turn).toBe(saved.match.turn);
  expect(message.clocks.matchMs).toBeGreaterThan(saved.clocks.matchMs - (Date.now() - bootStarted) - 250);
  expect(message.clocks.matchMs).toBeLessThanOrEqual(saved.clocks.matchMs);
  expect(message.clocks.turnMs).toBeGreaterThan(saved.clocks.turnMs - (Date.now() - bootStarted) - 250);
  expect(message.clocks.turnMs).toBeLessThanOrEqual(saved.clocks.turnMs);
  resumed.room.send('shot', input);
  const duplicate = await until(() => resumed.latest<ShotAckMsg>(S2C.shotAck));
  expect(duplicate).toMatchObject({ seq: 1, duplicate: true, clientShotId: input.clientShotId });
  resumed.room.send('shot', { ...input, input: { ...input.input, power: input.input.power + 0.1 } });
  expect((await until(() => resumed.latest<ErrorMsg>(S2C.error))).code).toBe('shot-conflict');
  expect(
    (
      await db.query('SELECT configuration_hash FROM match_settlement_contexts WHERE match_id=$1', [
        playing.start.matchId,
      ])
    ).rows[0].configuration_hash,
  ).toBe(originalHash);
  expect(
    (
      await db.query('SELECT seq::text FROM match_checkpoints WHERE match_id=$1 ORDER BY ordinal DESC LIMIT 1', [
        playing.start.matchId,
      ])
    ).rows[0].seq,
  ).toBe('1');
  advertisedData = DEFAULT_DATA;
});

async function childServer(directory: string) {
  const child = fork(path.resolve('server/index.ts'), {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      APP_ENV: 'test',
      PORT: '0',
      PUBLIC_ORIGIN: issuer,
      SESSION_SIGNING_KEY: key,
      ROOM_STORE_DIR: directory,
      EMAIL_PROVIDER: 'disabled',
      ACCOUNT_DELETION_ENABLED: 'false',
    },
  });
  const exited = once(child, 'exit');
  child.stderr!.on('data', () => undefined);
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Game server startup timeout'));
      }, 20000);
      const failed = () => {
        cleanup();
        reject(new Error('Game server exited before startup'));
      };
      const cleanup = () => {
        clearTimeout(timeout);
        child.off('error', failed);
        child.off('exit', failed);
      };
      child.once('error', failed);
      child.once('exit', failed);
      child.stdout!.on('data', (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-65536);
        for (const line of output.split(/\r?\n/)) {
          try {
            const event = JSON.parse(line);
            if (event.event === 'server_started' && Number.isInteger(event.port) && event.port > 0) {
              cleanup();
              resolve(event.port);
            }
          } catch {
            /* Other server diagnostics are not protocol startup messages. */
          }
        }
      });
    });
    return { child, exited, origin: `http://127.0.0.1:${port}` };
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    throw error;
  }
}
test('killing the actual game server and starting a new PID preserves an acknowledged shot and its original account seat', async () => {
  await server.close();
  const directory = path.join(process.env.PG_TEST_TMP_DIR!, `net05-killed-server-${randomUUID()}`);
  const first = await childServer(directory);
  let second: Awaited<ReturnType<typeof childServer>> | undefined;
  try {
    origin = first.origin;
    sdk = new Client(origin.replace('http:', 'ws:'));
    const playing = await game(),
      input = shot(playing.start),
      side = playing.start.state.turn,
      actor = playing.peers[side];
    actor.room.send('shot', input);
    await until(() => actor.latest<ShotAckMsg>(S2C.shotAck));
    first.child.kill('SIGKILL');
    await first.exited;
    expect(first.child.exitCode !== null || first.child.signalCode !== null).toBe(true);
    second = await childServer(directory);
    expect(second.child.pid).not.toBe(first.child.pid);
    origin = second.origin;
    sdk = new Client(origin.replace('http:', 'ws:'));
    const account = playing.accounts[side],
      deadline = Date.now() + 25000;
    let available = false;
    while (Date.now() < deadline) {
      const active = await jsonRequest(origin, '/api/v1/me/active-match', { headers: account.headers });
      if (active.status === 200 && active.data.data.state === 'available') {
        available = true;
        expect(active.data.data.match.matchId).toBe(playing.start.matchId);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(available).toBe(true);
    const response = await jsonRequest(origin, `/api/v1/matches/${playing.start.matchId}/reentry`, {
      method: 'POST',
      headers: account.headers,
      body: { protocol: 2 },
    });
    expect(response.status).toBe(200);
    const resumed = await connect(response.data.data),
      message = await until(() => resumed.latest<ResumeMsg>(S2C.resume));
    expect(message).toMatchObject({
      matchId: playing.start.matchId,
      seq: 1,
      configVersion: playing.start.configVersion,
      protocol: 2,
    });
    resumed.room.send('shot', input);
    expect(await until(() => resumed.latest<ShotAckMsg>(S2C.shotAck))).toMatchObject({ duplicate: true, seq: 1 });
    expect(
      (
        await db.query('SELECT seq::text FROM match_checkpoints WHERE match_id=$1 ORDER BY ordinal DESC LIMIT 1', [
          playing.start.matchId,
        ])
      ).rows[0].seq,
    ).toBe('1');
  } finally {
    for (const process of [first, second])
      if (process) {
        if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill('SIGKILL');
        await process.exited;
      }
  }
}, 60000);

test('a killed server with only a durable fenced terminal file imports that result before reopening any old playing snapshot', async () => {
  await server.close();
  const directory = path.join(process.env.PG_TEST_TMP_DIR!, `net05-terminal-killed-server-${randomUUID()}`);
  const first = await childServer(directory);
  let second: Awaited<ReturnType<typeof childServer>> | undefined,
    release: (() => void) | undefined,
    holding: Promise<void> | undefined;
  try {
    origin = first.origin;
    sdk = new Client(origin.replace('http:', 'ws:'));
    const playing = await game(),
      input = shot(playing.start),
      actor = playing.peers[playing.start.state.turn];
    actor.room.send('shot', input);
    await until(() => actor.latest<ShotAckMsg>(S2C.shotAck));
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
        locked = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    holding = db.transaction(async (tx) => {
      await tx.query('SELECT 1 FROM match_recovery_heads WHERE match_id=$1 FOR UPDATE', [playing.start.matchId]);
      locked();
      await gate;
    });
    await ready;
    playing.peers[0].room.send('surrender', {
      protocol: 2,
      matchId: playing.start.matchId,
      configVersion: playing.start.configVersion,
    });
    const journal = new RecoveryJournal(path.join(directory, 'pending-outcomes', 'account-recovery'));
    const deadline = Date.now() + 5000;
    let candidate = await journal.peek(playing.start.matchId);
    while (!candidate && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      candidate = await journal.peek(playing.start.matchId);
    }
    expect(candidate).not.toBeNull();
    expect(playing.peers[0].latest(S2C.update)).toBeUndefined();
    first.child.kill('SIGKILL');
    await first.exited;
    release!();
    await holding;
    expect((await db.query('SELECT * FROM match_outcomes WHERE match_id=$1', [playing.start.matchId])).rowCount).toBe(
      0,
    );
    expect(existsSync(path.join(directory, 'pending-outcomes', `${playing.start.matchId}.json`))).toBe(false);
    second = await childServer(directory);
    origin = second.origin;
    sdk = new Client(origin.replace('http:', 'ws:'));
    const untilRecovered = Date.now() + 25000;
    let result: unknown;
    while (Date.now() < untilRecovered) {
      const response = await jsonRequest(origin, `/api/v1/matches/${playing.start.matchId}/result`, {
        headers: playing.accounts[0].headers,
      });
      if (response.status === 200) {
        result = response.data.data;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(result).toMatchObject({
      matchId: playing.start.matchId,
      reason: 'surrender',
      finalSeq: 1,
      winner: candidate!.record.terminal!.winner,
    });
    expect(
      (await db.query('SELECT payload FROM match_outcomes WHERE match_id=$1', [playing.start.matchId])).rows[0].payload,
    ).toEqual(candidate!.record.terminal);
    expect(
      (
        await jsonRequest(origin, `/api/v1/matches/${playing.start.matchId}/reentry`, {
          method: 'POST',
          headers: playing.accounts[0].headers,
          body: { protocol: 2 },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await db.query(
          'SELECT event,seq::text FROM match_checkpoints WHERE match_id=$1 AND ordinal>$2 ORDER BY ordinal',
          [playing.start.matchId, candidate!.base.checkpoint],
        )
      ).rows,
    ).toEqual([{ event: 'terminal', seq: '1' }]);
  } finally {
    release?.();
    await holding?.catch(() => undefined);
    for (const instance of [first, second])
      if (instance) {
        if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill('SIGKILL');
        await instance.exited;
      }
  }
}, 60000);
