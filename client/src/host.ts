import type { MatchEvent, MatchState, ShotInput } from '../../shared/match';
import type { SimEvent, Side } from '../../shared/physics';
import type { ModeRules } from '../../packages/contracts/src/modes';
import type { AiLevel } from '../../shared/ai';

/** What the renderer receives for one resolved shot, whether computed locally or by the server. */
export interface ShotPacket {
  seq: number;
  input: ShotInput;
  ids: string[];
  frames: number[][];
  recordHz: number;
  simEvents: SimEvent[];
  events: MatchEvent[];
  turnEvents: MatchEvent[];
  /** Authoritative state after the shot. */
  state: MatchState;
}

export interface HostListener {
  onReset?(): void;
  onState(st: MatchState): void;
  onShot(p: ShotPacket): void;
  onEvents(ev: MatchEvent[]): void;
  onInfo?(text: string): void;
}

export interface SeatInfo {
  reconnectDeadline?: number;
  name: string;
  isBot: boolean;
  connected: boolean;
}

export interface MatchHost {
  inputStatus?(): 'ready' | 'pending' | 'reconnecting' | 'closed';
  readonly rules?: ModeRules;
  /** Sides the local user may control. */
  readonly mySides: Side[];
  readonly viewSide: Side;
  readonly seats: [SeatInfo, SeatInfo];
  start(l: HostListener): void;
  shoot(input: ShotInput): void;
  /** Called by the UI once the shot animation has finished playing. */
  playbackDone(): void;
  /** Epoch ms when the current turn times out, or null. */
  turnDeadline(): number | null;
  /** Epoch ms when the match clock runs out, or null before kickoff. */
  matchDeadline(): number | null;
  surrender(): void;
  dispose(): void;
  /** MM-06: practice bot difficulty (optional; online hosts ignore). */
  aiLevel?(): AiLevel;
  setAiLevel?(level: AiLevel): void;
  /** MM-06: pause/resume background bot computation so a hidden page never keeps computing. */
  setBackground?(hidden: boolean): void;
}
