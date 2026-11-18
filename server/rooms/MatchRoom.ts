import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { clearTimeout, setTimeout } from 'node:timers';
import { Room, matchMaker, type Client } from 'colyseus';
import { DEFAULT_DATA, type GameData } from '../../shared/data';
import { freezeSnapshot } from '../../packages/game-core/src/snapshot';
import { rulesForMode, verifyModeRules } from '../../config/modes';
import { resolveModeLineup, classifyModeOutcome } from '../../packages/game-core/src/modes';
import type { ModeRules, ModeOutcome } from '../../packages/contracts/src/modes';
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
  type ShotInput,
} from '../../shared/match';
import type { Side } from '../../shared/physics';
import {
  C2S,
  PROTOCOL_VERSION,
  ACCOUNT_PROTOCOL_VERSION,
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
import type { AccountIdentity, AccountRoomTarget } from '../matches/tickets';
import { systemClock, type ServerClock } from '../clock';
import { ROOM_RECORD_FORMAT, type RecordSeat, type RoomRecord, type RoomStore } from '../roomStore';
import { isRecord, parseReady, parseSetLineup, parseShotMessage, parseSkin, parseSurrender } from '../validation';
import { ShotReceipts } from '../matches/shot-receipts';
import { RoomCommandQueue } from '../matches/command-queue';
import { boundedShotPacket, SurrenderV2Schema } from '../../packages/contracts/src/match-wire';
import type { AccountRoomSetup } from '../matches/recovery';
import type { SettlementReceipt } from '../matches/outcomes';
import { OutcomeIntentSchema, type OutcomeIntent } from '../../packages/contracts/src/match-results';

export type MatchSimulator = (state: MatchState, data: GameData, input: ShotInput) => ReturnType<typeof resolveShot> | Promise<ReturnType<typeof resolveShot>>;

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
  actorId: string;
  windowGeneration: number;
  account?: AccountIdentity;
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
  /** Only server-side room factories can supply this setup; it is never decoded from client options. */
  protected accountCreation(_options: unknown): AccountRoomSetup | null { return null; }
  private accountSetup: ReturnType<MatchRoom['accountCreation']> = null;
  private static readonly usedCodes = new Set<string>();
  private static readonly pendingRestores = new Map<string, RoomRecord>();
  private static sharedStore: RoomStore | null = null;
  private static sharedTiming: Partial<MatchTiming> = {};
  private static dataProvider: (version?: string, serverCohort?: string) => GameData = (version) => { if (version && version !== DEFAULT_DATA.version) throw netError('config-mismatch'); return DEFAULT_DATA; };
  static useDataProvider(provider: (version?: string, serverCohort?: string) => GameData): () => void { const previous = MatchRoom.dataProvider; MatchRoom.dataProvider = provider; return () => { MatchRoom.dataProvider = previous; }; }

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

  protected resolveGameData(version?: string, serverCohort?: string): GameData { return MatchRoom.dataProvider(version, serverCohort); }
  protected resolveStore(): RoomStore | null { return MatchRoom.sharedStore; }
  protected resolveClock(): ServerClock { return systemClock; }
  protected authenticate(options: unknown): GuestIdentity { return authenticateJoin(options); }
  private store: RoomStore | null = null;
  private time: ServerClock = systemClock;
  private data: GameData = DEFAULT_DATA;
  private rules: ModeRules = rulesForMode(DEFAULT_DATA, 'practice');
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
  private receipts = new ShotReceipts();
  private configurationHash = '';
  private startedAt = 0;
  private settlementReceipt: SettlementReceipt = { status: 'pending', recorded: false, recoverable: false };
  private unsubscribeSettlement: (() => void) | null = null;
  private terminalIntent: OutcomeIntent | null = null;
  private terminalMessage: { type: typeof S2C.shotPacket | typeof S2C.update; data: ShotPacketMsg | UpdateMsg; ack?: { side: Side; ref: string } } | null = null;
  private terminalMessageSent = false;
  private endedReleased = false;
  private revision = 0;
  private epoch = 0;
  private disposed = false;
  private turnGeneration = 0;
  private matchGeneration = 0;
  private readonly commands = new RoomCommandQueue();
  protected simulateShot(state: MatchState, data: GameData, input: ShotInput): ReturnType<MatchSimulator> { return resolveShot(state, data, input); }
  private protocol() { return this.accountSetup ? ACCOUNT_PROTOCOL_VERSION : PROTOCOL_VERSION; }
  private stamp() { return { protocol: this.protocol(), revision: this.revision }; }
  private matchDeadline = 0;
  private turnDeadline: number | null = null;
  /** When the clients are expected to be done playing back the newest shot. */
  private playbackUntil = 0;
  /** The match clock ran out while a shot was still playing: the end is announced once that playback is over. */
  private endPending = false;
  private matchTimer: NodeJS.Timeout | null = null;
  private turnTimer: NodeJS.Timeout | null = null;

  override async onCreate(options: unknown): Promise<void> {
    this.accountSetup = this.accountCreation(options);
    const record = MatchRoom.restoreRecordFor(options);
    this.data = freezeSnapshot(this.accountSetup?.data ?? this.resolveGameData(record?.configVersion, randomUUID()));
    if (record?.modeRules) this.rules = verifyModeRules(this.data, record.modeRules);
    else {
      const mode = this.accountSetup?.mode ?? (!record && isRecord(options) ? options.mode : undefined);
      if (mode !== undefined && mode !== 'practice' && mode !== 'friend' && mode !== 'growth' && mode !== 'ranked') throw netError('bad-message');
      // Only the trusted account setup can select modes requiring ownership.
      if (!this.accountSetup && mode !== undefined && mode !== 'practice' && mode !== 'friend') throw netError('bad-message');
      this.rules = rulesForMode(this.data, mode ?? 'practice');
    }
    this.store = this.resolveStore();
    this.time = this.resolveClock();
    this.timing = { ...timingDefaults(this.data), ...MatchRoom.sharedTiming };
    if (!record) {
      // onAuth only runs after the websocket upgrade, so reject a bad creator here to avoid orphan rooms.
      if (!this.accountSetup) this.authenticate(options);
      const skin = parseSkin(isRecord(options) ? options.skin : undefined);
      if (!skin.ok) throw netError(skin.code);
      this.skin = skin.value;
    }
    this.maxClients = 2;
    await this.setPrivate(true);

    // No Colyseus `validate` argument: a throwing validator kicks the client with 4002. Validate inside the handler.
    this.onMessage(C2S.setLineup, (client, raw) => this.guard(client, C2S.setLineup, () => this.handleSetLineup(client, raw)));
    this.onMessage(C2S.ready, (client, raw) => this.guard(client, C2S.ready, () => this.handleReady(client, raw)));
    this.onMessage(C2S.shot, (client, raw) => this.guard(client, C2S.shot, (received) => this.handleShot(client, raw, received)));
    this.onMessage(C2S.surrender, (client, raw) => this.guard(client, C2S.surrender, () => this.handleSurrender(client, raw)));
    this.onMessage('*', (client) => this.guard(client, undefined, () => this.sendError(client, 'bad-message')));
    // Colyseus pre-registers this key as an internal handler. A client that sends it as a message type would reach that handler
    // with its own payload as the "type": it gets kicked, the payload is logged, and a payload over 123 bytes throws an
    // uncaught RangeError out of ws (remote crash). Registering it here replaces the internal handler.
    this.onMessage('__no_message_handler', (client) => this.guard(client, undefined, () => this.sendError(client, 'bad-message')));

    // Last step and synchronous: nothing may await between the uniqueness check and the registration.
    if (record) this.restoreFrom(record);
    else if (this.accountSetup) {
      if (MatchRoom.usedCodes.has(this.accountSetup.code)) throw netError('unavailable');
      MatchRoom.usedCodes.add(this.accountSetup.code);
      this.code = this.accountSetup.code;
    } else this.code = allocateRoomCode(MatchRoom.usedCodes);
    this.roomId = this.code;
  }

  override async onAuth(_client: Client, options: unknown): Promise<GuestIdentity | AccountIdentity> {
    return this.accountSetup ? this.accountSetup.admit(options) : this.authenticate(options);
  }

  override onJoin(client: Client, _options: unknown, auth: GuestIdentity | AccountIdentity): void {
    const account = 'userId' in auth ? auth : undefined;
    if (!account && 'seatToken' in auth && auth.seatToken !== undefined) return this.reclaimSeat(client, auth.seatToken);
    if (account) {
      if (!this.accountSetup || account.snapshot.rules.gameDataVersion !== this.data.version || account.snapshot.rules.mode !== this.rules.mode) throw netError('forbidden');
      const prior = this.seats.find((seat) => seat?.account?.userId === account.userId);
      if (prior) {
        if (!this.accountTarget()?.canEnter(account.userId)) throw netError('forbidden');
        prior.account = account;
        return this.reclaimSeat(client, prior.token);
      }
    } else if (this.accountSetup) throw netError('unauthenticated');
    const idx = this.seats.findIndex((s) => s === null);
    if (idx < 0 || this.phase !== 'lobby') throw netError('match-already-started');
    this.seats[idx] = {
      actorId: account?.userId ?? (auth as GuestIdentity).guestId,
      windowGeneration: 0,
      account,
      client,
      sessionId: client.sessionId,
      token: newSeatToken(),
      nickname: auth.nickname,
      connected: true,
      ready: false,
      lineup: account ? account.snapshot.cards.map((card) => card.playerDefId) : this.data.rules.defaultLineup.slice(),
      levels: account ? account.snapshot.cards.map((card) => card.level) : new Array<number>(this.data.rules.formation.length).fill(this.data.rules.levels.uniformLevel),
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
    this.unsubscribeSettlement?.(); this.unsubscribeSettlement = null;
    this.disposed = true;
    this.epoch++;
    this.commands.close();
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
      revision: this.revision,
      settlement: this.accountSetup && this.match?.over ? { ...this.settlementReceipt } : undefined,
    };
  }

  /** Trusted server port for ticket issuance; never exposed through matchmaker metadata or a public GET. */
  accountTarget(): AccountRoomTarget | undefined {
    if (!this.accountSetup) return undefined;
    return { code: this.code, data: this.data, mode: this.accountSetup.mode,
      selection: (userId) => this.seats.find((seat) => seat?.account?.userId === userId)?.account?.snapshot,
      recovery: (userId) => {
        const side = this.seats.findIndex((seat) => seat?.account?.userId === userId);
        if (side < 0 || !this.matchId || !this.match) return undefined;
        const seat = this.seats[side]!;
        return { matchId: this.matchId, side: side as Side, phase: this.phase, reconnectMs: seat.windowEnd === null ? null : Math.max(0, Math.ceil(seat.windowEnd - this.time.nowMs())) };
      },
      canEnter: (userId) => {
        const seat = this.seats.find((entry) => entry?.account?.userId === userId);
        return seat ? this.phase !== 'ended' && (seat.connected || seat.windowEnd === null || seat.windowEnd > this.time.nowMs())
          : this.phase === 'lobby' && this.seats.some((entry) => entry === null);
      } };
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
    if (this.phase === 'playing' && seat.windowEnd !== null && seat.windowEnd <= this.time.nowMs()) throw netError('bad-seat-token');
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
  private guard(client: Client, on: ClientMessageType | undefined, run: (received: { revision: number; at: number }) => void | Promise<void>): void {
    if (!this.allow(client, on)) return;
    const epoch = this.epoch, received = { revision: this.revision, at: this.time.nowMs() };
    const queued = this.commands.submit(() => { if (!this.disposed && epoch === this.epoch) return run(received); }, () => {
      console.error('[MatchRoom] message handler failed');
      this.sendError(client, 'internal-error', on);
    });
    if (!queued && !this.disposed) this.sendError(client, 'rate-limited', on);
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
    if (this.accountSetup) return this.sendError(client, 'forbidden', C2S.setLineup);
    const parsed = parseSetLineup(raw, this.data);
    if (!parsed.ok) return this.sendError(client, parsed.code, C2S.setLineup);
    const side = this.seatOf(client);
    if (side === -1) return this.sendError(client, 'not-seated', C2S.setLineup);
    if (this.phase !== 'lobby') return this.sendError(client, 'match-already-started', C2S.setLineup);
    const seat = this.seats[side]!;
    const selection = resolveModeLineup(this.data, this.rules, parsed.value.lineup, { levels: parsed.value.levels });
    seat.lineup = selection.lineup;
    seat.levels = selection.levels;
    seat.ready = false;
    this.broadcastRoom();
  }

  private async handleReady(client: Client, raw: unknown): Promise<void> {
    const parsed = parseReady(raw);
    if (!parsed.ok) return this.sendError(client, parsed.code, C2S.ready);
    const side = this.seatOf(client);
    if (side === -1) return this.sendError(client, 'not-seated', C2S.ready);
    if (this.phase !== 'lobby') return this.sendError(client, 'match-already-started', C2S.ready);
    this.seats[side]!.ready = parsed.value.ready;
    const [a, b] = this.seats;
    if (a && b && a.connected && b.connected && a.ready && b.ready) await this.startMatch(a, b);
    else this.broadcastRoom();
  }

  private async startMatch(a: Seat, b: Seat): Promise<void> {
    const seed = randomInt(0x100000000), matchId = randomUUID();
    const st = createMatch(this.data, [a.lineup, b.lineup], { seed, levels: [a.levels, b.levels] });
    const turnEvents = beginTurn(st, this.data);
    if (this.accountSetup) {
      try {
        this.configurationHash = await this.accountSetup.recordStart({ matchId, roomCode: this.code, mode: this.accountSetup.mode, configVersion: this.data.version, rules: this.rules, participants: ([a, b] as const).map((seat, side) => ({ userId: seat.account!.userId, sessionId: seat.account!.authSessionId, side: side as Side, cards: seat.account!.snapshot.cards })) });
      } catch (error) {
        this.resetReady(); if (!this.disposed) this.broadcastRoom(); throw error;
      }
      if (this.disposed || this.seats[0] !== a || this.seats[1] !== b || !a.connected || !b.connected || !a.ready || !b.ready) {
        await this.accountSetup.recordClose(matchId, 'abandoned'); return;
      }
    }
    this.revision = 0;
    this.receipts = new ShotReceipts();
    this.seed = seed; this.matchId = matchId; this.seq = 0;
    this.startedAt = this.time.nowMs();
    if (this.accountSetup) this.unsubscribeSettlement = this.accountSetup.subscribeOutcome(matchId, (receipt) => this.onSettlement(receipt));
    this.accepted.clear();
    this.match = st;
    this.phase = 'playing';
    // The room has to outlive its clients: a dropped seat can come back, and the clocks keep running with nobody connected.
    this.autoDispose = false;
    this.startClocks(this.timing.matchMs, this.timing.turnMs);

    this.broadcastRoom();
    const start: MatchStartMsg = { ...this.matchInfo(), ...this.stamp(), state: this.wireState(), turnEvents, clocks: this.clocks() };
    this.broadcast(S2C.matchStart, start);
    this.persist();
  }

  /**
   * Validation order is part of the protocol (docs/online.md). Anything that fails leaves the authoritative state
   * untouched: the shot is resolved on a clone that replaces `this.match` only after resolveShot() returned.
   */
  private async handleShot(client: Client, raw: unknown, received: { revision: number; at: number }): Promise<void> {
    const parsed = parseShotMessage(raw, this.protocol());
    if (!parsed.ok) return this.sendError(client, parsed.code, C2S.shot);
    const msg = parsed.value;
    const ref = msg.clientShotId;
    const side = this.seatOf(client);
    if (side === -1) return this.sendError(client, 'not-seated', C2S.shot, ref);
    const st = this.match;
    if (this.phase === 'lobby' || !st) return this.sendError(client, 'match-not-started', C2S.shot, ref);
    if (msg.matchId !== this.matchId) return this.sendError(client, 'stale-match', C2S.shot, ref);
    const key = `${side}:${ref}`;
    const actor = this.seats[side]!.actorId;
    const found = this.receipts.lookup(actor, msg);
    if (found.kind === 'conflict') return this.sendError(client, 'shot-conflict', C2S.shot, ref);
    if (found.kind === 'same') {
      if (this.accountSetup && this.match?.over && !this.settlementReceipt.recoverable) { this.broadcastSettlement(); return; }
      if (this.accountSetup) client.send(S2C.shotAck, { ...this.stamp(), matchId: this.matchId, clientShotId: ref, seq: found.receipt.seq, acceptedRevision: found.receipt.revision, duplicate: true });
      else this.sendError(client, 'duplicate-shot', C2S.shot, ref, found.receipt.seq);
      return;
    }
    if (msg.configVersion !== this.data.version) return this.sendError(client, 'config-mismatch', C2S.shot, ref);
    // Legacy records without hashes can return their original sequence, but cannot claim a payload match.
    const prior = this.accepted.get(key);
    if (prior !== undefined) return this.sendError(client, 'duplicate-shot', C2S.shot, ref, prior);

    if (st.over || this.endPending) return this.sendError(client, 'match-over', C2S.shot, ref);
    if (msg.turnId !== st.shotNo) return this.sendError(client, 'stale-turn', C2S.shot, ref);
    if (received.revision !== this.revision || (this.accountSetup && msg.revision !== this.revision)) return this.sendError(client, this.accountSetup ? 'stale-state' : 'stale-turn', C2S.shot, ref);
    if (received.at >= this.matchDeadline) {
      if (this.matchTimer) clearTimeout(this.matchTimer);
      await this.onMatchClock(); return this.sendError(client, 'match-over', C2S.shot, ref);
    }
    if (this.turnDeadline !== null && received.at >= this.turnDeadline) {
      if (this.turnTimer) clearTimeout(this.turnTimer);
      await this.onTurnTimeout(); return this.sendError(client, 'stale-turn', C2S.shot, ref);
    }
    const verdict = validateShot(st, this.data, side, msg.input);
    if (verdict !== null) return this.sendError(client, isNetErrorCode(verdict) ? verdict : 'internal-error', C2S.shot, ref);

    const work = structuredClone(st);
    const epoch = this.epoch, revision = this.revision;
    const out = await this.simulateShot(work, this.data, msg.input);
    if (this.disposed || this.epoch !== epoch || this.revision !== revision || this.match !== st || this.phase !== 'playing') return;

    // The next turn only starts once the clients have played the shot back, so the turn clock gets that time on top.
    const playbackMs = Math.ceil((out.sim.frames.length / this.data.physics.recordHz) * 1000) + this.timing.playbackMarginMs;
    const state = structuredClone(work); state.rng = 0;
    const packet: ShotPacketMsg = {
      protocol: this.protocol(), revision: revision + 1,
      outcome: this.outcome(work, !!this.accountSetup),
      ...(work.over && this.accountSetup ? { settlement: { status: 'recorded' as const, recorded: false } } : {}),
      matchId: this.matchId,
      seat: side,
      clientShotId: ref,
      seq: this.seq + 1,
      input: msg.input,
      ids: out.sim.ids,
      frames: out.sim.frames,
      recordHz: this.data.physics.recordHz,
      simEvents: out.sim.events,
      events: out.events,
      turnEvents: out.turnEvents,
      state,
      clocks: { turnMs: work.over ? null : playbackMs + this.timing.turnMs, matchMs: work.over ? 0 : Math.max(0, Math.ceil(this.matchDeadline - this.time.nowMs())) },
    };
    if (!boundedShotPacket(packet, Math.ceil(this.data.physics.maxSimSeconds * this.data.physics.recordHz) + 2)) return this.sendError(client, 'simulation-limit', C2S.shot, ref);
    this.receipts.accept(actor, msg, packet.seq, revision + 1);
    this.match = work; this.revision++; this.seq = packet.seq;
    this.accepted.set(key, this.seq);
    this.playbackUntil = this.time.nowMs() + playbackMs;
    if (!work.over) this.armTurn(playbackMs + this.timing.turnMs);
    if (work.over && this.accountSetup) {
      this.terminalMessage = { type: S2C.shotPacket, data: packet, ack: { side, ref } };
      await this.finishMatch(); return;
    }
    try {
      this.broadcast(S2C.shotPacket, packet);
      if (this.accountSetup) client.send(S2C.shotAck, { ...this.stamp(), matchId: this.matchId, clientShotId: ref, seq: this.seq, acceptedRevision: this.revision, duplicate: false });
    } finally {
      if (work.over) await this.finishMatch();
      else this.persist();
    }
  }

  private async handleSurrender(client: Client, raw: unknown): Promise<void> {
    const parsed = this.accountSetup ? SurrenderV2Schema.safeParse(raw) : null;
    if (this.accountSetup && !parsed?.success) return this.sendError(client, 'bad-message', C2S.surrender);
    if (!this.accountSetup) {
      const parsed = parseSurrender(raw);
      if (!parsed.ok) return this.sendError(client, parsed.code, C2S.surrender);
    }
    const side = this.seatOf(client);
    if (side === -1) return this.sendError(client, 'not-seated', C2S.surrender);
    const st = this.match;
    if (this.phase === 'lobby' || !st) return this.sendError(client, 'match-not-started', C2S.surrender);
    if (parsed?.success && parsed.data.matchId !== this.matchId) return this.sendError(client, 'stale-match', C2S.surrender);
    if (parsed?.success && parsed.data.configVersion !== this.data.version) return this.sendError(client, 'config-mismatch', C2S.surrender);
    if (this.phase === 'ended' || st.over) return this.sendError(client, 'match-over', C2S.surrender);
    await this.pushUpdate(this.apply((s) => forfeit(s, side, 'surrender')));
  }

  private async onTurnTimeout(): Promise<void> {
    this.turnTimer = null;
    const st = this.match;
    if (this.phase !== 'playing' || !st || st.over) return;
    const events = this.apply((s) => passTurn(s, this.data, 'timeout'));
    if (!this.match!.over) this.armTurn(this.timing.turnMs);
    await this.pushUpdate(events);
  }

  private async onMatchClock(): Promise<void> {
    this.matchTimer = null;
    const st = this.match;
    if (this.phase !== 'playing' || !st || st.over) return;
    const left = this.playbackUntil - this.time.nowMs();
    if (left > 0) {
      // A shot is still playing on the clients: the whistle waits for it, as in the local game.
      this.endPending = true;
      this.armMatch(left);
      return;
    }
    await this.pushUpdate(this.apply((s) => endByTime(s)));
  }

  private async onWindowExpired(side: Side): Promise<void> {
    const seat = this.seats[side];
    if (!seat) return;
    seat.window = null;
    seat.windowEnd = null;
    const st = this.match;
    if (this.phase !== 'playing' || seat.connected || !st || st.over) return;
    const other = this.seats[side === 0 ? 1 : 0];
    if (other?.connected) await this.pushUpdate(this.apply((s) => forfeit(s, side, 'disconnect')));
    else await this.abandon();
  }

  /** Runs `change` on a clone and keeps the result only if it did not throw. */
  private apply(change: (st: MatchState) => MatchEvent[]): MatchEvent[] {
    const work = structuredClone(this.match!);
    const events = change(work);
    this.match = work;
    this.revision++;
    return events;
  }

  /** A state change that is not a shot (timeout, surrender, forfeit, match clock). */
  private async pushUpdate(events: MatchEvent[]): Promise<void> {
    const update: UpdateMsg = { ...this.stamp(), matchId: this.matchId, events, state: this.wireState(), clocks: this.clocks(), outcome: this.outcome() };
    if (this.match!.over && this.accountSetup) {
      this.terminalMessage = { type: S2C.update, data: update };
      await this.finishMatch(); return;
    }
    try { this.broadcast(S2C.update, update); }
    finally {
      if (this.match!.over) await this.finishMatch();
      else this.persist();
    }
  }

  private async finishMatch(): Promise<void> {
    this.phase = 'ended';
    this.clearTimers();
    if (!this.accountSetup) { this.releaseEndedRoom(); return; }
    if (!this.terminalIntent) {
      const receipts = this.receipts.records(), st = this.match!;
      this.terminalIntent = OutcomeIntentSchema.parse({
        schemaVersion: 1, protocol: ACCOUNT_PROTOCOL_VERSION, matchId: this.matchId,
        mode: this.accountSetup.mode, configurationHash: this.configurationHash, configVersion: this.data.version,
        finalSeq: this.seq, score: st.score, winner: this.outcome(st, true)!.winner, reason: st.endReason,
        elapsedSeconds: Math.max(0, Math.floor((this.time.nowMs() - this.startedAt) / 1000)),
        endedAt: new Date(this.time.wallMs()).toISOString(),
        participants: this.seats.map((seat, side) => ({ userId: seat!.account!.userId, side,
          actions: receipts.filter((receipt) => receipt.actorId === seat!.actorId).length })),
      });
    }
    try { this.onSettlement(await this.accountSetup.recordOutcome(this.terminalIntent)); }
    catch (error) { this.onSettlement({ status: 'failed', recorded: false, recoverable: false }); throw error; }
  }

  private onSettlement(receipt: SettlementReceipt): void {
    if (this.disposed) return;
    this.settlementReceipt = receipt;
    if (!this.match?.over) return;
    try {
      if (receipt.recoverable && this.terminalMessage && !this.terminalMessageSent) {
        this.terminalMessageSent = true;
        this.terminalMessage.data.outcome = this.outcome();
        this.terminalMessage.data.settlement = { status: receipt.status, recorded: receipt.recorded };
        this.broadcast(this.terminalMessage.type, this.terminalMessage.data);
        const ack = this.terminalMessage.ack;
        if (ack) this.seats[ack.side]?.client?.send(S2C.shotAck, { ...this.stamp(), matchId: this.matchId, clientShotId: ack.ref, seq: this.seq, acceptedRevision: this.revision, duplicate: false });
      }
      this.broadcastSettlement();
    } finally { if (receipt.recorded) this.releaseEndedRoom(); }
  }
  private broadcastSettlement(): void {
    if (!this.accountSetup || this.disposed) return;
    const { status, recorded, recoverable } = this.settlementReceipt;
    this.broadcast(S2C.settlement, { ...this.stamp(), matchId: this.matchId, seq: this.seq, status, recorded, outcome: this.outcome(), ...(recoverable && this.match?.over ? { state: this.wireState(), clocks: { turnMs: null, matchMs: 0 } } : {}) });
  }

  private releaseEndedRoom(): void {
    if (this.disposed || this.endedReleased) return;
    this.endedReleased = true;
    // Nobody is kicked: the players stay to read the result and the room goes away with the last one. With nobody left, now.
    this.autoDispose = true;
    this.store?.remove(this.code);
    this.broadcastRoom();
    if (this.clients.length === 0) this.closeRoom();
  }

  /** Neither player came back in time: no result, nothing to resume. */
  private async abandon(): Promise<void> {
    if (this.accountSetup && this.match) {
      const work = structuredClone(this.match); work.over = true; work.winner = -1; work.endReason = 'abandoned';
      this.match = work; this.revision++;
      await this.finishMatch(); return;
    }
    this.phase = 'ended';
    this.clearTimers();
    try { await this.accountSetup?.recordClose(this.matchId, 'abandoned'); }
    finally {
      this.autoDispose = true;
      this.store?.remove(this.code);
      if (!this.disposed) this.closeRoom();
    }
  }

  private closeRoom(): void {
    this.disconnect().catch((err: unknown) => console.error('[MatchRoom] disconnect failed:', err instanceof Error ? err.message : String(err)));
  }

  private persist(): void {
    // NET-05 owns account snapshots. Never restore an account seat as a guest bearer-token seat.
    if (this.accountSetup) return;
    const st = this.match;
    const [a, b] = this.seats;
    if (!this.store || this.phase !== 'playing' || !st || !a || !b) return;
    const clocks = this.clocks();
    const recSeat = (s: Seat): RecordSeat => ({ actorId: s.actorId, nickname: s.nickname, token: s.token, lineup: s.lineup.slice(), levels: s.levels.slice() });
    this.store.save({
      modeRules: this.rules,
      format: ROOM_RECORD_FORMAT,
      code: this.code,
      skin: this.skin,
      configVersion: this.data.version,
      matchId: this.matchId,
      seed: this.seed,
      seq: this.seq,
      accepted: [...this.accepted],
      shotReceipts: this.receipts.records(),
      revision: this.revision,
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
      const selection = resolveModeLineup(this.data, this.rules, parsed.value.lineup, { levels: parsed.value.levels });
      if (selection.levels.some((level, slot) => level !== s.levels[slot]) ||
        rec.match.pieces.filter(p => p.side === i).some(p => p.playerId !== s.lineup[p.slot] || p.level !== selection.levels[p.slot]))
        throw fail(`seat ${i}: mode levels differ`);
      seats.push({
        actorId: s.actorId ?? `legacy-guest-${i}`,
        windowGeneration: 0,
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
    this.receipts = new ShotReceipts(rec.shotReceipts);
    this.revision = rec.revision ?? rec.seq;
    this.match = structuredClone(rec.match);
    this.seats = [seats[0]!, seats[1]!];
    this.phase = 'playing';
    this.autoDispose = false;
    this.startClocks(rec.clocks.matchMs, Math.min(rec.clocks.turnMs ?? this.timing.turnMs, this.timing.turnMs));
    // Nobody is connected after a restart: both players get a full window to find their way back.
    this.openWindow(0);
    this.openWindow(1);
  }

  private after(ms: number, run: () => void | Promise<void>, control: 'turn' | 'match' | 'window-0' | 'window-1'): NodeJS.Timeout {
    const epoch = this.epoch;
    const timer = setTimeout(() => {
      this.commands.submit(() => { if (!this.disposed && this.epoch === epoch) return run(); }, () => console.error('[MatchRoom] timer failed'), control);
    }, ms);
    timer.unref();
    return timer;
  }

  private startClocks(matchMs: number, turnMs: number): void {
    const t = this.time.nowMs();
    this.matchDeadline = t + matchMs;
    this.armMatch(matchMs);
    this.playbackUntil = t;
    this.endPending = false;
    this.armTurn(turnMs);
  }

  private armTurn(ms: number): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnDeadline = this.time.nowMs() + ms;
    const generation = ++this.turnGeneration;
    this.turnTimer = this.after(ms, () => { if (generation === this.turnGeneration) return this.onTurnTimeout(); }, 'turn');
  }

  private armMatch(ms: number): void {
    if (this.matchTimer) clearTimeout(this.matchTimer);
    const generation = ++this.matchGeneration;
    this.matchTimer = this.after(ms, () => { if (generation === this.matchGeneration) return this.onMatchClock(); }, 'match');
  }

  private openWindow(side: Side): void {
    const seat = this.seats[side];
    if (!seat) return;
    this.closeWindow(seat);
    seat.windowEnd = this.time.nowMs() + this.timing.reconnectMs;
    const generation = seat.windowGeneration;
    seat.window = this.after(this.timing.reconnectMs, () => { if (generation === seat.windowGeneration) return this.onWindowExpired(side); }, side === 0 ? 'window-0' : 'window-1');
  }

  private closeWindow(seat: Seat): void {
    seat.windowGeneration++;
    if (seat.window) clearTimeout(seat.window);
    seat.window = null;
    seat.windowEnd = null;
  }

  private clearTimers(): void {
    this.turnGeneration++; this.matchGeneration++;
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
      ...this.stamp(),
      rules: this.rules,
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
    return { ...this.matchInfo(), outcome: this.outcome(), seq: this.seq, state: this.wireState(), clocks: { turnMs, matchMs: c.matchMs }, ...(this.accountSetup && this.match?.over ? { settlement: this.publicSettlement() } : {}) };
  }

  private outcome(state = this.match, durable = this.settlementReceipt.recorded): ModeOutcome | undefined {
    if (!state?.over) return undefined;
    return classifyModeOutcome(this.rules, { authority: 'server', durable, accountsVerified: !!this.accountSetup,
      reason: state.endReason, winner: state.winner });
  }
  private publicSettlement() { return { status: this.settlementReceipt.status, recorded: this.settlementReceipt.recorded }; }

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
      revision: this.revision,
      identity: this.accountSetup ? 'account' : 'guest',
      rules: this.rules,
      outcome: this.outcome(),
      ...(this.accountSetup && this.match?.over ? { settlement: this.publicSettlement() } : {}),
      protocol: this.protocol(),
      code: this.code,
      configVersion: this.data.version,
      skin: this.skin,
      phase: this.phase,
      seats: [view(this.seats[0]), view(this.seats[1])],
      mySeat,
    };
    const mine = this.seats[mySeat];
    if (mine?.account) snap.account = { userId: mine.account.userId, lineupId: mine.account.snapshot.lineupId, revision: mine.account.snapshot.revision };
    else if (mine) snap.seatToken = mine.token;
    return snap;
  }

  private broadcastRoom(): void {
    for (const side of [0, 1] as const) {
      const seat = this.seats[side];
      if (seat?.connected && seat.client) seat.client.send(S2C.room, this.snapshot(side));
    }
  }

  private sendError(client: Client, code: NetErrorCode, on?: ClientMessageType, ref?: string, seq?: number): void {
    const msg: ErrorMsg = { ...this.stamp(), code };
    if (on !== undefined) msg.on = on;
    if (ref !== undefined) msg.ref = ref;
    if (seq !== undefined) msg.seq = seq;
    client.send(S2C.error, msg);
  }
}
