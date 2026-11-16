/**
 * End-to-end check of the online path: two real clients, one room code, a real shot, then a disconnect and a
 * re-claim of the seat. This is the "can two people actually play" test, over a real WebSocket.
 *
 * Run with: npx tsx tools/online-e2e.ts
 */
import { Client } from 'colyseus.js';
import { DEFAULT_DATA } from '../shared/data';
import { PROTOCOL_VERSION, ROOM_NAME, S2C, type MatchStartMsg, type RoomSnapshot, type ShotPacketMsg } from '../shared/protocol';

const URL = process.env.TEST_URL ?? 'ws://127.0.0.1:2567';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => T | undefined, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v !== undefined && v !== false) return v;
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await wait(25);
  }
}

interface Seat {
  room?: Awaited<ReturnType<Client['joinOrCreate']>>;
  nickname: string;
  snapshot?: RoomSnapshot;
  start?: MatchStartMsg;
  shots: ShotPacketMsg[];
  errors: string[];
}

async function main(): Promise<void> {
  console.log(`[online-e2e] server ${URL}\n`);

  const a: Seat = { nickname: 'Alice', shots: [], errors: [] };
  const b: Seat = { nickname: 'Bob', shots: [], errors: [] };

  console.log('[room]');
  const clientA = new Client(URL);
  a.room = await clientA.create(ROOM_NAME, { protocol: PROTOCOL_VERSION, nickname: a.nickname });
  // The handlers must be attached as soon as the room object exists: the server's first snapshot is queued
  // until the client acknowledges the join, and is dropped if nobody is listening yet.
  a.room.onMessage(S2C.room, (m: RoomSnapshot) => (a.snapshot = m));
  a.room.onMessage(S2C.matchStart, (m: MatchStartMsg) => (a.start = m));
  a.room!.onMessage(S2C.shotPacket, (m: ShotPacketMsg) => a.shots.push(m));
  a.room!.onMessage(S2C.error, (m: { code: string }) => (a.errors.push(m.code)));
  const code = a.room.roomId ?? '';
  check('the server assigns a 6-character room code', /^[A-Z0-9]{6}$/.test(code), code);

  const clientB = new Client(URL);
  b.room = await clientB.joinById(code, { protocol: PROTOCOL_VERSION, nickname: b.nickname });
  b.room.onMessage(S2C.room, (m: RoomSnapshot) => (b.snapshot = m));
  b.room.onMessage(S2C.matchStart, (m: MatchStartMsg) => (b.start = m));
  b.room!.onMessage(S2C.shotPacket, (m: ShotPacketMsg) => b.shots.push(m));
  b.room!.onMessage(S2C.error, (m: { code: string }) => (b.errors.push(m.code)));

  await until(() => a.snapshot && b.snapshot);
  check('both clients see the room snapshot', !!a.snapshot && !!b.snapshot);
  check('the snapshot carries the room code', a.snapshot?.code === code, String(a.snapshot?.code));
  check('each seat gets its own secret seat token', !!a.snapshot?.seatToken && !!b.snapshot?.seatToken);
  check('the two seat tokens differ', a.snapshot?.seatToken !== b.snapshot?.seatToken);
  check('both seats are taken', a.snapshot?.seats[0]?.nickname === a.nickname && a.snapshot?.seats[1]?.nickname === b.nickname);

  console.log('\n[match]');
  a.room!.send('ready', { ready: true });
  b.room!.send('ready', { ready: true });
  await until(() => a.start && b.start);
  check('both clients get the match_start', !!a.start && !!b.start);
  check('the match start carries the clock', typeof a.start?.clocks?.matchMs === 'number' && typeof a.start?.clocks?.turnMs === 'number');
  check('the seed never leaves the server', a.start?.state.rng === 0);

  console.log('\n[shot]');
  const st = a.start!.state;
  const shooter = st.turn;
  const shooterSeat = shooter === 0 ? a : b;
  const otherSeat = shooter === 0 ? b : a;
  const piece = st.pieces.find((p) => p.side === shooter)!;
  shooterSeat.room!.send('shot', {
    matchId: a.start!.matchId,
    turnId: st.shotNo,
    clientShotId: 'e2e-shot-1',
    configVersion: DEFAULT_DATA.version,
    input: { pieceId: piece.id, dirX: 0.2, dirY: 0, power: 0.6, curve: 0 },
  });
  await until(() => (a.shots.length > 0 && b.shots.length > 0 ? true : undefined), 6000).catch(() => undefined);
  check('the shot reaches both seats', a.shots.length === 1 && b.shots.length === 1, `a=${a.shots.length} b=${b.shots.length} errors=${JSON.stringify([...a.errors, ...b.errors])}`);
  check('the two seats see byte-identical packets', JSON.stringify(a.shots[0]) === JSON.stringify(b.shots[0]));
  check('the packet carries frames', a.shots[0].frames.length > 0);
  check('the packet advances the shot number', a.shots[0].state.shotNo === st.shotNo + 1);
  check('the packet carries the clock', typeof a.shots[0].clocks.turnMs === 'number');

  console.log('\n[reconnect]');
  const token = (shooter === 0 ? a.snapshot : b.snapshot)?.seatToken;
  check('the disconnected seat had a token', !!token);
  // Drop the socket the hard way: the server must keep the seat for the reconnect window.
  const victim = shooter === 0 ? a : b;
  const victimRoom = victim.room;
  (victimRoom as unknown as { connection?: { close?: () => void } }).connection?.close?.();
  await wait(300);

  const clientC = new Client(URL);
  const back = await clientC.joinById(code, {
    protocol: PROTOCOL_VERSION,
    nickname: victim.nickname,
    seatToken: token,
  });
  let resumed = false;
  back.onMessage(S2C.resume, () => (resumed = true));
  await until(() => resumed, 6000).catch(() => undefined);
  check('the seat can be re-claimed with the token', resumed);

  console.log('\n[summary]');
  check('no failure in this run', failures === 0);
  a.room?.leave(true);
  b.room?.leave(true);
  back.leave(true);
  console.log(`\nonline-e2e: ${failures === 0 ? 'PASS' : 'FAIL'} (${failures} failure(s))`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('[online-e2e] crashed:', err);
  process.exit(1);
});
