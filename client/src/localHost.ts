import { DEFAULT_DATA, type GameData } from '../../shared/data';
import { beginTurn, createMatch, endByTime, forfeit, passTurn, resolveShot, validateShot, type MatchState, type ShotInput } from '../../shared/match';
import type { Side } from '../../shared/physics';
import type { AiLevel } from '../../shared/ai';
import type { HostListener, MatchHost, SeatInfo } from './host';

const clone = <T>(o: T): T => structuredClone(o);

/** Runs the authoritative rules in the browser: hot-seat or practice vs. the bot. */
export class LocalHost implements MatchHost {
  readonly mySides: Side[];
  readonly viewSide: Side = 0;
  readonly seats: [SeatInfo, SeatInfo];
  private readonly data: GameData = DEFAULT_DATA;
  private st: MatchState;
  private l!: HostListener;
  private seq = 0;
  private deadline: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private worker: Worker | null = null;
  private readonly botSide: Side | null;

  constructor(opts: { mode: 'hotseat' | 'bot'; level?: AiLevel; names: [string, string]; lineups: [string[], string[]]; levels?: [number[] | null, number[] | null]; timer: boolean }) {
    this.botSide = opts.mode === 'bot' ? 1 : null;
    this.mySides = opts.mode === 'bot' ? [0] : [0, 1];
    this.seats = [
      { name: opts.names[0], isBot: false, connected: true },
      { name: opts.mode === 'bot' ? `电脑（${({ easy: '简单', normal: '普通', hard: '困难' } as const)[opts.level ?? 'normal']}）` : opts.names[1], isBot: opts.mode === 'bot', connected: true },
    ];
    this.useTimer = opts.timer;
    this.level = opts.level ?? 'normal';
    this.st = createMatch(this.data, opts.lineups, { seed: (Math.random() * 2 ** 32) >>> 0, levels: opts.levels });
    if (this.botSide !== null) {
      this.worker = new Worker(new URL('./aiWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<ShotInput | null>) => {
        if (e.data && this.st.turn === this.botSide && !this.st.over) this.apply(e.data);
      };
    }
  }
  private readonly useTimer: boolean;
  private readonly level: AiLevel;
  private matchEnd: number | null = null;
  private clock: ReturnType<typeof setTimeout> | null = null;
  private clockExpired = false;

  private timeUp() {
    this.clockExpired = true;
    if (this.busy || this.st.over) return;
    this.finishByTime();
  }

  private finishByTime() {
    const ev = endByTime(this.st);
    if (!ev.length) return;
    this.clearTimer();
    this.deadline = null;
    this.l.onEvents(ev);
    this.l.onState(clone(this.st));
  }

  start(l: HostListener) {
    this.l = l;
    this.matchEnd = Date.now() + this.data.rules.matchSeconds * 1000;
    this.clock = setTimeout(() => this.timeUp(), this.data.rules.matchSeconds * 1000);
    const ev = beginTurn(this.st, this.data);
    l.onState(clone(this.st));
    if (ev.length) l.onEvents(ev);
    this.turnStarted();
  }

  private turnStarted() {
    this.clearTimer();
    if (this.st.over) return;
    if (this.st.turn === this.botSide) {
      this.deadline = null;
      setTimeout(() => this.worker?.postMessage({ st: clone(this.st), level: this.level, seed: this.st.shotNo * 7919 + 13 }), 600);
      return;
    }
    if (this.useTimer) {
      this.deadline = Date.now() + this.data.rules.turnSeconds * 1000;
      this.timer = setTimeout(() => {
        const ev = passTurn(this.st, this.data, 'timeout');
        this.l.onEvents(ev);
        this.l.onState(clone(this.st));
        this.turnStarted();
      }, this.data.rules.turnSeconds * 1000);
    } else this.deadline = null;
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  shoot(input: ShotInput) {
    if (!this.mySides.includes(this.st.turn)) return;
    this.apply(input);
  }

  private apply(input: ShotInput) {
    if (this.busy) return;
    const err = validateShot(this.st, this.data, this.st.turn, input);
    if (err) {
      this.l.onInfo?.('出手无效：' + err);
      return;
    }
    this.busy = true;
    this.clearTimer();
    this.deadline = null;
    const out = resolveShot(this.st, this.data, input);
    this.l.onShot({
      seq: ++this.seq,
      input,
      ids: out.sim.ids,
      frames: out.sim.frames,
      recordHz: this.data.physics.recordHz,
      simEvents: out.sim.events,
      events: out.events,
      turnEvents: out.turnEvents,
      state: clone(this.st),
    });
  }

  playbackDone() {
    this.busy = false;
    if (this.clockExpired) this.finishByTime();
    this.turnStarted();
  }

  turnDeadline() {
    return this.deadline;
  }

  matchDeadline() {
    return this.matchEnd;
  }

  surrender() {
    if (this.st.over) return;
    const loser = this.mySides.length === 1 ? this.mySides[0] : this.st.turn;
    const ev = forfeit(this.st, loser, 'surrender');
    this.clearTimer();
    this.l.onEvents(ev);
    this.l.onState(clone(this.st));
  }

  dispose() {
    this.clearTimer();
    if (this.clock) clearTimeout(this.clock);
    this.worker?.terminate();
  }
}
