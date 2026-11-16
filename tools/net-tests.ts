// Real-network tests: in-process Colyseus server on a real TCP port (NET_TEST_PORT, default 2567), real colyseus.js clients.
import { createServer, type AddressInfo } from 'node:net';
import { matchMaker } from 'colyseus';
import { Client, type Room } from 'colyseus.js';
import { createGameServer } from '../server/app';
import type { MatchRoom } from '../server/rooms/MatchRoom';
import { chooseShot } from '../shared/ai';
import { DEFAULT_DATA } from '../shared/data';
import type { MatchEvent, MatchState, ShotInput } from '../shared/match';
import type { Side } from '../shared/physics';
import {
  C2S,
  NET_ERROR_CODES,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_NAME,
  S2C,
  type ErrorMsg,
  type MatchStartMsg,
  type RoomSnapshot,
  type ShotPacketMsg,
} from '../shared/protocol';
import { makeRng } from '../shared/rng';

type Loose = Record<string, unknown>;
interface Shot {
  [key: string]: unknown;
  clientShotId: string;
  turnId: number;
  input: Loose;
}
interface Msg {
  type: string;
  body: unknown;
}
interface Rng {
  next(): number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(pred: () => boolean, ms = 3000): Promise<boolean> {
  const end = performance.now() + ms;
  while (!pred()) {
    if (performance.now() > end) return false;
    await sleep(4);
  }
  return true;
}

let passed = 0;
let failed = 0;
const seenCodes = new Set<string>();
const uncaught: string[] = [];
process.on('uncaughtException', (err) => {
  uncaught.push(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
});

function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) passed++;
  else failed++;
  const text = detail === undefined ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || text === '' ? '' : `  -> ${text.slice(0, 240)}`}`);
}

async function group(title: string, body: () => Promise<void>): Promise<void> {
  const only = process.env.NET_TEST_ONLY;
  if (only && !only.split(',').includes(title)) return;
  console.log(`\n[${title}]`);
  try {
    await body();
  } catch (err) {
    check(`${title}: no exception`, false, err instanceof Error ? (err.stack ?? err.message) : String(err));
  }
}

let url = '';
let httpBase = '';

async function healthy(): Promise<boolean> {
  try {
    return (await fetch(`${httpBase}/healthz`)).status === 200;
  } catch {
    return false;
  }
}

function noteCodes(text: string): void {
  for (const code of NET_ERROR_CODES) if (text.includes(code)) seenCodes.add(code);
}

class Conn {
  readonly log: Msg[] = [];
  closed: { code: number; reason: string } | null = null;
  private sent: number[] = [];

  // Handlers are attached synchronously after the join await: the server's first `room` snapshot is queued until the client acks.
  private constructor(readonly room: Room) {
    room.onMessage('*', (type, body) => {
      this.log.push({ type: String(type), body });
      if (type === S2C.error) seenCodes.add((body as ErrorMsg).code);
    });
    room.onLeave((code, reason) => {
      this.closed = { code, reason: reason ?? '' };
    });
    room.onError(() => undefined);
  }

  static async create(nickname: string, extra: Loose = {}): Promise<Conn> {
    return new Conn(await new Client(url).create(ROOM_NAME, { protocol: PROTOCOL_VERSION, nickname, ...extra }));
  }

  static async join(code: string, nickname: string, extra: Loose = {}): Promise<Conn> {
    return new Conn(await new Client(url).joinById(code, { protocol: PROTOCOL_VERSION, nickname, ...extra }));
  }

  of<T>(type: string, from = 0): T[] {
    return this.log.slice(from).filter((m) => m.type === type).map((m) => m.body as T);
  }
  get snap(): RoomSnapshot | null {
    return this.of<RoomSnapshot>(S2C.room).at(-1) ?? null;
  }
  get start(): MatchStartMsg | null {
    return this.of<MatchStartMsg>(S2C.matchStart)[0] ?? null;
  }
  get packets(): ShotPacketMsg[] {
    return this.of<ShotPacketMsg>(S2C.shotPacket);
  }
  get state(): MatchState | null {
    return this.packets.at(-1)?.state ?? this.start?.state ?? null;
  }
  mark(): number {
    return this.log.length;
  }

  /** Paced below the server's 30 msg/s limit (sliding window), so validation tests never trip the rate limiter by accident. */
  async send(type: string | number, body?: unknown): Promise<void> {
    if (this.sent.length >= 24) {
      const wait = this.sent[this.sent.length - 24] + 1100 - performance.now();
      if (wait > 0) await sleep(wait);
      if (this.sent.length > 100) this.sent.splice(0, this.sent.length - 30);
    }
    this.sent.push(performance.now());
    this.room.send(type, body);
  }

  async nextError(from: number, ms = 1500): Promise<ErrorMsg | null> {
    await until(() => this.log.slice(from).some((m) => m.type === S2C.error), ms);
    return this.of<ErrorMsg>(S2C.error, from)[0] ?? null;
  }

  async leave(consented = true): Promise<void> {
    if (this.closed === null) await Promise.race([this.room.leave(consented), sleep(1000)]);
  }
}

const closeAll = async (...conns: Conn[]): Promise<void> => {
  await Promise.all(conns.map((c) => c.leave()));
};

const live = (code: string): MatchRoom => matchMaker.getLocalRoomById(code) as unknown as MatchRoom;
const inspected = (code: string): string => JSON.stringify(live(code).inspect());
/** White-box handle on the authoritative state, used only to set up situations that cannot be reached quickly over the wire. */
const internals = (code: string): { match: MatchState | null } => live(code) as unknown as { match: MatchState | null };
/** Same idea for conditions the wire cannot produce: a connected client with no seat, and a handler that throws. */
const rawRoom = (code: string): { seats: unknown[]; [key: string]: unknown } => live(code) as unknown as { seats: unknown[]; [key: string]: unknown };

/** Runs `body` with console.error captured: the server logs faults it is meant to survive, and they would bury the PASS/FAIL lines. */
async function captureErrors<T>(body: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(' ').split('\n')[0]);
  };
  try {
    const value = await body();
    await sleep(60);
    return { value, lines };
  } finally {
    console.error = original;
  }
}

async function rejected(attempt: Promise<Conn>): Promise<string | null> {
  try {
    await (await attempt).leave();
    return null;
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    noteCodes(text);
    return text;
  }
}

async function openLobby(): Promise<{ a: Conn; b: Conn; code: string }> {
  const a = await Conn.create('Alice');
  const code = a.room.roomId;
  const b = await Conn.join(code, 'Bob');
  await until(() => a.snap?.seats[1] != null && b.snap?.seats[0] != null);
  return { a, b, code };
}

async function startMatch(a: Conn, b: Conn): Promise<void> {
  await a.send(C2S.ready, { ready: true });
  await b.send(C2S.ready, { ready: true });
  await until(() => a.start !== null && b.start !== null);
}

let shotCounter = 0;
const freshId = (): string => `net-${++shotCounter}`;

function aimedShot(st: MatchState, side: Side, rng: Rng): ShotInput {
  const mine = st.pieces.filter((p) => p.side === side && p.out === 0 && p.frozen === 0);
  if (mine.length === 0) throw new Error(`side ${side} has no movable piece at shotNo ${st.shotNo}`);
  const p = mine[Math.floor(rng.next() * mine.length)];
  const angle = Math.atan2(st.ball.y - p.y, st.ball.x - p.x) + (rng.next() - 0.5) * 0.6;
  return { pieceId: p.id, dirX: Math.cos(angle), dirY: Math.sin(angle), power: 0.4 + rng.next() * 0.6, curve: rng.next() - 0.5 };
}

function shotBody(c: Conn, side: Side, rng: Rng, patch: Loose = {}, input: Loose = {}): Shot {
  const st = c.state!;
  return {
    matchId: c.start!.matchId,
    turnId: st.shotNo,
    clientShotId: freshId(),
    configVersion: DEFAULT_DATA.version,
    ...patch,
    input: { ...aimedShot(st, side, rng), ...input },
  };
}

async function expectErr(c: Conn, label: string, type: string, payload: unknown, code: string, opt: { ref?: string; on?: string | null } = {}): Promise<void> {
  const from = c.mark();
  await c.send(type, payload);
  const e = await c.nextError(from);
  const on = opt.on === undefined ? type : opt.on;
  const ok = e?.code === code && (on === null ? e.on === undefined : e.on === on) && (opt.ref === undefined || e.ref === opt.ref);
  check(`${label} -> ${code}`, ok, e ?? 'no error reply');
}

/** Plays legal shots for whichever side is acting until `done()`: `pick` chooses the shot, otherwise a random aimed one. Resolves once both clients have every packet. */
async function playUntil(a: Conn, b: Conn, rng: Rng, done: () => boolean, limit = 160, pick?: (st: MatchState, side: Side) => ShotInput | null): Promise<number> {
  let n = a.packets.length;
  while (!done() && n < limit) {
    const st = a.state!;
    const shooter = st.turn === 0 ? a : b;
    const picked = pick?.(st, st.turn);
    await shooter.send(C2S.shot, shotBody(shooter, st.turn, rng, {}, picked ? { ...picked } : {}));
    n++;
    if (!(await until(() => a.packets.length >= n && b.packets.length >= n, 5000))) throw new Error(`packet ${n} never reached both clients`);
  }
  return n;
}

const endEvents = (c: Conn): MatchEvent[] =>
  c.packets.flatMap((p) => [...p.events, ...p.turnEvents]).filter((e) => e.type === 'end');

async function testLobby(): Promise<void> {
  const a = await Conn.create('Alice');
  const code = a.room.roomId;
  check('room id is a 6-char code from the allowed alphabet', code.length === ROOM_CODE_LENGTH && [...code].every((ch) => ROOM_CODE_ALPHABET.includes(ch)), code);
  await until(() => a.snap !== null);
  const s0 = a.snap;
  check(
    'creator gets a lobby snapshot for seat 0 (code, protocol, configVersion)',
    s0?.mySeat === 0 && s0.phase === 'lobby' && s0.code === code && s0.protocol === PROTOCOL_VERSION && s0.configVersion === DEFAULT_DATA.version && s0.seats[0]?.nickname === 'Alice' && s0.seats[1] === null,
    s0,
  );
  const b = await Conn.join(code, 'Bob');
  await until(() => a.snap?.seats[1] != null && b.snap?.seats[0] != null);
  check('guest takes seat 1 and both sides see both nicknames', b.snap?.mySeat === 1 && a.snap?.seats[1]?.nickname === 'Bob' && b.snap?.seats[0]?.nickname === 'Alice', [a.snap, b.snap]);

  const third = await rejected(Conn.join(code, 'Cara'));
  check('third client is refused on a full lobby', third !== null, 'join succeeded');

  const bad: Array<[string, string]> = [
    ['well-formed but nonexistent code', 'ZZZZZZ'],
    ['lowercase code', code.toLowerCase()],
    ['empty code', ''],
    ['too short', 'ABC'],
    ['500 chars', 'A'.repeat(500)],
    ['path traversal', '../../etc/passwd'],
    ['emoji', '😀😀😀😀😀😀'],
    ['whitespace', '      '],
  ];
  for (const [label, badCode] of bad) {
    const err = await rejected(Conn.join(badCode === code.toLowerCase() && code === code.toLowerCase() ? 'zzzzzz' : badCode, 'Eve'));
    check(`invalid room code (${label}) is refused`, err !== null, 'join succeeded');
  }

  const options: Array<[string, Promise<Conn>]> = [
    ['protocol mismatch', Conn.create('Mallory', { protocol: PROTOCOL_VERSION + 1 })],
    ['no protocol', Conn.create('Mallory', { protocol: undefined })],
    ['empty nickname', Conn.create('')],
    ['over-long nickname', Conn.create('x'.repeat(17))],
    ['control char in nickname', Conn.create('badname')],
    ['non-string nickname', Conn.create(42 as unknown as string)],
    ['unknown skin', Conn.create('Mallory', { skin: 'no-such-skin' })],
  ];
  for (const [label, attempt] of options) {
    const err = await rejected(attempt);
    check(`create with ${label} is refused`, err !== null, 'create succeeded');
  }
  const joinBad = await rejected(Conn.join(code, 'Eve', { protocol: 0 }));
  check('join with a protocol mismatch is refused', joinBad !== null, 'join succeeded');
  check('refused joins and creates left the lobby untouched', a.snap?.seats[0]?.nickname === 'Alice' && a.snap.seats[1]?.nickname === 'Bob' && a.closed === null && b.closed === null, a.snap);

  const rooms = await Promise.all(Array.from({ length: 30 }, (_, i) => Conn.create(`P${i}`)));
  const codes = new Set(rooms.map((r) => r.room.roomId));
  check('30 concurrent rooms get 30 distinct well-formed codes', codes.size === 30 && [...codes].every((c) => c.length === ROOM_CODE_LENGTH), codes.size);
  await closeAll(...rooms, a, b);
  check('rooms are disposed once everybody has left', await until(() => matchMaker.getLocalRoomById(code) === undefined && matchMaker.getLocalRoomById(rooms[0].room.roomId) === undefined));
}

async function testLineupAndReady(): Promise<void> {
  const { a, b, code } = await openLobby();
  const ids = Object.keys(DEFAULT_DATA.players);
  const five = ids.slice(0, 5);
  await expectErr(a, 'lineup with 4 players', C2S.setLineup, { lineup: five.slice(0, 4) }, 'bad-lineup');
  await expectErr(a, 'lineup with a duplicate player', C2S.setLineup, { lineup: [five[0], five[0], five[2], five[3], five[4]] }, 'bad-lineup');
  await expectErr(a, 'lineup with an unknown player id', C2S.setLineup, { lineup: [...five.slice(0, 4), 'nobody'] }, 'bad-lineup');
  await expectErr(a, 'lineup with a prototype-chain id', C2S.setLineup, { lineup: [...five.slice(0, 4), 'constructor'] }, 'bad-lineup');
  await expectErr(a, 'lineup that is not an array', C2S.setLineup, { lineup: 'p01' }, 'bad-lineup');
  await expectErr(a, 'level 0', C2S.setLineup, { lineup: five, levels: [0, 5, 5, 5, 5] }, 'bad-level');
  await expectErr(a, 'level above the maximum', C2S.setLineup, { lineup: five, levels: [5, 5, 5, 5, DEFAULT_DATA.rules.levels.max + 1] }, 'bad-level');
  await expectErr(a, 'fractional level', C2S.setLineup, { lineup: five, levels: [5, 5, 5.5, 5, 5] }, 'bad-level');
  await expectErr(a, 'wrong number of levels', C2S.setLineup, { lineup: five, levels: [5, 5] }, 'bad-level');
  await expectErr(a, 'set_lineup with an extra key', C2S.setLineup, { lineup: five, admin: true }, 'bad-message');
  await expectErr(a, 'ready that is not a boolean', C2S.ready, { ready: 'yes' }, 'bad-message');
  await expectErr(a, 'ready with an extra key', C2S.ready, { ready: true, force: true }, 'bad-message');
  await expectErr(
    a,
    'shot while still in the lobby',
    C2S.shot,
    { matchId: 'none', turnId: 0, clientShotId: 'early-1', configVersion: DEFAULT_DATA.version, input: { pieceId: 'x', dirX: 1, dirY: 0, power: 0.5, curve: 0 } },
    'match-not-started',
    { ref: 'early-1' },
  );

  const levels = [3, 4, 5, 6, 7];
  await a.send(C2S.setLineup, { lineup: five, levels });
  await until(() => JSON.stringify(b.snap?.seats[0]?.lineup) === JSON.stringify(five));
  check('valid set_lineup is broadcast to both seats with the new levels', JSON.stringify(a.snap?.seats[0]?.levels) === JSON.stringify(levels) && JSON.stringify(b.snap?.seats[0]?.lineup) === JSON.stringify(five), b.snap);

  await a.send(C2S.ready, { ready: true });
  await until(() => b.snap?.seats[0]?.ready === true);
  await sleep(150);
  check('one ready seat does not start the match', b.snap?.phase === 'lobby' && b.start === null && live(code).inspect().phase === 'lobby');
  await a.send(C2S.setLineup, { lineup: five, levels });
  await until(() => a.snap?.seats[0]?.ready === false);
  check('changing the lineup cancels that seat\'s ready flag', a.snap?.seats[0]?.ready === false, a.snap);
  await a.send(C2S.ready, { ready: true });
  await b.send(C2S.ready, { ready: true });
  await until(() => a.start !== null && b.start !== null);
  check('both seats ready -> both get exactly one match_start', a.of(S2C.matchStart).length === 1 && b.of(S2C.matchStart).length === 1, [a.of(S2C.matchStart).length, b.of(S2C.matchStart).length]);
  const sa = a.start;
  const sb = b.start;
  check('match_start is identical on both seats and carries the lineups', !!sa && JSON.stringify(sa) === JSON.stringify(sb) && JSON.stringify(sa.lineups[0]) === JSON.stringify(five) && sa.configVersion === DEFAULT_DATA.version);
  check('match_start state is fresh: 10 pieces, shotNo 0, rng not leaked', !!sa && sa.state.pieces.length === 10 && sa.state.shotNo === 0 && sa.state.rng === 0 && !sa.state.over);
  check('the seed never appears on the wire', !JSON.stringify([...a.log, ...b.log]).includes('seed'));
  check('server and both snapshots agree the match is playing', live(code).inspect().phase === 'playing' && a.snap?.phase === 'playing' && b.snap?.phase === 'playing');
  await expectErr(a, 'set_lineup after the start', C2S.setLineup, { lineup: five }, 'match-already-started');
  await expectErr(b, 'ready after the start', C2S.ready, { ready: false }, 'match-already-started');
  const late = await rejected(Conn.join(code, 'Late'));
  check('the room is locked once the match started', late !== null, 'join succeeded');
  await closeAll(a, b);
}

async function testShotChain(): Promise<void> {
  const { a, b, code } = await openLobby();
  await startMatch(a, b);
  const rng = makeRng(20261115);
  const st0 = a.state!;
  const side = st0.turn;
  const other = (1 - side) as Side;
  const actor = side === 0 ? a : b;
  const waiter = side === 0 ? b : a;
  const minPower = DEFAULT_DATA.physics.shot.minPower;
  const mk = (patch: Loose = {}, input: Loose = {}): Shot => shotBody(actor, side, rng, patch, input);
  const baseline = inspected(code);
  const packetsBefore = a.packets.length + b.packets.length;

  const oppPiece = st0.pieces.find((p) => p.side === other)!;
  const waiterShot = shotBody(waiter, other, rng);
  await expectErr(waiter, 'non-acting side shoots', C2S.shot, waiterShot, 'not-your-turn', { ref: waiterShot.clientShotId });
  const waiterNaN = shotBody(waiter, other, rng, {}, { dirX: NaN });
  await expectErr(waiter, 'non-acting side shoots with NaN (turn check beats number check)', C2S.shot, waiterNaN, 'not-your-turn', { ref: waiterNaN.clientShotId });

  const semantic: Array<[string, Shot, string]> = [
    ['wrong matchId', mk({ matchId: 'not-the-match' }), 'stale-match'],
    ['wrong configVersion', mk({ configVersion: 'field-0/phys-0/players-0/skills-0/rules-0' }), 'config-mismatch'],
    ['empty configVersion', mk({ configVersion: '' }), 'config-mismatch'],
    ['wrong matchId and wrong configVersion (matchId is checked first)', mk({ matchId: 'nope', configVersion: 'x' }), 'stale-match'],
    ['wrong configVersion and NaN (config is checked first)', mk({ configVersion: 'x' }, { power: NaN }), 'config-mismatch'],
    ['turnId ahead of the server', mk({ turnId: st0.shotNo + 1 }), 'stale-turn'],
    ['turnId far ahead of the server', mk({ turnId: st0.shotNo + 1000 }), 'stale-turn'],
    ['NaN dirX', mk({}, { dirX: NaN }), 'bad-number'],
    ['NaN dirY', mk({}, { dirY: NaN }), 'bad-number'],
    ['Infinity dirX', mk({}, { dirX: Infinity }), 'bad-number'],
    ['-Infinity dirY', mk({}, { dirY: -Infinity }), 'bad-number'],
    ['NaN power', mk({}, { power: NaN }), 'bad-number'],
    ['Infinity power', mk({}, { power: Infinity }), 'bad-number'],
    ['-Infinity power', mk({}, { power: -Infinity }), 'bad-number'],
    ['NaN curve', mk({}, { curve: NaN }), 'bad-number'],
    ['Infinity curve', mk({}, { curve: Infinity }), 'bad-number'],
    ['zero direction', mk({}, { dirX: 0, dirY: 0 }), 'bad-direction'],
    ['power 0', mk({}, { power: 0 }), 'bad-power'],
    ['power below minPower', mk({}, { power: minPower / 2 }), 'bad-power'],
    ['negative power', mk({}, { power: -0.5 }), 'bad-power'],
    ['power above 1', mk({}, { power: 1.0001 }), 'bad-power'],
    ['curve above 1', mk({}, { curve: 1.5 }), 'bad-curve'],
    ['curve below -1', mk({}, { curve: -1.5 }), 'bad-curve'],
    ['unknown piece id', mk({}, { pieceId: 'ghost' }), 'no-such-piece'],
    ['opponent piece', mk({}, { pieceId: oppPiece.id }), 'not-your-piece'],
  ];
  for (const [label, msg, code2] of semantic) await expectErr(actor, label, C2S.shot, msg, code2, { ref: msg.clientShotId });

  const victim = internals(code).match!.pieces.find((p) => p.side === side)!;
  const out0 = victim.out;
  const frozen0 = victim.frozen;
  victim.out = 2;
  const offPitch = mk({}, { pieceId: victim.id });
  await expectErr(actor, 'piece that is off the pitch (white-box setup)', C2S.shot, offPitch, 'piece-off-pitch', { ref: offPitch.clientShotId });
  victim.out = out0;
  victim.frozen = 1;
  const frozen = mk({}, { pieceId: victim.id });
  await expectErr(actor, 'frozen piece (white-box setup)', C2S.shot, frozen, 'piece-frozen', { ref: frozen.clientShotId });
  victim.frozen = frozen0;

  const { clientShotId: _drop, ...noId } = mk();
  const { input: _noInput, ...noInput } = mk();
  const shapes: Array<[string, unknown]> = [
    ['shot without clientShotId', noId],
    ['shot without input', noInput],
    ['shot with an extra top-level key', { ...mk(), admin: true }],
    ['shot with an extra input key', mk({}, { extra: 1 })],
    ['clientShotId containing a space', mk({ clientShotId: 'a b' })],
    ['65-char clientShotId', mk({ clientShotId: 'x'.repeat(65) })],
    ['turnId as a string', mk({ turnId: '0' })],
    ['negative turnId', mk({ turnId: -1 })],
    ['fractional turnId', mk({ turnId: 0.5 })],
    ['power as a string', mk({}, { power: '0.5' })],
    ['pieceId as a number', mk({}, { pieceId: 7 })],
    ['null payload', null],
    ['array payload', []],
    ['numeric payload', 42],
    ['string payload', 'shot'],
  ];
  for (const [label, payload] of shapes) await expectErr(actor, label, C2S.shot, payload, 'bad-message');

  check('every rejected shot left the authoritative state untouched', inspected(code) === baseline);
  check('no shot_packet was broadcast for any rejected shot', a.packets.length + b.packets.length === packetsBefore, [a.packets.length, b.packets.length]);

  const good = mk();
  await actor.send(C2S.shot, good);
  await until(() => a.packets.length === 1 && b.packets.length === 1);
  const pa = a.packets[0];
  const pb = b.packets[0];
  check('accepted shot reaches both seats as exactly one packet (seq 1, id echoed, seat set)', !!pa && !!pb && pa.seq === 1 && pa.clientShotId === good.clientShotId && pa.seat === side && pa.matchId === a.start!.matchId, pa && { seq: pa.seq, id: pa.clientShotId, seat: pa.seat });
  check('both seats received byte-identical packets', JSON.stringify(pa) === JSON.stringify(pb));
  check('packet carries frames; wire state has shotNo advanced and rng zeroed', pa.frames.length > 0 && pa.state.shotNo > 0 && pa.state.rng === 0, { frames: pa.frames.length, shotNo: pa.state.shotNo, rng: pa.state.rng });
  const srv = live(code).inspect();
  check('server state equals the broadcast state (rng aside); one shot recorded', srv.seq === 1 && srv.acceptedShots === 1 && JSON.stringify({ ...srv.match, rng: 0 }) === JSON.stringify(pa.state));

  const settled = inspected(code);
  const from = actor.mark();
  await actor.send(C2S.shot, good);
  const dup = await actor.nextError(from);
  check('replayed clientShotId -> duplicate-shot with ref and the original seq (dedupe beats stale turnId)', dup?.code === 'duplicate-shot' && dup.ref === good.clientShotId && dup.seq === 1 && dup.on === C2S.shot, dup ?? 'no reply');
  const changed = { ...good, input: { ...(good.input as Loose), power: 1 } };
  await expectErr(actor, 'replay of the same id with a different input', C2S.shot, changed, 'duplicate-shot', { ref: good.clientShotId });
  await expectErr(actor, 'replay of the same id with a changed turnId', C2S.shot, { ...good, turnId: a.state!.shotNo }, 'duplicate-shot', { ref: good.clientShotId });
  check('replays changed neither the state nor the packet count', inspected(code) === settled && a.packets.length === 1 && b.packets.length === 1);

  const bump = await playUntil(a, b, rng, () => a.state!.turn !== side, 12);
  check('turn passes to the other seat within a few shots', a.state!.turn === other, { shots: bump, turn: a.state!.turn });
  if (a.state!.turn === other) {
    const reuse = shotBody(waiter, other, rng, { clientShotId: good.clientShotId });
    const n = a.packets.length;
    await waiter.send(C2S.shot, reuse);
    await until(() => a.packets.length > n && b.packets.length > n);
    check('dedupe is scoped per seat: the other seat may reuse the same clientShotId', a.packets.length === n + 1 && a.packets.at(-1)?.seat === other && a.packets.at(-1)?.clientShotId === good.clientShotId, a.of(S2C.error));
  }
  const seqs = a.packets.map((p) => p.seq);
  check('packet seq is contiguous from 1 on both seats', seqs.every((s, i) => s === i + 1) && JSON.stringify(a.packets.map((p) => p.seq)) === JSON.stringify(b.packets.map((p) => p.seq)), seqs);
  check('server seq and accepted-shot count match the packet count', live(code).inspect().seq === a.packets.length && live(code).inspect().acceptedShots === a.packets.length);
  await closeAll(a, b);
}

async function testDisconnect(): Promise<void> {
  {
    const { a, b, code } = await openLobby();
    await a.send(C2S.ready, { ready: true });
    await until(() => a.snap?.seats[0]?.ready === true);
    await b.leave(false);
    await until(() => a.snap?.seats[1] === null);
    check('lobby: dropping the guest frees seat 1 and clears the ready flags', a.snap?.seats[1] === null && a.snap.seats[0]?.ready === false, a.snap);
    const c = await Conn.join(code, 'Cara');
    await until(() => c.snap?.mySeat === 1);
    check('lobby: the freed seat can be taken by a new client', c.snap?.mySeat === 1 && a.snap?.seats[1]?.nickname === 'Cara', c.snap);
    await closeAll(a, c);
  }
  {
    const { a, b, code } = await openLobby();
    await startMatch(a, b);
    const rng = makeRng(7);
    await playUntil(a, b, rng, () => a.packets.length >= 1);
    const before = inspected(code);
    await b.leave(false);
    const told = await until(() => a.snap?.seats[1]?.connected === false);
    check('match: the opponent is told the dropped seat is disconnected', told, a.snap);
    check('match: the disconnect did not touch the authoritative state', inspected(code) === before);
    check('match: the room stays open and playing', live(code).inspect().phase === 'playing' && a.snap?.phase === 'playing' && a.closed === null);
    const late = await rejected(Conn.join(code, 'Dave'));
    check('match: a newcomer cannot take the dropped seat', late !== null, 'join succeeded');
    check('match: no shot_packet was produced by the disconnect', a.packets.length === 1);
    await closeAll(a);
  }
}

async function testWholeMatches(): Promise<void> {
  const verify = async (label: string, a: Conn, b: Conn, code: string, expectReason?: string): Promise<void> => {
    const ea = endEvents(a);
    const eb = endEvents(b);
    check(`${label}: exactly one end event on each seat`, ea.length === 1 && eb.length === 1, [ea.length, eb.length]);
    const last = a.packets.at(-1)!;
    const inLast = [...last.events, ...last.turnEvents].filter((e) => e.type === 'end').length;
    check(`${label}: the end event rides on the final packet only`, inLast === 1 && endEvents(a).length === 1);
    check(`${label}: packet seq contiguous 1..${a.packets.length} and both seats saw identical streams`, a.packets.every((p, i) => p.seq === i + 1) && JSON.stringify(a.packets) === JSON.stringify(b.packets));
    const fin = last.state;
    const [s0, s1] = fin.score;
    const goals = DEFAULT_DATA.rules.goalsToWin;
    const reasonOk = fin.endReason === 'goals' ? Math.max(s0, s1) >= goals : fin.endReason === 'shot-limit' ? fin.shotNo >= DEFAULT_DATA.rules.maxShots : false;
    const winnerOk = fin.winner === (s0 === s1 ? -1 : s0 > s1 ? 0 : 1);
    check(`${label}: final state is over with a consistent reason and winner`, fin.over && reasonOk && winnerOk && (expectReason === undefined || fin.endReason === expectReason), { score: fin.score, reason: fin.endReason, winner: fin.winner, shotNo: fin.shotNo });
    const srv = live(code).inspect();
    check(`${label}: server agrees (phase ended, same state, rng aside)`, srv.phase === 'ended' && JSON.stringify({ ...srv.match, rng: 0 }) === JSON.stringify(fin) && a.snap?.phase === 'ended' && b.snap?.phase === 'ended');
    const packetsAtEnd = a.packets.length;
    const rng = makeRng(99);
    for (const [c, s] of [[a, 0], [b, 1]] as const) {
      const msg = { matchId: c.start!.matchId, turnId: fin.shotNo, clientShotId: freshId(), configVersion: DEFAULT_DATA.version, input: aimedShot({ ...fin, turn: s } as MatchState, s, rng) };
      await expectErr(c, `${label}: seat ${s} shoots after the end`, C2S.shot, msg, 'match-over', { ref: msg.clientShotId });
    }
    await expectErr(a, `${label}: ready after the end`, C2S.ready, { ready: true }, 'match-already-started');
    await sleep(100);
    check(`${label}: nothing further was broadcast and nobody was kicked`, a.packets.length === packetsAtEnd && b.packets.length === packetsAtEnd && a.closed === null && b.closed === null);
  };

  {
    const { a, b, code } = await openLobby();
    await startMatch(a, b);
    const t0 = performance.now();
    const n = await playUntil(a, b, makeRng(4242), () => a.state!.over);
    const fin = a.state!;
    console.log(`  info  aimed match: ${n} shots in ${Math.round(performance.now() - t0)} ms, score ${fin.score.join('-')}, ended by ${fin.endReason}`);
    await verify('aimed match', a, b, code);
    await closeAll(a, b);
  }
  {
    // A few real shots, then the server counter is moved to the last shot (white-box) and the final shot is sent with the matching turnId.
    const { a, b, code } = await openLobby();
    await startMatch(a, b);
    const rng = makeRng(31337);
    const warmup = 8;
    const n = await playUntil(a, b, rng, () => a.state!.over || a.packets.length >= warmup);
    check(`forced shot-limit: the match is still running after ${warmup} shots, before the counter is moved`, !a.state!.over && n === warmup, { over: a.state!.over, n });
    const last = DEFAULT_DATA.rules.maxShots - 1;
    internals(code).match!.shotNo = last;
    const shooter = a.state!.turn === 0 ? a : b;
    await shooter.send(C2S.shot, shotBody(shooter, a.state!.turn, rng, { turnId: last }));
    check('forced shot-limit: the final shot ends the match on both seats', await until(() => a.state!.over && b.state!.over));
    const fin = a.state!;
    const expected = Math.max(...fin.score) >= DEFAULT_DATA.rules.goalsToWin ? 'goals' : 'shot-limit';
    await verify('forced shot-limit match', a, b, code, expected);
    await closeAll(a, b);
  }
  {
    // The AI chooses every shot from the public wire state, the way a real client would, so this match ends on the goals rule.
    let reached = false;
    for (let attempt = 1; attempt <= 3 && !reached; attempt++) {
      const { a, b, code } = await openLobby();
      await startMatch(a, b);
      const t0 = performance.now();
      const n = await playUntil(a, b, makeRng(777 + attempt), () => a.state!.over, 40, (st) => chooseShot(st, DEFAULT_DATA, 'hard', attempt * 1000 + st.shotNo));
      const fin = a.state!;
      console.log(`  info  AI match #${attempt}: ${n} shots in ${Math.round(performance.now() - t0)} ms, score ${fin.score.join('-')}, ended by ${fin.endReason ?? 'nothing (still running)'}`);
      if (fin.over) await verify(`AI match #${attempt}`, a, b, code);
      else check(`AI match #${attempt} finished within 40 shots`, false, { shots: n });
      reached = fin.endReason === 'goals';
      await closeAll(a, b);
    }
    check('an AI-driven match ended by the goals rule over the wire', reached);
  }
}

async function testHostileInput(): Promise<void> {
  const oversize = await captureErrors(async () => {
    for (const size of [3000, 100_000, 1_000_000]) {
      const c = await Conn.create('big');
      c.room.send(C2S.shot, 'z'.repeat(size));
      const closed = await until(() => c.closed !== null, 3000);
      check(`${size} B payload closes the connection (1009)`, closed && c.closed?.code === 1009, c.closed ?? 'still open');
    }
  });
  const unexpectedLogs = oversize.lines.filter((line) => !/Max payload size exceeded/i.test(line));
  console.log(`  info  the server logged ${oversize.lines.length} line(s) for the 3 oversize frames (expected, captured): ${oversize.lines[0] ?? '(none)'}`);
  check('the only server error logged for oversize frames is the payload limit itself', unexpectedLogs.length === 0, unexpectedLogs);
  const mid = await Conn.create('mid');
  const from = mid.mark();
  mid.room.send(C2S.shot, 'z'.repeat(1500));
  const reply = await mid.nextError(from);
  check('a 1500 B payload is within the limit and answered with bad-message', reply?.code === 'bad-message' && mid.closed === null, reply ?? 'no reply');
  await mid.leave();

  const probes: Array<[string, (c: Conn) => void]> = [
    ['unknown message type', (c) => c.room.send('whatever', 1)],
    ['__proto__ type', (c) => c.room.send('__proto__', 1)],
    ['constructor type', (c) => c.room.send('constructor', 1)],
    ['__no_message_handler (300 B)', (c) => c.room.send('__no_message_handler', 'y'.repeat(300))],
    ['__no_message_handler (multibyte)', (c) => c.room.send('__no_message_handler', '球'.repeat(60))],
    ['numeric type', (c) => c.room.send(7, 'x')],
    ['shot with null', (c) => c.room.send(C2S.shot, null)],
    ['shot without payload', (c) => c.room.send(C2S.shot)],
    ['sendBytes garbage', (c) => c.room.sendBytes(C2S.shot, new Uint8Array([1, 2, 3]))],
    ['corrupt msgpack frame', (c) => c.room.connection.send(new Uint8Array([13, 0xa4, 0x73, 0x68, 0x6f, 0x74, 0xc1]))],
    ['one-byte frame', (c) => c.room.connection.send(new Uint8Array([13]))],
    ['unknown protocol byte', (c) => c.room.connection.send(new Uint8Array([99, 1, 2, 3]))],
    ['JOIN_ROOM replay', (c) => c.room.connection.send(new Uint8Array([10]))],
  ];
  for (const [label, send] of probes) {
    const c = await Conn.create('probe');
    const mark = c.mark();
    send(c);
    await sleep(120);
    const kicked = c.closed !== null && c.closed.code === 4002;
    let alive = c.closed === null;
    if (alive) {
      await c.send(C2S.ready, { ready: false });
      alive = await until(() => c.of(S2C.room, mark).length > 0, 1000);
    }
    check(`${label}: not kicked for a handler fault, server keeps answering`, !kicked && (alive || c.closed !== null), c.closed ?? 'no reply');
    await c.leave();
  }

  const flood = await Conn.create('flood');
  const floodFrom = flood.mark();
  for (let i = 0; i < 100; i++) flood.room.send(C2S.ready, { ready: i % 2 === 0 });
  await until(() => flood.of<ErrorMsg>(S2C.error, floodFrom).some((e) => e.code === 'rate-limited'), 2000);
  await sleep(300);
  const limited = flood.of<ErrorMsg>(S2C.error, floodFrom).filter((e) => e.code === 'rate-limited').length;
  check('a 100-message burst is rate-limited, with one reply per window rather than one per message', limited >= 1 && limited <= 2, limited);
  await sleep(1200);
  const recoverFrom = flood.mark();
  await flood.send(C2S.ready, { ready: true });
  check('the rate limit lifts after the window', await until(() => flood.of(S2C.room, recoverFrom).length > 0, 1500));
  await flood.leave();

  check('no uncaught exception during the abuse', uncaught.length === 0, uncaught.join(' | '));
  check('/healthz still answers 200', await healthy());
}

/** Faults the wire cannot produce on its own: a connected client that holds no seat, and a handler that throws. Both are injected into the live room and removed again. */
async function testFaultPaths(): Promise<void> {
  const { a, b, code } = await openLobby();
  const room = rawRoom(code);
  const before = inspected(code);

  const seat = room.seats[0];
  room.seats[0] = null;
  try {
    const id = freshId();
    const shot = { matchId: 'm', turnId: 0, clientShotId: id, configVersion: DEFAULT_DATA.version, input: { pieceId: 'p', dirX: 1, dirY: 0, power: 0.5, curve: 0 } };
    await expectErr(a, 'no seat: ready', C2S.ready, { ready: true }, 'not-seated');
    await expectErr(a, 'no seat: set_lineup', C2S.setLineup, { lineup: DEFAULT_DATA.rules.defaultLineup }, 'not-seated');
    await expectErr(a, 'no seat: shot', C2S.shot, shot, 'not-seated', { ref: id });
  } finally {
    room.seats[0] = seat;
  }
  check('the seatless probes changed nothing on the server', inspected(code) === before);

  const injected = room as unknown as { handleReady?: () => void };
  injected.handleReady = () => {
    throw new Error('injected fault (net-tests)');
  };
  let logged: string[] = [];
  try {
    logged = (await captureErrors(() => expectErr(a, 'a handler that throws is reported to the sender', C2S.ready, { ready: true }, 'internal-error'))).lines;
  } finally {
    delete injected.handleReady;
  }
  check('the throwing handler was logged on the server, with its message', logged.length === 1 && /message handler failed: Error: injected fault/.test(logged[0]), logged);
  check('the fault did not kick the sender', a.closed === null);
  const from = a.mark();
  await a.send(C2S.ready, { ready: true });
  check('with the fault removed the same client is served normally again', await until(() => a.of<RoomSnapshot>(S2C.room, from).some((r) => r.seats[0]?.ready === true)));
  check('b was never disturbed', b.closed === null && b.snap?.phase === 'lobby');
  await closeAll(a, b);
}

async function testStillServing(): Promise<void> {
  const { a, b, code } = await openLobby();
  await startMatch(a, b);
  const n = await playUntil(a, b, makeRng(5), () => a.packets.length >= 2);
  check('after all of the above a fresh room still plays shots end to end', n === 2 && a.packets.length === 2 && b.packets.length === 2 && live(code).inspect().seq === 2);
  await closeAll(a, b);
}

async function pickPort(): Promise<number> {
  const want = process.env.NET_TEST_PORT === undefined ? 2567 : Number(process.env.NET_TEST_PORT);
  if (want === 0) return 0;
  const free = await new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(want, () => probe.close(() => resolve(true)));
  });
  if (!free) console.log(`[net-tests] port ${want} is busy, falling back to an ephemeral port`);
  return free ? want : 0;
}

async function main(): Promise<void> {
  const { httpServer, gameServer } = createGameServer();
  await gameServer.listen(await pickPort());
  const port = (httpServer.address() as AddressInfo).port;
  url = `ws://127.0.0.1:${port}`;
  httpBase = `http://127.0.0.1:${port}`;
  console.log(`[net-tests] real Colyseus server on ${url}, dataVersion ${DEFAULT_DATA.version}`);

  await group('lobby', testLobby);
  await group('lineup', testLineupAndReady);
  await group('shot-chain', testShotChain);
  await group('disconnect', testDisconnect);
  await group('matches', testWholeMatches);
  await group('hostile', testHostileInput);
  await group('faults', testFaultPaths);
  await group('serving', testStillServing);

  console.log('\n[summary]');
  check('no uncaught exception in the whole run', uncaught.length === 0, uncaught.join(' | '));
  check('/healthz answers 200 at the end', await healthy());
  const missing = NET_ERROR_CODES.filter((c) => !seenCodes.has(c));
  console.log(`  info  error codes exercised over the wire: ${NET_ERROR_CODES.length - missing.length}/${NET_ERROR_CODES.length}${missing.length ? `  (not exercised: ${missing.join(', ')})` : ''}`);
  console.log(`\nnet-tests: PASS=${passed} FAIL=${failed}`);
  await gameServer.gracefullyShutdown(false);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('net-tests crashed', err);
  process.exit(1);
});
