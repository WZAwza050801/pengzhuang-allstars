import { Client, type Room } from 'colyseus.js';
import { DEFAULT_DATA } from '../../shared/data';
import { rulesForMode, verifyModeRules } from '../../config/modes';
import type { GuestMode, ModeRules } from '../../packages/contracts/src/modes';
import type { MatchEvent, MatchState, ShotInput } from '../../shared/match';
import type { Side } from '../../shared/physics';
import {
  C2S,
  PROTOCOL_VERSION,
  ACCOUNT_PROTOCOL_VERSION,
  ROOM_NAME,
  S2C,
  type ErrorMsg,
  type MatchStartMsg,
  type ResumeMsg,
  type RoomSnapshot,
  type ShotPacketMsg,
  type ShotAckMsg,
  type UpdateMsg,
  type MatchSettlementMsg,
  type SettlementInfo,
} from '../../shared/protocol';
import type { HostListener, MatchHost, SeatInfo, ShotPacket } from './host';
import type { MatchTicketResult } from '../../packages/contracts/src/match-tickets';
import type { AccountResponse } from '../../packages/client-model/src/account';
import { RoomJoinError } from '../../packages/client-model/src/room';
import { boundedShotPacket } from '../../packages/contracts/src/match-wire';

/**
 * The server owns every rule decision. This client only sends intents and renders what comes back.
 *
 * Two ways in:
 *  - `createRoom` asks the server for a fresh 6-character code (the server picks it, the client never guesses).
 *  - `joinRoom` takes that code and sits down in the free seat.
 *
 * Losing the connection in the middle of a match is expected (phone sleeps, wifi changes). The server keeps the
 * seat alive for `reconnectSeconds`; the client retries with the seat token it was given, and the server hands
 * back the whole board in a `resume` message.
 */

const RECONNECT_DELAYS_MS = [400, 900, 1800, 3200, 5000, 8000];

export type OnlineStatus = 'connecting' | 'lobby' | 'playing' | 'ended' | 'reconnecting' | 'closed';

export interface OnlineHostOptions {
  account?: { userId: string; issueTicket(code?: string): Promise<AccountResponse<MatchTicketResult>> };
  mode?: GuestMode;
  /** `ws://host:port` of the Colyseus server. Empty string means "same origin" (the built-in server hosts the page). */
  serverUrl?: string;
  nickname: string;
  skin?: string;
  /** 6-character room code; omit to create a new room. */
  code?: string;
}

export interface OnlineStatusListener {
  (status: OnlineStatus, detail?: string): void;
}
export class OnlineHost implements MatchHost {
  private readonly account: OnlineHostOptions['account'];
  private pendingShot: string | null = null;
  private settlement: SettlementInfo | null = null;
  private settlementListener: ((info: SettlementInfo) => void) | null = null;
  onSettlement(cb: (info: SettlementInfo) => void): () => void {
    this.settlementListener = cb;
    if (this.settlement) cb(this.settlement);
    return () => { if (this.settlementListener === cb) this.settlementListener = null; };
  }
  private applySettlement(info: SettlementInfo | undefined): void {
    if (!this.account || !info || this.settlement?.status === 'settled' || (this.settlement?.recorded && !info.recorded)) return;
    this.settlement = info;
    this.settlementListener?.(info);
  }
  private authorizationReady = true;
  private reconnectUntil = 0;
  private revision = -1;
  private lastShotSeq = 0;
  private modeRules: ModeRules | undefined;
  get rules(): ModeRules | undefined { return this.modeRules; }
  private readonly requestedMode: GuestMode;
  private lastSnapshot: RoomSnapshot | null = null;
  readonly mySides: Side[];
  private seat: Side = 0;
  get viewSide(): Side { return this.seat; }
  readonly seats: [SeatInfo, SeatInfo];

  private roomCode = '';
  /** The 6-character code the server assigned. Only known after a successful join. */
  get code(): string {
    return this.roomCode;
  }

  private readonly client: Client;
  private room: Room | null = null;
  private listener: HostListener | null = null;
  private readonly statusListener: OnlineStatusListener | null;
  private status: OnlineStatus = 'connecting';

  /** Seat token the server gave us: it is what makes a reconnection possible after a drop. */
  private seatToken: string | null = null;
  /** Colyseus' own reconnection token: `roomId:token`, used for the transport-level reconnect. */
  private reconnectionToken: string | null = null;

  private state: MatchState | null = null;
  private matchId = '';
  get endedMatchId(): string | null { return (this.state?.over || this.lastSnapshot?.phase === 'ended') ? this.matchId || null : null; }
  private configVersion = DEFAULT_DATA.version;
  private turnDeadlineAt: number | null = null;
  private matchDeadlineAt: number | null = null;
  private reconnecting = false;
  private disposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  /** Called once, when the server starts the match: the UI switches from the waiting room to the game view. */
  private matchReadyListener: (() => void) | null = null;
  /** Called on every room snapshot: the waiting room uses it to show when the opponent has arrived. */
  private roomSnapshotListener: ((snap: RoomSnapshot) => void) | null = null;

  /** Registers the "the match has started" callback. The UI uses it to leave the waiting room. */
  onMatchReady(cb: () => void): void {
    this.matchReadyListener = cb;
  }

  /** Registers the "the room changed" callback (opponent joined, ready flags, phase). */
  onRoomSnapshot(cb: (snap: RoomSnapshot) => void): void {
    this.roomSnapshotListener = cb;
    if (this.lastSnapshot) cb(this.lastSnapshot);
  }

  /** The server pushes the whole clock with every message; the client converts it into a local deadline. */
  private applyClocks(turnMs: number | null, matchMs: number): void {
    const now = Date.now();
    this.turnDeadlineAt = turnMs === null ? null : now + turnMs;
    this.matchDeadlineAt = matchMs > 0 ? now + matchMs : null;
  }

  constructor(opts: OnlineHostOptions, statusListener?: OnlineStatusListener) {
    this.account = opts.account;
    this.requestedMode = opts.mode ?? 'friend';
    this.pendingNickname = opts.nickname;
    this.statusListener = statusListener ?? null;
    const base = (opts.serverUrl ?? '').replace(/\/$/, '');
    this.client = new Client(base || undefined);
    this.mySides = [0];
    this.seats = [
      { name: opts.nickname, isBot: false, connected: false },
      { name: '等待中…', isBot: false, connected: false },
    ];
    this.roomCode = opts.code ?? '';
  }

  /** Connects to the server and returns the room code. Must be awaited before `start()`. */
  async connect(): Promise<string> {
    if (this.disposed) throw new RoomJoinError('ACCOUNT_CHANGED');
    const opts = { protocol: PROTOCOL_VERSION, nickname: this.pendingNickname, mode: this.requestedMode };
    this.setStatus('connecting');
    const room = this.account ? await this.joinAccount() : this.code
      ? await this.client.joinById(this.code, opts)
      : await this.client.joinOrCreate(ROOM_NAME, opts);
    if (this.disposed) { void room.leave(true); throw new RoomJoinError('ACCOUNT_CHANGED'); }
    this.room = room;
    this.reconnectionToken = room.reconnectionToken ?? null;
    this.bindRoom(room);
    // The code only exists once the server has accepted the join.
    this.roomCode = room.roomId ?? this.roomCode;
    this.setStatus('lobby');
    return this.roomCode;
  }

  private async joinAccount(): Promise<Room> {
    if (!this.account || this.disposed) throw new RoomJoinError('ACCOUNT_CHANGED');
    if (!this.authorizationReady) throw new RoomJoinError('UNAVAILABLE', true);
    const result = await this.account.issueTicket(this.code || undefined);
    if (!result.ok) throw new RoomJoinError(result.error.code, result.error.retryable);
    if (this.disposed) throw new RoomJoinError('ACCOUNT_CHANGED');
    if (!this.authorizationReady) throw new RoomJoinError('UNAVAILABLE', true);
    const ticket = result.data;
    if (this.state?.over) throw new RoomJoinError('NOT_FOUND');
    if (ticket.mode !== 'friend' || ticket.configVersion !== DEFAULT_DATA.version || (this.code && this.code !== ticket.roomCode)) throw new RoomJoinError('INVALID_RESPONSE');
    this.roomCode = ticket.roomCode;
    const room = await this.client.joinById(ticket.roomCode, { protocol: ACCOUNT_PROTOCOL_VERSION, ticket: ticket.ticket });
    if (this.disposed) { void room.leave(true); throw new RoomJoinError('ACCOUNT_CHANGED'); }
    return room;
  }

  setAuthorizationReady(ready: boolean): void { this.authorizationReady = ready; }
  inputStatus(): 'ready' | 'pending' | 'reconnecting' | 'closed' {
    if (!this.authorizationReady || this.status === 'reconnecting' || this.status === 'connecting') return 'reconnecting';
    if (this.disposed || this.status === 'closed') return 'closed';
    return this.pendingShot || this.settlement ? 'pending' : 'ready';
  }
  synchronize(): void { if (!this.disposed && this.account && this.status !== 'reconnecting') this.scheduleReconnect(); }

  /**
   * Submits the lineup and marks the seat ready. The server only starts the match when both seats are ready,
   * so this is what actually kicks the game off.
   */
  submitLineup(lineup: string[], levels?: number[]): void {
    if (this.account) return;
    this.room?.send(C2S.setLineup, levels ? { lineup, levels } : { lineup });
  }

  /** Marks this seat ready. The match starts once the other player is ready too. */
  setReady(ready: boolean): void {
    if (!this.authorizationReady || this.status !== 'lobby') return;
    this.room?.send(C2S.ready, { ready });
  }

  private pendingNickname = '';
  private pendingSkin: string | undefined;

  /** Sets what `connect()` sends. Kept separate so the constructor stays side-effect free. */
  configure(nickname: string, skin?: string): void {
    this.pendingNickname = nickname;
    this.pendingSkin = skin;
  }

  private bindRoom(room: Room): void {
    const receive = <T>(handle: (message: T) => void) => (message: T) => { if (!this.disposed && this.room === room) handle(message); };
    room.onMessage(S2C.room, receive((msg: RoomSnapshot) => this.applyRoomSnapshot(msg)));
    room.onMessage(S2C.matchStart, receive((msg: MatchStartMsg) => this.onMatchStart(msg)));
    room.onMessage(S2C.shotPacket, receive((msg: ShotPacketMsg) => this.onShotPacket(msg)));
    room.onMessage(S2C.update, receive((msg: UpdateMsg) => this.onUpdate(msg)));
    room.onMessage(S2C.resume, receive((msg: ResumeMsg) => this.onResume(msg)));
    room.onMessage(S2C.error, receive((msg: ErrorMsg) => this.onError(msg)));
    room.onMessage(S2C.shotAck, receive((msg: ShotAckMsg) => this.onShotAck(msg)));
    room.onMessage(S2C.settlement, receive((msg: MatchSettlementMsg) => this.onMatchSettlement(msg)));
    room.onLeave((code: number) => {
      // A consented leave is our own doing; anything else means the socket dropped.
      if (this.disposed || this.room !== room) return;
      if (this.account && this.endedMatchId) { this.stopReconnectAfterEnd(); return; }
      if (code === 1000 || code === 4000) {
        this.setStatus('closed');
        return;
      }
      this.scheduleReconnect();
    });
    room.onError((code: number, message?: string) => {
      if (this.disposed || this.room !== room) return;
      this.listener?.onInfo?.(`联机错误 ${code}：${message ?? ''}`);
    });
  }

  private setStatus(status: OnlineStatus, detail?: string): void {
    this.status = status;
    this.statusListener?.(status, detail);
  }
  private stopReconnectAfterEnd(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null; this.reconnecting = false;
    this.setStatus('ended');
  }

  private applyRoomSnapshot(snap: RoomSnapshot): void {
    if (this.account && (!this.validStamp(snap) || snap.revision! < this.revision)) return;
    if (this.account && (snap.identity !== 'account' || snap.account?.userId !== this.account.userId)) {
      this.setStatus('closed', '账号信息不匹配，请返回大厅重新登录');
      void this.room?.leave(true); return;
    }
    if (!this.acceptRules(snap.rules, snap.configVersion)) return;
    this.seat = snap.mySeat;
    this.mySides.splice(0, this.mySides.length, snap.mySeat);
    this.lastSnapshot = snap;
    this.applySettlement(snap.settlement);
    if (this.account && snap.phase === 'ended') this.stopReconnectAfterEnd();
    if (snap.seatToken) this.seatToken = snap.seatToken;
    for (const side of [0, 1] as const) {
      const s = snap.seats[side];
      this.seats[side] = {
        reconnectDeadline: s?.reconnectMs === undefined ? undefined : Date.now() + s.reconnectMs,
        name: s?.nickname ?? (side === 0 ? this.pendingNickname : '等待中…'),
        isBot: false,
        connected: s?.connected ?? false,
      };
    }
    if (snap.phase === 'lobby' && (this.status === 'connecting' || this.status === 'reconnecting')) {
      this.reconnecting = false; this.reconnectAttempt = 0; this.setStatus('lobby');
    }
    this.roomSnapshotListener?.(snap);
  }

  private onMatchStart(msg: MatchStartMsg): void {
    if (!this.acceptRules(msg.rules, msg.configVersion)) return;
    if (!this.acceptStateStamp(msg, this.state === null)) return;
    this.matchId = msg.matchId;
    this.configVersion = msg.configVersion;
    this.state = msg.state;
    this.applyClocks(msg.clocks.turnMs, msg.clocks.matchMs);
    this.setStatus('playing');
    this.matchReadyListener?.();
    this.listener?.onState(msg.state);
    if (msg.turnEvents.length) this.listener?.onEvents(msg.turnEvents);
  }

  private onShotPacket(msg: ShotPacketMsg): void {
    if (!boundedShotPacket(msg)) { this.setStatus('closed', '比赛回放超过安全体积或格式不兼容'); void this.room?.leave(true); return; }
    if (!this.acceptStateStamp(msg)) return;
    this.lastShotSeq = Math.max(this.lastShotSeq, msg.seq);
    this.pendingShot = null;
    this.matchId = msg.matchId;
    this.state = msg.state;
    this.applyClocks(msg.clocks.turnMs, msg.clocks.matchMs);
    const packet: ShotPacket = {
      seq: msg.seq,
      input: msg.input,
      ids: msg.ids,
      frames: msg.frames,
      recordHz: msg.recordHz,
      simEvents: msg.simEvents,
      events: msg.events,
      turnEvents: msg.turnEvents,
      state: msg.state,
    };
    this.listener?.onShot(packet);
    this.applySettlement(msg.settlement);
    if (msg.state.over) this.stopReconnectAfterEnd();
  }

  private onUpdate(msg: UpdateMsg): void {
    if (!this.acceptStateStamp(msg)) return;
    this.pendingShot = null;
    this.matchId = msg.matchId;
    this.state = msg.state;
    this.applyClocks(msg.clocks.turnMs, msg.clocks.matchMs);
    if (msg.events.length) this.listener?.onEvents(msg.events);
    this.listener?.onState(msg.state);
    this.applySettlement(msg.settlement);
    if (msg.state.over) {
      this.stopReconnectAfterEnd();
    }
  }

  private onResume(msg: ResumeMsg): void {
    const firstState = this.state === null;
    if (!this.acceptRules(msg.rules, msg.configVersion)) return;
    if (!this.acceptStateStamp(msg, true)) return;
    this.pendingShot = null;
    this.matchId = msg.matchId;
    this.configVersion = msg.configVersion;
    this.state = msg.state;
    this.lastShotSeq = Math.max(this.lastShotSeq, msg.seq);
    this.applyClocks(msg.clocks.turnMs, msg.clocks.matchMs);
    this.reconnecting = false;
    this.reconnectAttempt = 0;
    this.setStatus(msg.state.over ? 'ended' : 'playing');
    this.listener?.onReset?.();
    this.listener?.onState(msg.state);
    this.listener?.onInfo?.('已重新连接，局面已恢复');
    if (firstState) this.matchReadyListener?.();
    this.applySettlement(msg.settlement);
  }

  private onMatchSettlement(msg: MatchSettlementMsg): void {
    if (!this.account || !this.validStamp(msg) || msg.matchId !== this.matchId || msg.revision! < this.revision || !['pending', 'recorded', 'settled', 'failed'].includes(msg.status) || typeof msg.recorded !== 'boolean') return;
    // A status alone must not consume the revision of a terminal packet still in flight.
    if (msg.state?.over && msg.clocks && msg.revision! > this.revision) this.onUpdate({ ...msg, state: msg.state, clocks: msg.clocks, events: [] });
    this.applySettlement({ status: msg.status, recorded: msg.recorded });
  }

  private onError(msg: ErrorMsg): void {
    if (this.account && (!this.validStamp(msg) || msg.revision! < this.revision)) return;
    if (msg.on === C2S.shot && (!msg.ref || msg.ref === this.pendingShot)) this.pendingShot = null;
    this.listener?.onInfo?.(`服务端拒绝了操作：${msg.code}`);
    if (this.account && msg.code === 'stale-state') this.synchronize();
  }

  private validStamp(msg: { protocol?: number; revision?: number }): boolean {
    if (!this.account) return true;
    if (msg.protocol === ACCOUNT_PROTOCOL_VERSION && Number.isSafeInteger(msg.revision) && msg.revision! >= 0) return true;
    this.setStatus('closed', '对战协议不兼容，请更新客户端');
    void this.room?.leave(true); return false;
  }
  private acceptStateStamp(msg: { protocol?: number; revision?: number; matchId: string }, reset = false): boolean {
    if (!this.account) return true;
    if (!this.validStamp(msg) || (this.matchId && msg.matchId !== this.matchId)) return false;
    if (msg.revision! < this.revision || (!reset && msg.revision === this.revision)) return false;
    this.revision = msg.revision!; return true;
  }
  private onShotAck(msg: ShotAckMsg): void {
    if (!this.account || !this.validStamp(msg) || msg.matchId !== this.matchId || !Number.isSafeInteger(msg.seq) || msg.seq < 1 || !Number.isSafeInteger(msg.acceptedRevision) || msg.acceptedRevision < 1 || msg.acceptedRevision > msg.revision!) return;
    if (msg.clientShotId === this.pendingShot && msg.seq > this.lastShotSeq) this.synchronize();
  }

  private acceptRules(input: ModeRules | undefined, dataVersion: string): boolean {
    try {
      if (dataVersion !== DEFAULT_DATA.version) throw new Error('Game data mismatch');
      this.modeRules = input ? verifyModeRules(DEFAULT_DATA, input) : rulesForMode(DEFAULT_DATA, 'practice');
      return true;
    } catch {
      this.setStatus('closed', '对局规则版本不兼容，请更新后重试');
      this.listener?.onInfo?.('对局规则版本不兼容，请更新后重试');
      void this.room?.leave(true);
      return false;
    }
  }

  /**
   * The socket died but the match is still ours for a while. Try the transport-level reconnect first (the server
   * kept the seat reserved), then fall back to a fresh join carrying the seat token.
   */
  private scheduleReconnect(): void {
    if (this.disposed) return;
    if (this.account && this.endedMatchId) { this.stopReconnectAfterEnd(); return; }
    if (this.reconnecting || this.state?.over) return;
    this.reconnecting = true;
    if (this.reconnectAttempt === 0) this.reconnectUntil = Date.now() + (this.modeRules?.reconnectSeconds ?? 60) * 1000;
    this.setStatus('reconnecting');
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => void this.tryReconnect(), delay);
  }

  private async tryReconnect(): Promise<void> {
    if (this.disposed || this.state?.over) return;
    if (this.account) {
      try {
        const room = await this.joinAccount();
        this.room = room;
        this.bindRoom(room);
        return;
      } catch (error) {
        this.reconnecting = false;
        if (this.state?.over) { this.setStatus('ended'); return; }
        if (Date.now() < this.reconnectUntil && (!(error instanceof RoomJoinError) || error.retryable)) { this.scheduleReconnect(); return; }
        this.setStatus('closed', error instanceof RoomJoinError ? error.message : '连接中断，请返回大厅');
        return;
      }
    }
    const token = this.reconnectionToken;
    if (token) {
      try {
        const room = await this.client.reconnect(token);
        if (this.disposed) { void room.leave(true); return; }
        this.room = room;
        this.reconnectionToken = room.reconnectionToken ?? token;
        this.bindRoom(room);
        this.reconnecting = false;
        this.reconnectAttempt = 0;
        // The server answers a reconnect with `resume`; until it does we stay in "reconnecting".
        this.setStatus('reconnecting');
        return;
      } catch {
        // Fall through to the seat-token join below.
      }
    }
    if (this.seatToken && this.code) {
      try {
        const room = await this.client.joinById(this.code, {
          protocol: PROTOCOL_VERSION,
          nickname: this.pendingNickname,
          seatToken: this.seatToken,
        });
        if (this.disposed) { void room.leave(true); return; }
        this.room = room;
        this.reconnectionToken = room.reconnectionToken ?? null;
        this.bindRoom(room);
        this.reconnecting = false;
        this.reconnectAttempt = 0;
        this.setStatus('reconnecting');
        return;
      } catch {
        // The reconnect window closed: the match is gone.
      }
    }
    this.reconnecting = false;
    this.setStatus('closed', '与服务器的连接已断开，重连窗口已过');
    this.listener?.onInfo?.('与服务器的连接已断开，重连窗口已过');
  }

  // --- MatchHost ---------------------------------------------------------------

  start(l: HostListener): void {
    this.listener = l;
    if (this.state) l.onState(this.state);
  }

  shoot(input: ShotInput): void {
    if (this.inputStatus() !== 'ready') return;
    const room = this.room;
    if (!room || !this.state) return;
    if (this.state.turn !== this.viewSide) {
      this.listener?.onInfo?.('还没轮到你');
      return;
    }
    if (this.state.over) return;
    // The turn id is the shot number the client has seen: the server rejects anything else.
    const shotId = randomClientShotId();
    this.pendingShot = shotId;
    room.send(C2S.shot, {
      ...(this.account ? { protocol: ACCOUNT_PROTOCOL_VERSION, revision: this.revision } : {}),
      matchId: this.matchId,
      turnId: this.state.shotNo,
      clientShotId: shotId,
      configVersion: this.configVersion,
      input,
    });
  }

  /** The server owns the clock, so there is nothing to release locally. */
  playbackDone(): void {
    /* no-op: the server pushes the next turn itself */
  }

  turnDeadline(): number | null {
    return this.turnDeadlineAt;
  }

  matchDeadline(): number | null {
    return this.matchDeadlineAt;
  }

  surrender(): void {
    if (this.inputStatus() !== 'ready' || this.status !== 'playing') return;
    this.room?.send(C2S.surrender, this.account ? { protocol: ACCOUNT_PROTOCOL_VERSION, matchId: this.matchId, configVersion: this.configVersion } : {});
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      if (this.room && this.room.connection?.isOpen !== false) this.room.leave(true);
    } catch {
      /* the socket may already be gone */
    }
    this.room = null;
    this.listener = null;
    this.roomSnapshotListener = null;
    this.matchReadyListener = null;
    this.settlementListener = null;
  }
}

/** Client-side id: only has to be unique enough to dedupe a resend of the same intent. */
function randomClientShotId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
