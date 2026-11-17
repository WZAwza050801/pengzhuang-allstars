import { DEFAULT_DATA, type GameData } from '../../shared/data';
import { beginTurn, createMatch, endByTime, forfeit, passTurn, resolveShot, validateShot, type MatchState, type ShotInput } from '../../shared/match';
import type { Side } from '../../shared/physics';
import { fallbackShot, type AiLevel } from '../../shared/ai';
import { createDecisionBroker, type DecisionBroker, type DecisionWorker } from '@pengzhuang/platform';
import { AiReplySchema } from '../../packages/contracts/src/ai';
import { AI_POLICY, createWebAiWorker } from './aiService';
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
  private readonly ai: DecisionBroker;
  private botDelay: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private disposed = false;
  private started = false;
  private readonly botSide: Side | null;

  constructor(opts: { mode: 'hotseat' | 'bot'; level?: AiLevel; names: [string, string]; lineups: [string[], string[]]; levels?: [number[] | null, number[] | null]; timer: boolean }, runtime: { createWorker?: () => DecisionWorker; seed?: number } = {}) {
    this.ai = createDecisionBroker(runtime.createWorker ?? createWebAiWorker);
    this.botSide = opts.mode === 'bot' ? 1 : null;
    this.mySides = opts.mode === 'bot' ? [0] : [0, 1];
    this.seats = [
      { name: opts.names[0], isBot: false, connected: true },
      { name: opts.mode === 'bot' ? `电脑（${({ easy: '简单', normal: '普通', hard: '困难' } as const)[opts.level ?? 'normal']}）` : opts.names[1], isBot: opts.mode === 'bot', connected: true },
    ];
    this.useTimer = opts.timer;
    this.level = opts.level ?? 'normal';
    this.st = createMatch(this.data, opts.lineups, { seed: runtime.seed ?? ((Math.random() * 2 ** 32) >>> 0), levels: opts.levels });

  }
  private readonly useTimer: boolean;
  private readonly level: AiLevel;
  private matchEnd: number | null = null;
  private clock: ReturnType<typeof setTimeout> | null = null;
  private clockExpired = false;

  private timeUp() {
    if (this.disposed) return;
    this.clockExpired = true;
    if (this.busy || this.st.over) return;
    this.finishByTime();
  }

  private finishByTime() {
    const ev = endByTime(this.st);
    if (!ev.length) return;
    this.clearTimer();
    this.cancelAi();
    this.clearClock();
    this.deadline = null;
    this.l.onEvents(ev);
    this.l.onState(clone(this.st));
  }

  start(l: HostListener) {
    if (this.disposed || this.started) throw new Error('Local host cannot start twice');
    this.started = true;
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
    this.cancelAi();
    if (this.disposed || this.st.over) return;
    if (this.st.turn === this.botSide) {
      this.deadline = null;
      const generation = this.generation;
      this.botDelay = setTimeout(() => { this.botDelay = null; void this.requestBot(generation); }, AI_POLICY.presentationDelayMs);
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

  private cancelAi() {
    this.generation++;
    if (this.botDelay !== null) clearTimeout(this.botDelay);
    this.botDelay = null;
    this.ai.cancel();
  }

  private clearClock() { if (this.clock !== null) clearTimeout(this.clock); this.clock = null; }

  private async requestBot(generation: number) {
    if (this.disposed || this.st.over || this.busy || generation !== this.generation || this.st.turn !== this.botSide) return;
    const state = clone(this.st), epoch = { shotNo: state.shotNo, turn: state.turn, dataVersion: state.dataVersion };
    const result = await this.ai.run({state, epoch, level: this.level, seed: state.shotNo * 7919 + 13}, AI_POLICY.workerDeadlineMs);
    if (this.disposed || this.busy || this.st.over || generation !== this.generation || this.st.shotNo !== epoch.shotNo || this.st.turn !== epoch.turn || this.st.dataVersion !== epoch.dataVersion) return;
    if (this.matchEnd !== null && Date.now() >= this.matchEnd) { this.timeUp(); return; }
    if (result.status === 'aborted') return;
    const reply = result.status === 'completed' ? AiReplySchema.safeParse(result.value) : null;
    let input: ShotInput | null = null;
    if (reply?.success && reply.data.epoch.shotNo === epoch.shotNo && reply.data.epoch.turn === epoch.turn && reply.data.epoch.dataVersion === epoch.dataVersion) input = reply.data.input;
    if (!input || validateShot(this.st,this.data,this.st.turn,input)) input = fallbackShot(this.st,this.data);
    if (input && !validateShot(this.st,this.data,this.st.turn,input)) this.apply(input);
    else {
      const events=passTurn(this.st,this.data,'no-legal-piece');
      this.l.onEvents(events);this.l.onState(clone(this.st));this.turnStarted();
    }
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  shoot(input: ShotInput) {
    if (this.disposed || !this.started) return;
    if (!this.mySides.includes(this.st.turn)) return;
    this.apply(input);
  }

  private apply(input: ShotInput) {
    if (this.disposed || this.busy || this.st.over) return;
    const err = validateShot(this.st, this.data, this.st.turn, input);
    if (err) {
      this.l.onInfo?.('出手无效：' + err);
      return;
    }
    this.busy = true;
    this.cancelAi();
    this.clearTimer();
    this.deadline = null;
    const work = clone(this.st);
    let out: ReturnType<typeof resolveShot>;
    try { out = resolveShot(work, this.data, input); }
    catch { this.busy = false; this.l.onInfo?.('出手处理失败，请重试'); this.turnStarted(); return; }
    this.st = work;
    if (this.st.over) this.clearClock();
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
    if (this.disposed || !this.started || !this.busy) return;
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
    if (this.disposed || !this.started || this.st.over) return;
    this.cancelAi();
    this.clearClock();
    const loser = this.mySides.length === 1 ? this.mySides[0] : this.st.turn;
    const ev = forfeit(this.st, loser, 'surrender');
    this.clearTimer();
    this.l.onEvents(ev);
    this.l.onState(clone(this.st));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.cancelAi();
    this.ai.dispose();
    this.clearClock();
    this.deadline = null; this.matchEnd = null;
  }
}
