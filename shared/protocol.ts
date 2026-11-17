import type { MatchEvent, MatchState, ShotInput } from './match';
import type { Side, SimEvent } from './physics';
import type { ModeId, ModeRules, ModeOutcome } from '../packages/contracts/src/modes';

export const PROTOCOL_VERSION = 1;
export const ROOM_NAME = 'match';
export const QUEUE_ROOM_NAME = 'queue';
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_CLIENT_MESSAGE_BYTES = 2048;
export const MAX_NICKNAME_LENGTH = 16;
export const MAX_ID_LENGTH = 64;

export const C2S = { setLineup: 'set_lineup', ready: 'ready', shot: 'shot', surrender: 'surrender' } as const;
export type ClientMessageType = (typeof C2S)[keyof typeof C2S];

export const S2C = {
  room: 'room',
  matchStart: 'match_start',
  shotPacket: 'shot_packet',
  update: 'update',
  resume: 'resume',
  error: 'error',
} as const;

/** The waiting queue is a separate room type: it only pairs players, it never runs a match. */
export const QUEUE_C2S = { cancel: 'queue_cancel' } as const;
export type QueueClientMessageType = (typeof QUEUE_C2S)[keyof typeof QUEUE_C2S];
export const QUEUE_S2C = { queued: 'queued', matched: 'matched', cancelled: 'queue_cancelled' } as const;

export const SEAT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export const NET_ERROR_CODES = [
  'bad-message',
  'rate-limited',
  'internal-error',
  'protocol-mismatch',
  'bad-nickname',
  'bad-skin',
  'bad-lineup',
  'bad-level',
  'not-seated',
  'match-not-started',
  'match-already-started',
  'stale-match',
  'config-mismatch',
  'duplicate-shot',
  'stale-turn',
  // pass-through of shared/match.ts validateShot()
  'match-over',
  'not-your-turn',
  'no-such-piece',
  'not-your-piece',
  'piece-off-pitch',
  'piece-frozen',
  'bad-number',
  'bad-direction',
  'bad-power',
  'bad-curve',
  'bad-seat-token',
] as const;
export type NetErrorCode = (typeof NET_ERROR_CODES)[number];

export function isNetErrorCode(v: unknown): v is NetErrorCode {
  return typeof v === 'string' && (NET_ERROR_CODES as readonly string[]).includes(v);
}

export interface CreateRoomOptions {
  protocol: number;
  nickname: string;
  skin?: string;
  mode?: ModeId;
}

/** `seatToken` (from a previous RoomSnapshot) re-claims a seat after a dropped connection; without it the join takes a free lobby seat. */
export interface JoinRoomOptions {
  protocol: number;
  nickname: string;
  seatToken?: string;
}

export interface QueueJoinOptions {
  protocol: number;
  nickname: string;
}

/** `position` is 1-based: 1 means "you are the next one to be paired". */
export interface QueuedMsg {
  position: number;
}

/**
 * A reserved seat in a freshly created match room. The shape matches what `colyseus.js` hands to
 * `consumeSeatReservation`, so the client can pass it on untouched.
 */
export interface MatchedMsg {
  reservation: {
    sessionId: string;
    room: { name: string; roomId: string; clients: number; maxClients: number };
  };
}

export interface SetLineupMsg {
  lineup: string[];
  levels?: number[];
}

export interface ReadyMsg {
  ready: boolean;
}

/** `turnId` must equal `state.shotNo` of the newest state the client has seen. */
export interface ShotMsg {
  matchId: string;
  turnId: number;
  clientShotId: string;
  configVersion: string;
  input: ShotInput;
}

export type Phase = 'lobby' | 'playing' | 'ended';

export interface SeatSnapshot {
  nickname: string;
  connected: boolean;
  ready: boolean;
  lineup: string[];
  levels: number[];
  /** Milliseconds left in the reconnect window of a disconnected seat during a match; absent otherwise. */
  reconnectMs?: number;
}

export interface RoomSnapshot {
  rules?: ModeRules;
  outcome?: ModeOutcome;
  protocol: number;
  code: string;
  configVersion: string;
  skin: string;
  phase: Phase;
  seats: [SeatSnapshot | null, SeatSnapshot | null];
  mySeat: Side;
  /** Secret that re-claims `mySeat`. Only ever sent to the seat's own client. */
  seatToken?: string;
}

/**
 * Remaining time, measured when the message is built (never a server wall-clock timestamp, so client clock skew does
 * not matter): the client turns it into a local deadline on receipt. `turnMs` already includes the server's playback
 * allowance for a shot in flight (the client ignores it until its own playback is done); null only when no turn clock
 * runs (match over).
 */
export interface ClockInfo {
  turnMs: number | null;
  matchMs: number;
}

/** `state.rng` is always 0 on the wire; the seed never leaves the server. */
export interface MatchStartMsg {
  rules?: ModeRules;
  matchId: string;
  configVersion: string;
  skin: string;
  lineups: [string[], string[]];
  levels: [number[], number[]];
  names: [string, string];
  state: MatchState;
  turnEvents: MatchEvent[];
  clocks: ClockInfo;
}

/** Same fields as client/src/host.ts ShotPacket plus routing info. */
export interface ShotPacketMsg {
  outcome?: ModeOutcome;
  matchId: string;
  seat: Side;
  clientShotId: string;
  seq: number;
  input: ShotInput;
  ids: string[];
  frames: number[][];
  recordHz: number;
  simEvents: SimEvent[];
  events: MatchEvent[];
  turnEvents: MatchEvent[];
  state: MatchState;
  clocks: ClockInfo;
}

/** A state change that is not a shot: turn timeout, match clock, surrender, forfeit. `events` end with `end` when the match is over. */
export interface UpdateMsg {
  outcome?: ModeOutcome;
  matchId: string;
  events: MatchEvent[];
  state: MatchState;
  clocks: ClockInfo;
}

/** Sent only to a client that re-claimed its seat mid-match or after the end: everything needed to rebuild the board. */
export interface ResumeMsg {
  rules?: ModeRules;
  outcome?: ModeOutcome;
  matchId: string;
  configVersion: string;
  skin: string;
  lineups: [string[], string[]];
  levels: [number[], number[]];
  names: [string, string];
  seq: number;
  state: MatchState;
  clocks: ClockInfo;
}

export interface ErrorMsg {
  code: NetErrorCode;
  on?: ClientMessageType;
  ref?: string;
  seq?: number;
}
