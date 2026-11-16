import { Client, type Room } from 'colyseus.js';
import { DEFAULT_DATA } from '../../shared/data';
import type { MatchEvent, MatchState, ShotInput } from '../../shared/match';
import type { Side } from '../../shared/physics';
import {
  C2S,
  PROTOCOL_VERSION,
  ROOM_NAME,
  S2C,
  type ErrorMsg,
  type MatchStartMsg,
  type ResumeMsg,
  type RoomSnapshot,
  type ShotPacketMsg,
  type UpdateMsg,
} from '../../shared/protocol';
import type { HostListener, MatchHost, SeatInfo, ShotPacket } from './host';

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
  readonly mySides: Side[];
  readonly viewSide: Side = 0;
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
  }

  /** The server pushes the whole clock with every message; the client converts it into a local deadline. */
  private applyClocks(turnMs: number | null, matchMs: number): void {
    const now = Date.now();
    this.turnDeadlineAt = turnMs === null ? null : now + turnMs;
    this.matchDeadlineAt = matchMs > 0 ? now + matchMs : null;
  }

  constructor(opts: OnlineHostOptions, statusListener?: OnlineStatusListener) {
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
    const opts = { protocol: PROTOCOL_VERSION, nickname: this.pendingNickname };
    this.setStatus('connecting');
    const room = this.code
      ? await this.client.joinById(this.code, opts)
      : await this.client.joinOrCreate(ROOM_NAME, opts);
    this.room = room;
    this.reconnectionToken = room.reconnectionToken ?? null;
    this.bindRoom(room);
    // The code only exists once the server has accepted the join.
    this.roomCode = room.roomId ?? this.roomCode;
    this.setStatus('lobby');
    return this.roomCode;
  }

  /**
   * Submits the lineup and marks the seat ready. The server only starts the match when both seats are ready,
   * so this is what actually kicks the game off.
   */
  submitLineup(lineup: string[], levels?: number[]): void {
    this.room?.send(C2S.setLineup, levels ? { lineup, levels } : { lineup });
  }

  /** Marks this seat ready. The match starts once the other player is ready too. */
  setReady(ready: boolean): void {
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
    room.onMessage(S2C.room, (msg: RoomSnapshot) => this.applyRoomSnapshot(msg));
    room.onMessage(S2C.matchStart, (msg: MatchStartMsg) => this.onMatchStart(msg));
    room.onMessage(S2C.shotPacket, (msg: ShotPacketMsg) => this.onShotPacket(msg));
    room.onMessage(S2C.update, (msg: UpdateMsg) => this.onUpdate(msg));
    room.onMessage(S2C.resume, (msg: ResumeMsg) => this.onResume(msg));
    room.onMessage(S2C.error, (msg: ErrorMsg) => this.onError(msg));
    room.onLeave((code: number) => {
      // A consented leave is our own doing; anything else means the socket dropped.
      if (this.disposed) return;
      if (code === 1000 || code === 4000) {
        this.setStatus('closed');
        return;
      }
      this.scheduleReconnect();
    });
    room.onError((code: number, message?: string) => {
      this.listener?.onInfo?.(`联机错误 ${code}：${message ?? ''}`);
    });
  }

  private setStatus(status: OnlineStatus, detail?: string): void {
    this.status = status;
    this.statusListener?.(status, detail);
  }

  private applyRoomSnapshot(snap: RoomSnapshot): void {
    if (snap.seatToken) this.seatToken = snap.seatToken;
    for (const side of [0, 1] as const) {
      const s = snap.seats[side];
      this.seats[side] = {
        name: s?.nickname ?? (side === 0 ? this.pendingNickname : '等待中…'),
        isBot: false,
        connected: s?.connected ?? false,
      };
    }
    if (snap.phase === 'lobby' && this.status === 'connecting') this.setStatus('lobby');
    this.roomSnapshotListener?.(snap);
  }

  private onMatchStart(msg: MatchStartMsg): void {
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
  }

  private onUpdate(msg: UpdateMsg): void {
    this.matchId = msg.matchId;
    this.state = msg.state;
    this.applyClocks(msg.clocks.turnMs, msg.clocks.matchMs);
    if (msg.events.length) this.listener?.onEvents(msg.events);
    this.listener?.onState(msg.state);
    if (msg.state.over) this.setStatus('ended');
  }

  private onResume(msg: ResumeMsg): void {
    this.matchId = msg.matchId;
    this.configVersion = msg.configVersion;
    this.state = msg.state;
    this.applyClocks(msg.clocks.turnMs, msg.clocks.matchMs);
    this.reconnecting = false;
    this.reconnectAttempt = 0;
    this.setStatus(msg.state.over ? 'ended' : 'playing');
    this.listener?.onState(msg.state);
    this.listener?.onInfo?.('已重新连接，局面已恢复');
  }

  private onError(msg: ErrorMsg): void {
    this.listener?.onInfo?.(`服务端拒绝了操作：${msg.code}`);
  }

  /**
   * The socket died but the match is still ours for a while. Try the transport-level reconnect first (the server
   * kept the seat reserved), then fall back to a fresh join carrying the seat token.
   */
  private scheduleReconnect(): void {
    if (this.disposed || this.reconnecting) return;
    this.reconnecting = true;
    this.setStatus('reconnecting');
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => void this.tryReconnect(), delay);
  }

  private async tryReconnect(): Promise<void> {
    if (this.disposed) return;
    const token = this.reconnectionToken;
    if (token) {
      try {
        const room = await this.client.reconnect(token);
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
    const room = this.room;
    if (!room || !this.state) return;
    if (this.state.turn !== this.viewSide) {
      this.listener?.onInfo?.('还没轮到你');
      return;
    }
    if (this.state.over) return;
    // The turn id is the shot number the client has seen: the server rejects anything else.
    room.send(C2S.shot, {
      matchId: this.matchId,
      turnId: this.state.shotNo,
      clientShotId: randomClientShotId(),
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
    this.room?.send(C2S.surrender, {});
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      this.room?.leave(true);
    } catch {
      /* the socket may already be gone */
    }
    this.room = null;
    this.listener = null;
  }
}

/** Client-side id: only has to be unique enough to dedupe a resend of the same intent. */
function randomClientShotId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
