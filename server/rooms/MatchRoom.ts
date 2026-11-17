import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { clearTimeout, setTimeout } from 'node:timers';
import { Room, matchMaker, type Client } from 'colyseus';
import { DEFAULT_DATA, type GameData } from '../../shared/data';
import { freezeSnapshot } from '../../packages/game-core/src/snapshot';
import {
  beginTurn,
  createMatch,
  endByTime,
  forfeit,
  passTurn,
  resolveShot,
  validateShot,
  type MatchEvent,
  type MatchState,
} from '../../shared/match';
import type { Side } from '../../shared/physics';
import {
  C2S,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_NAME,
  S2C,
  isNetErrorCode,
  type ClientMessageType,
  type ClockInfo,
  type ErrorMsg,
  type MatchStartMsg,
  type NetErrorCode,
  type Phase,
  type ResumeMsg,
  type RoomSnapshot,
  type SeatSnapshot,
  type ShotPacketMsg,
  type UpdateMsg,
} from '../../shared/protocol';
import { authenticateJoin, netError, type GuestIdentity } from '../auth';
import { systemClock, type ServerClock } from '../clock';
import { ROOM_RECORD_FORMAT, type RecordSeat, type RoomRecord, type RoomStore } from '../roomStore';
import { isRecord, parseReady, parseSetLineup, parseShotMessage, parseSkin, parseSurrender } from '../validation';

const RATE_WINDOW_MS = 1000;
const RATE_MAX_MESSAGES = 30;

export interface MatchTiming {
  matchMs: number;
  turnMs: number;
  /** How long a dropped seat can come back before it forfeits. */
  reconnectMs: number;
  /** Added to the length of a shot's recording: the clients' playback is not exactly real time. */
  playbackMarginMs: number;
}

function timingDefaults(data: GameData): MatchTiming { return {
  matchMs: data.rules.matchSeconds * 1000,
  turnMs: data.rules.turnSeconds * 1000,
  reconnectMs: data.rules.reconnectSeconds * 1000,
  playbackMarginMs: 500,
}; }

interface Seat {
  client: Client | null;
  sessionId: string;
  /** Secret that re-claims this seat. Only ever sent to the seat's own client, never logged. */
  token: string;
  nickname: string;
  connected: boolean;
  ready: boolean;
  lineup: string[];
  levels: number[];
  /** Monotonic deadline of the reconnect window; null while the seat is connected or no match is running. */
  windowEnd: number | null;
  window: NodeJS.Timeout | null;
}

interface RateBucket {
  start: number;
  count: number;
  warned: boolean;
}

const newSeatToken = (): string => randomBytes(16).toString('base64url');
const errText = (err: unknown): string => (err instanceof Error ? (err.stack ?? err.message) : String(err));

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Colyseus does not check custom roomIds for collisions, so uniqueness is enforced here. */
export function allocateRoomCode(used: Set<string>, pick: (max: number) => number = (max) => randomInt(max)): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[pick(ROOM_CODE_ALPHABET.length)];
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
  }
  throw netError('internal-error');
}

/** One 1v1 match. The server owns every rule decision; clients only send intents. */
export class MatchRoom extends Room {
  private static readonly usedCodes = new Set<string>();
  private static readonly pendingRestores = new Map<string, RoomRecord>();
  private static sharedStore: RoomStore | null = null;
  private static sharedTiming: Partial<MatchTiming> = {};
  private static dataProvider: (version?: string) => GameData = (version) => { if (version && version !== DEFAULT_DATA.version) throw netError('config-mismatch'); return DEFAULT_DATA; };
  static useDataProvider(provider: (version?: string) => GameData): () => void { const previous = MatchRoom.dataProvider; MatchRoom.dataProvider = provider; return () => { MatchRoom.dataProvider = previous; }; }

  /** Rooms keep the store they were created with. Pass null to stop persisting rooms created from now on. */
  static useStore(store: RoomStore | null): void {
    MatchRoom.sharedStore = store;
  }

  /** Test hook: shorter clocks for rooms created from now on. Returns a function that puts the previous values back. */
  static useTiming(override: Partial<MatchTiming>): () => void {
    const previous = MatchRoom.sharedTiming;
    MatchRoom.sharedTiming = { ...previous, ...override };
    return () => {
      MatchRoom.sharedTiming = previous;
    };
  }

  /** Re-creates a running match from a stored record (server start-up). Rejects when the record does not fit the running game data. */
  static async restore(rec: RoomRecord): Promise<void> {
    const key = randomUUID();
    MatchRoom.pendingRestores.set(key, rec);
    try {
      await matchMaker.createRoom(ROOM_NAME, { restoreKey: key });
    } finally {
      MatchRoom.pendingRestores.delete(key);
    }
  }

  private static restoreRecordFor(options: unknown): RoomRecord | undefined {
    const key = isRecord(options) ? options.restoreKey : undefined;
    return typeof key === 'string' ? MatchRoom.pendingRestores.get(key) : undefined;
  }

  protected resolveGameData(version?: string): GameData { return MatchRoom.dataProvider(version); }
  protected resolveStore(): RoomStore | null { return MatchRoom.sharedStore; }
  protected resolveClock(): ServerClock { return systemClock; }
  protected authenticate(options: unknown): GuestIdentity { return authenticateJoin(options); }
  private store: RoomStore | null = null;
  private time: ServerClock = systemClock;
  private data: GameData = DEFAULT_DATA;
  private timing: MatchTiming = timingDefaults(DEFAULT_DATA);
  private code = '';
  private skin = '';
  private phase: Phase = 'lobby';
  private seats: [Seat | null, Seat | null] = [null, null];
  private limits = new Map<string, RateBucket>();
  private matchId = '';
  private seed = 0;
  private seq = 0;
  private match: MatchState | null = null;
  private accepted = new Map<string, number>();
  private matchDeadline = 0;
  private turnDeadline: number | null = null;
  /** When the clients are expected to be done playing back the newest shot. */
  private playbackUntil = 0;
  /** The match clock ran out while a shot was still playing: the end is announced once that playback is over. */
  private endPending = false;
  private matchTimer: NodeJS.Timeout | null = null;
  private turnTimer: NodeJS.Timeout | null = null;

  override async onCreate(options: unknown): Promise<void> {
    const record = MatchRoom.restoreRecordFor(options);
    this.data = freezeSnapshot(this.resolveGameData(record?.configVersion));
    this.store = this.resolveStore();
    this.time = this.resolveClock();
    this.timing = { ...timingDefaults(this.data), ...MatchRoom.sharedTiming };
    if (!record) {
      // onAuth only runs after the websocket upgrade, so reject a bad creator here to avoid orphan rooms.
      this.authenticate(options);
      const skin = parseSkin(isRecord(options) ? options.skin : undefined);
      if (!skin.ok) throw netError(skin.code);
      this.skin = skin.value;
    }
    this.maxClients = 2;
    await this.setPrivate(true);

    // No Colyseus `validate` argument: a throwing validator kicks the client with 4002. Validate inside the handler.
    this.onMessage(C2S.setLineup, (client, raw) => this.guard(client, C2S.setLineup, () => this.handleSetLineup(client, raw)));
    this.onMessage(C2S.ready, (client, raw) => this.guard(client, C2S.ready, () => this.handleReady(client, raw)));
    this.onMessage(C2S.shot, (client, raw) => this.guard(client, C2S.shot, () => this.handleShot(client, raw)));
    this.onMessage(C2S.surrender, (client, raw) => this.guard(client, C2S.surrender, () => this.handleSurrender(client, raw)));
    this.onMessage('*', (client) => this.guard(client, undefined, () => this.sendError(client, 'bad-message')));
    // Colyseus pre-registers this key as an internal handler. A client that sends it as a message type would reach that handler
    // with its own payload as the "type": it gets kicked, the payload is logged, and a payload over 123 bytes throws an
    // uncaught RangeError out of ws (remote crash). Registering it here replaces the internal handler.
    this.onMessage('__no_message_handler', (client) => this.guard(client, undefined, () => this.sendError(client, 'bad-message')));

    // Last step and synchronous: nothing may await between the uniqueness check and the registration.
    if (record) this.restoreFrom(record);
    else this.code = allocateRoomCode(MatchRoom.usedCodes);
    this.roomId = this.code;
  }

  override onAuth(_client: Client, options: unknown): GuestIdentity {
    return this.authenticate(options);
  }

  override onJoin(client: Client, _options: unknown, auth: GuestIdentity): void {
    if (auth.seatToken !== undefined) return this.reclaimSeat(client, auth.seatToken);
    const idx = this.seats.findIndex((s) => s === null);
    if (idx < 0 || this.phase !== 'lobby') throw netError('match-already-started');
    this.seats[idx] = {
      client,
      sessionId: client.sessionId,
      token: newSeatToken(),
      nickname: auth.nickname,
      connected: true,
      ready: false,
      lineup: this.data.rules.defaultLineup.slice(),
      levels: new Array<number>(this.data.rules.formation.length).fill(this.data.rules.levels.uniformLevel),
      windowEnd: null,
      window: null,
    };
    this.resetReady();
    this.broadcastRoom();
  }

  override onLeave(client: Client): void {
    this.limits.delete(client.sessionId);
    const side = this.seatOf(client);
    if (side === -1) return;
    if (this.phase === 'lobby') {
      this.seats[side] = null;
      this.resetReady();
    } else {
      // The seat keeps its token: the player can come back until the reconnect window runs out.
      const seat = this.seats[side]!;
      seat.connected = false;
      seat.client = null;
      seat.sessionId = '';
      if (this.phase === 'playing') this.openWindow(side);
    }
    this.broadcastRoom();
  }

  override onDispose(): void {
    // A graceful shutdown disposes running matches: keep them restorable.
    this.persist();
    this.clearTimers();
    MatchRoom.usedCodes.delete(this.code);
  }

  /** In-process test hook. Not reachable over the network; the only place the seed is exposed. */
  inspect() {
    return {
      code: this.code,
      phase: this.phase,
      matchId: this.matchId,
      seed: this.seed,
      seq: this.seq,
      match: this.match ? structuredClone(this.match) : null,
      acceptedShots: this.accepted.size,
    };
  }

  private seatOf(client: Client): Side | -1 {
    if (this.seats[0]?.sessionId === client.sessionId) return 0;
    if (this.seats[1]?.sessionId === client.sessionId) return 1;
    return -1;
  }

  private resetReady(): void {
    for (const seat of this.seats) if (seat) seat.ready = false;
  }

  /** The token is the only proof of identity for a seat. It works for a dropped seat and for a live one (the old connection is replaced). */
  private reclaimSeat(client: Client, token: string): void {
    const side = this.seats.findIndex((s) => s !== null && sameToken(s.token, token));
    if (side < 0) throw netError('bad-seat-token');
    const seat = this.seats[side]!;
    const previous = seat.connected ? seat.client : null;
    // Rebind first: the old connection's onLeave then no longer matches any seat.
    seat.client = client;
    seat.sessionId = client.sessionId;
    seat.connected = true;
    this.closeWindow(seat);
    if (previous) {
      try {
        previous.leave();
      } catch (err) {
        console.error('[MatchRoom] could not close the replaced connection:', errText(err));
      }
    }
    this.broadcastRoom();
    if (this.phase !== 'lobby') client.send(S2C.resume, this.resumeMsg());
  }

  /** Rate limit plus a catch-all: Colyseus does not catch exceptions thrown from message handlers. */
  private guard(client: Client, on: ClientMessageType | undefined, run: () => void): void {
    try {
      if (!this.allow(client, on)) return;
      run();
    } catch (err) {
      console.error('[MatchRoom] message handler failed:', err instanceof Error ? (err.stack ?? err.message) : String(err));
      this.sendError(client, 'internal-error', on);
    }
  }

  /** Fixed window. Over the limit: one `rate-limited` reply per window, everything else is dropped silently. */
  private allow(client: Client, on: ClientMessageType | undefined): boolean {
    const now = performance.now();
    let bucket = this.limits.get(client.sessionId);
    if (!bucket || now - bucket.start >= RATE_WINDOW_MS) {
      bucket = { start: now, count: 0, warned: false };
      this.limits.set(client.sessionId, bucket);
    }
    bucket.count += 1;
    if (bucket.count <= RATE_MAX_MESSAGES) return true;
    if (!bucket.warned) {
      bucket.warned = true;
      this.sendError(client, 'rate-limited', on);
    }
    return false;
  }

  private handleSetLineup(client: Client, raw: unknown): void {
    const parsed = parseSetLineup(raw, this.data);
    if (!parsed.ok) return this.sendError(client, parsed.code, C2S.setLineup);
    const side = this.seatOf(client);
    if (side === -1) return this.sendError(client, 'not-seated', C2S.setLineup);
    if (this.phase !== 'lobby') return this.sendError(client, 'match-already-started', C2S.setLineup);
    const seat = this.seats[side]!;
    seat.lineup = parsed.value.lineup;
    seat.levels = parsed.value.levels;
    seat.ready = false;
    this.broadcastRoom();
  }

  private handleReady(client: Client, raw: unknown): void {
    const parsed = parseReady(raw);
    if (!parsed.ok) return this.sendError(client, parsed.code, C2S.ready);
    const side = this.seatOf(client);
    if (side === -1) return this.sendError(client, 'not-seated', C2S.ready);
    if (this.phase !== 'lobby') return this.sendError(client, 'match-already-started', C2S.ready);
    this.seats[side]!.ready = parsed.value.ready;
    const [a, b] = this.seats;
    if (a && b && a.connected && b.connected && a.ready && b.ready) this.startMatch(a, b);
    else this.broadcastRoom();
  }

  private startMatch(a: Seat, b: Seat): void {
    this.seed = randomInt(0x100000000);
    this.matchId = randomUUID();
    this.seq = 0;
    this.accepted.clear();
    const st = createMatch(this.data, [a.lineup, b.lineup], { seed: this.seed, levels: [a.levels, b.levels] });
    const turnEvents = beginTurn(st, this.data);
    this.match = st;
    this.phase = 'playing';
    // The room has to outlive its clients: a dropped seat can come back, and the clocks keep running with nobody connected.
    this.autoDispose = false;
    this.startClocks(this.timing.matchMs, this.timing.turnMs);

    this.broadcastRoom();
    const start: MatchStartMsg = { ...this.matchInfo(), state: this.wireState(), turnEvents, clocks: this.clocks() };
    this.broadcast(S2C.matchStart, start);
    this.persist();
  }

  /**
   * Validation order is part of the protocol (docs/online.md). Anything that fails leaves the authoritative state
   * untouched: the shot is resolved on a clone that replaces `this.match` only after resolveShot() returned.
   */
  private handleShot(client: Client, raw: unknown): void {
    const parsed = parseShotMessage(raw);
    if (!parsed.ok) return this.sendError(client, parsed.code, C2S.shot);
    const msg = parsed.value;
    const ref = msg.clientShotId;
    const side = this.seatOf(client);
    if (side === -1) return this.sendError(client, 'not-seated', C2S.shot, ref);
    const st = this.match;
    if (this.phase === 'lobby' || !st) return this.sendError(client, 'match-not-started', C2S.shot, ref);
    if (msg.matchId !== this.matchId) return this.sendError(client, 'stale-match', C2S.shot, ref);
    if (msg.configVersion !== this.data.version) return this.sendError(client, 'config-mismatch', C2S.shot, ref);

    const key = `${side}:${ref}`;
    const prior = this.accepted.get(key);
    if (prior !== undefined) return this.sendError(client, 'duplicate-shot', C2S.shot, ref, prior);

    if (st.over || this.endPending) return this.sendError(client, 'match-over', C2S.shot, ref);
    if (msg.turnId !== st.shotNo) return this.sendError(client, 'stale-turn', C2S.shot, ref);
    const verdict = validateShot(st, this.data, side, msg.input);
    if (verdict !== null) return this.sendError(client, isNetErrorCode(verdict) ? verdict : 'internal-error', C2S.shot, ref);

    const work = structuredClone(st);
    const out = resolveShot(work, this.data, msg.input);
    this.match = work;
    this.seq += 1;
    this.accepted.set(key, this.seq);

    // The next turn only starts once the clients have played the shot back, so the turn clock gets that time on top.
    const playbackMs = Math.ceil((out.sim.frames.length / this.data.physics.recordHz) * 1000) + this.timing.playbackMarginMs;
    this.playbackUntil = this.time.nowMs() + playbackMs;
    if (!work.over) this.armTurn(playbackMs + this.timing.turnMs);

    const packet: ShotPacketMsg = {
      matchId: this.matchId,
      seat: side,
      clientShotId: ref,
      seq: this.seq,
      input: msg.input,
      ids: out.sim.ids,
      frames: out.sim.frames,
      recordHz: this.data.physics.recordHz,
      simEvents: out.sim.events,
      events: out.events,
      turnEvents: out.turnEvents,
      state: this.wireState(),
      clocks: this.clocks(),
    };
    this.broadcast(S2C.shotPacket, packet);
    if (work.over) this.finishMatch();
    else this.persist();
  }

  private handleSurrender(client: Client, raw: unknown): void {
    const parsed = parseSurrender(raw);
    if (!parsed.ok) return this.sendError(client, parsed.code, C2S.surrender);
    const side = this.seatOf(client);
    if (side === -1) return this.sendError(client, 'not-seated', C2S.surrender);
    const st = this.match;
    if (this.phase === 'lobby' || !st) return this.sendError(client, 'match-not-started', C2S.surrender);
    if (this.phase === 'ended' || st.over) return this.sendError(client, 'match-over', C2S.surrender);
    this.pushUpdate(this.apply((s) => forfeit(s, side, 'surrender')));
  }

  private onTurnTimeout(): void {
    this.turnTimer = null;
    const st = this.match;
    if (this.phase !== 'playing' || !st || st.over) return;
    const events = this.apply((s) => passTurn(s, this.data, 'timeout'));
    if (!this.match!.over) this.armTurn(this.timing.turnMs);
    this.pushUpdate(events);
  }

  private onMatchClock(): void {
    this.matchTimer = null;
    const st = this.match;
    if (this.phase !== 'playing' || !st || st.over) return;
    const left = this.playbackUntil - this.time.nowMs();
    if (left > 0) {
      // A shot is still playing on the clients: the whistle waits for it, as in the local game.
      this.endPending = true;
      this.matchTimer = this.after(left, () => this.onMatchClock());
      return;
    }
    this.pushUpdate(this.apply((s) => endByTime(s)));
  }

  private onWindowExpired(side: Side): void {
    const seat = this.seats[side];
    if (!seat) return;
    seat.window = null;
    seat.windowEnd = null;
    const st = this.match;
    if (this.phase !== 'playing' || seat.connected || !st || st.over) return;
    const other = this.seats[side === 0 ? 1 : 0];
    if (other?.connected) this.pushUpdate(this.apply((s) => forfeit(s, side, 'disconnect')));
    else this.abandon();
  }

  /** Runs `change` on a clone and keeps the result only if it did not throw. */
  private apply(change: (st: MatchState) => MatchEvent[]): MatchEvent[] {
    const work = structuredClone(this.match!);
    const events = change(work);
    this.match = work;
    return events;
  }

  /** A state change that is not a shot (timeout, surrender, forfeit, match clock). */
  private pushUpdate(events: MatchEvent[]): void {
    const update: UpdateMsg = { matchId: this.matchId, events, state: this.wireState(), clocks: this.clocks() };
    this.broadcast(S2C.update, update);
    if (this.match!.over) this.finishMatch();
    else this.persist();
  }

  private finishMatch(): void {
    this.phase = 'ended';
    this.clearTimers();
    // Nobody is kicked: the players stay to read the result and the room goes away with the last one. With nobody left, now.
    this.autoDispose = true;
    this.store?.remove(this.code);
    this.broadcastRoom();
    if (this.clients.length === 0) this.closeRoom();
  }

  /** Neither player came back in time: no result, nothing to resume. */
  private abandon(): void {
    this.phase = 'ended';
    this.clearTimers();
    this.autoDispose = true;
    this.store?.remove(this.code);
    this.closeRoom();
  }

  private closeRoom(): void {
    this.disconnect().catch((err: unknown) => console.error('[MatchRoom] disconnect failed:', err instanceof Error ? err.message : String(err)));
  }

  private persist(): void {
    const st = this.match;
    const [a, b] = this.seats;
    if (!this.store || this.phase !== 'playing' || !st || !a || !b) return;
    const clocks = this.clocks();
    const recSeat = (s: Seat): RecordSeat => ({ nickname: s.nickname, token: s.token, lineup: s.lineup.slice(), levels: s.levels.slice() });
    this.store.save({
      format: ROOM_RECORD_FORMAT,
      code: this.code,
      skin: this.skin,
      configVersion: this.data.version,
      matchId: this.matchId,
      seed: this.seed,
      seq: this.seq,
      accepted: [...this.accepted],
      match: st,
      seats: [recSeat(a), recSeat(b)],
      clocks: { matchMs: clocks.matchMs, turnMs: clocks.turnMs },
      savedAt: this.time.wallMs(),
    });
  }

  private restoreFrom(rec: RoomRecord): void {
    const fail = (why: string): Error => new Error(`cannot restore room ${rec.code}: ${why}`);
    if (rec.configVersion !== this.data.version || rec.match.dataVersion !== this.data.version) throw fail('data version differs');
    if (rec.match.over) throw fail('the match is already over');
    if (MatchRoom.usedCodes.has(rec.code)) throw fail('room code is in use');
    const skin = parseSkin(rec.skin);
    if (!skin.ok) throw fail(skin.code);
    const seats: Seat[] = [];
    for (const [i, s] of rec.seats.entries()) {
      const parsed = parseSetLineup({ lineup: s.lineup, levels: s.levels }, this.data);
      if (!parsed.ok) throw fail(`seat ${i}: ${parsed.code}`);
      seats.push({
        client: null,
        sessionId: '',
        token: s.token,
        nickname: s.nickname,
        connected: false,
        ready: true,
        lineup: parsed.value.lineup,
        levels: parsed.value.levels,
        windowEnd: null,
        window: null,
      });
    }

    MatchRoom.usedCodes.add(rec.code);
    this.code = rec.code;
    this.skin = skin.value;
    this.seed = rec.seed;
    this.matchId = rec.matchId;
    this.seq = rec.seq;
    this.accepted = new Map(rec.accepted);
    this.match = structuredClone(rec.match);
    this.seats = [seats[0]!, seats[1]!];
    this.phase = 'playing';
    this.autoDispose = false;
    this.startClocks(rec.clocks.matchMs, Math.min(rec.clocks.turnMs ?? this.timing.turnMs, this.timing.turnMs));
    // Nobody is connected after a restart: both players get a full window to find their way back.
    this.openWindow(0);
    this.openWindow(1);
  }

  private after(ms: number, run: () => void): NodeJS.Timeout {
    const timer = setTimeout(() => {
      try {
        run();
      } catch (err) {
        console.error('[MatchRoom] timer failed:', errText(err));
      }
    }, ms);
    timer.unref();
    return timer;
  }

  private startClocks(matchMs: number, turnMs: number): void {
    const t = this.time.nowMs();
    this.matchDeadline = t + matchMs;
    this.matchTimer = this.after(matchMs, () => this.onMatchClock());
    this.playbackUntil = t;
    this.endPending = false;
    this.armTurn(turnMs);
  }

  private armTurn(ms: number): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnDeadline = this.time.nowMs() + ms;
    this.turnTimer = this.after(ms, () => this.onTurnTimeout());
  }

  private openWindow(side: Side): void {
    const seat = this.seats[side];
    if (!seat) return;
    this.closeWindow(seat);
    seat.windowEnd = this.time.nowMs() + this.timing.reconnectMs;
    seat.window = this.after(this.timing.reconnectMs, () => this.onWindowExpired(side));
  }

  private closeWindow(seat: Seat): void {
    if (seat.window) clearTimeout(seat.window);
    seat.window = null;
    seat.windowEnd = null;
  }

  private clearTimers(): void {
    if (this.matchTimer) clearTimeout(this.matchTimer);
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.matchTimer = null;
    this.turnTimer = null;
    this.turnDeadline = null;
    for (const seat of this.seats) if (seat) this.closeWindow(seat);
  }

  /** Remaining time right now. A finished match has no clocks. */
  private clocks(): ClockInfo {
    if (this.phase !== 'playing' || !this.match || this.match.over) return { turnMs: null, matchMs: 0 };
    const t = this.time.nowMs();
    return {
      turnMs: this.turnDeadline === null ? null : Math.max(0, Math.ceil(this.turnDeadline - t)),
      matchMs: Math.max(0, Math.ceil(this.matchDeadline - t)),
    };
  }

  private matchInfo(): Omit<MatchStartMsg, 'state' | 'turnEvents' | 'clocks'> {
    const [a, b] = this.seats as [Seat, Seat];
    return {
      matchId: this.matchId,
      configVersion: this.data.version,
      skin: this.skin,
      lineups: [a.lineup.slice(), b.lineup.slice()],
      levels: [a.levels.slice(), b.levels.slice()],
      names: [a.nickname, b.nickname],
    };
  }

  private resumeMsg(): ResumeMsg {
    const c = this.clocks();
    // The turn clock includes the allowance for a shot this client never has to play back.
    const turnMs = c.turnMs === null ? null : Math.min(c.turnMs, this.timing.turnMs);
    return { ...this.matchInfo(), seq: this.seq, state: this.wireState(), clocks: { turnMs, matchMs: c.matchMs } };
  }

  /** Client-visible copy of the authoritative state: the RNG state never leaves the server. */
  private wireState(): MatchState {
    const copy = structuredClone(this.match!);
    copy.rng = 0;
    return copy;
  }

  private snapshot(mySeat: Side): RoomSnapshot {
    const view = (s: Seat | null): SeatSnapshot | null => {
      if (!s) return null;
      const seat: SeatSnapshot = { nickname: s.nickname, connected: s.connected, ready: s.ready, lineup: s.lineup.slice(), levels: s.levels.slice() };
      if (this.phase === 'playing' && s.windowEnd !== null) seat.reconnectMs = Math.max(0, Math.ceil(s.windowEnd - this.time.nowMs()));
      return seat;
    };
    const snap: RoomSnapshot = {
      protocol: PROTOCOL_VERSION,
      code: this.code,
      configVersion: this.data.version,
      skin: this.skin,
      phase: this.phase,
      seats: [view(this.seats[0]), view(this.seats[1])],
      mySeat,
    };
    const mine = this.seats[mySeat];
    if (mine) snap.seatToken = mine.token;
    return snap;
  }

  private broadcastRoom(): void {
    for (const side of [0, 1] as const) {
      const seat = this.seats[side];
      if (seat?.connected && seat.client) seat.client.send(S2C.room, this.snapshot(side));
    }
  }

  private sendError(client: Client, code: NetErrorCode, on?: ClientMessageType, ref?: string, seq?: number): void {
    const msg: ErrorMsg = { code };
    if (on !== undefined) msg.on = on;
    if (ref !== undefined) msg.ref = ref;
    if (seq !== undefined) msg.seq = seq;
    client.send(S2C.error, msg);
  }
}
