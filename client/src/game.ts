import { DEFAULT_DATA, FIELD_SKINS } from '../../shared/data';
import { buildSetup, buildShot, pieceStats, type MatchEvent, type MatchState, type ShotInput } from '../../shared/match';
import { simulateShot, type Side } from '../../shared/physics';
import { foldAimPath } from '../../shared/aim';
import type { MatchHost, ShotPacket } from './host';
import { Renderer, TEAM_COLORS, type Aim, type Effect, type ScenePiece, type Skin } from './render';
import { sfx } from './sfx';
import type { PlatformServices, Viewport } from '@pengzhuang/platform';
import { createGamePlatform } from './webPlatform';
import { samplePlayback } from '../../packages/game-core/src/playback';
import { chooseQuality, type Quality } from './quality';
import { dragIntent, gestureCurve } from '../../packages/game-core/src/drag';

const data = DEFAULT_DATA;
const MAX_DRAG = 2.4; // metres of pull for full power
const AIM_LENGTH = 6; // metres of aim line at aimAssist 1, the same for every power and curve
const CURVE_STEP = 0.1;
const RELOCATE_MS = 450;
const OPEN_FIELD = { ...data.geometry, width: 2000, length: 2000 };

export interface GameOptions {
  platform?: PlatformServices;
  quality?: Quality | 'auto';
  skinId: string;
  onExit: () => void;
  onRematch?: () => void;
}

interface Playback {
  packet: ShotPacket;
  start: number;
  before: MatchState;
  nextEvent: number;
  goalShown: boolean;
}

export class GameView {
  private readonly root: HTMLElement;
  private readonly host: MatchHost;
  private readonly opts: GameOptions;
  private readonly r: Renderer;
  private state: MatchState | null = null;
  private play: Playback | null = null;
  private aim: Aim | null = null;
  private aimPointer: number | null = null;
  private hoverId: string | null = null;
  private curve = 0;
  private effects: Effect[] = [];
  private raf = 0;
  private disposed = false;
  private suspended = false;
  private readonly platform: PlatformServices;
  private readonly unsubscribers: (() => void)[] = [];
  private debugHandle: unknown = null;
  private lastPreviewKey = '';
  private readonly el: Record<string, HTMLElement> = {};
  private ballSpin = 0;
  private lastBall = { x: 0, y: 0 };
  private springHits = [-1e9, -1e9, -1e9, -1e9];
  private dragPath: { x: number; y: number }[] = [];
  /** Touch aims take the curve from the drag gesture; mouse aims use the arrow keys. */
  private gesture = false;
  private relocating: { start: number; from: Map<string, { x: number; y: number }> } | null = null;
  private trail: { x: number; y: number; t: number }[] = [];
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(root: HTMLElement, host: MatchHost, opts: GameOptions) {
    this.root = root;
    this.host = host;
    this.opts = opts;
    this.platform = opts.platform ?? createGamePlatform();
    try {
    root.innerHTML = `
      <div class="game">
        <div class="hud-top">
          <div class="team t0"><div class="tname"></div><div class="tscore">0</div></div>
          <div class="mid"><div class="turn"></div><div class="timer"></div><div class="shots"></div></div>
          <div class="team t1"><div class="tscore">0</div><div class="tname"></div></div>
        </div>
        <div class="stage"><canvas></canvas><div class="toasts"></div><div class="banner"></div></div>
        <div class="hud-bottom">
          <div class="curve">
            <span class="clabel">弧线</span>
            <div class="cmeter"><i></i></div>
            <span class="cval">直线</span>
            <span class="chint">${matchMedia('(pointer: coarse)').matches ? '拉线时向左右划' : '← → 调弧线'}</span>
          </div>
          <button class="menu-btn">菜单</button>
        </div>
        <div class="overlay menu hidden">
          <div class="panel">
            <h3>菜单</h3>
            <label>场地外观 <select class="skin"></select></label>
            <label>画质 <select class="quality"><option value="auto">自动</option><option value="low">流畅</option><option value="medium">标准</option><option value="high">精细</option></select></label>
            <button class="surrender">认输</button>
            <button class="exit">返回大厅</button>
            <button class="close">继续比赛</button>
          </div>
        </div>
        <div class="overlay result hidden"><div class="panel"></div></div>
        <canvas class="aim-layer"></canvas>
      </div>`;
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    for (const [k, s] of Object.entries({
      name0: '.t0 .tname', name1: '.t1 .tname', score0: '.t0 .tscore', score1: '.t1 .tscore', turn: '.turn', timer: '.timer', shots: '.shots',
      toasts: '.toasts', banner: '.banner', cval: '.cval', menu: '.menu', result: '.result', stage: '.stage',
    })) this.el[k] = q(s);
    (q('.t0') as HTMLElement).style.setProperty('--team', TEAM_COLORS[0]);
    (q('.t1') as HTMLElement).style.setProperty('--team', TEAM_COLORS[1]);
    this.el.name0.textContent = host.seats[0].name;
    this.el.name1.textContent = host.seats[1].name;

    const skin = (FIELD_SKINS.find((s) => s.id === opts.skinId) ?? FIELD_SKINS[0]) as Skin;
    const canvas = q('.stage canvas') as HTMLCanvasElement;
    this.r = new Renderer(canvas, data.geometry, data.physics, skin);
    const capabilities = { cores: navigator.hardwareConcurrency, memoryGiB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
    this.r.setQuality(opts.quality && opts.quality !== 'auto' ? opts.quality : chooseQuality(capabilities));
    this.r.attachOverlay(q('.aim-layer') as HTMLCanvasElement);
    this.r.flip = host.viewSide === 1;

    const skinSel = q('.skin') as HTMLSelectElement;
    for (const s of FIELD_SKINS) skinSel.add(new Option(s.name, s.id, false, s.id === skin.id));
    skinSel.addEventListener('change', () => {
      this.r.skin = (FIELD_SKINS.find((s) => s.id === skinSel.value) ?? FIELD_SKINS[0]) as Skin;
      localStorage.setItem('pz_skin', skinSel.value);
      this.onResize();
    });
    const qualitySel = q('.quality') as HTMLSelectElement;
    qualitySel.value = opts.quality ?? 'auto';
    qualitySel.addEventListener('change', () => {
      this.r.setQuality(qualitySel.value === 'auto' ? chooseQuality(capabilities) : qualitySel.value as Quality);
      this.onResize();
    });
    q('.menu-btn').addEventListener('click', () => this.el.menu.classList.remove('hidden'));
    q('.menu .close').addEventListener('click', () => this.el.menu.classList.add('hidden'));
    q('.menu .exit').addEventListener('click', () => this.exit());
    q('.menu .surrender').addEventListener('click', () => {
      this.el.menu.classList.add('hidden');
      if (confirm('确定认输吗？')) host.surrender();
    });

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', () => this.cancelAim());
    window.addEventListener('keydown', this.onKey);
    this.unsubscribers.push(this.platform.viewport.subscribe(() => this.onResize()));
    this.onResize();

    host.start({
      onState: (st) => this.onState(st),
      onShot: (p) => this.onShot(p),
      onEvents: (ev) => this.showEvents(ev),
      onInfo: (t) => this.toast(t, 'info'),
    });
    this.raf = requestAnimationFrame(this.frame);
    // automation handle for tools/e2e-*.mjs
    if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    this.debugHandle = {
      state: () => this.state,
      playing: () => !!this.play,
      canAim: () => this.canAim(),
      curve: () => this.curve,
      aim: () => this.aim && { path: this.aim.path, ghost: this.aim.ghost, power: this.aim.power },
      mySides: () => this.host.mySides,
      screenOf: (x: number, y: number) => {
        const rect = this.r.canvas.getBoundingClientRect();
        const s = this.r.toScreen(x, y);
        return { x: rect.left + s.x, y: rect.top + s.y, scale: this.r.scale };
      },
      portraits: () => this.r.boundAvatars(),
      resources: () => this.r.resourceStats(),
    };
    (window as unknown as { __pz: unknown }).__pz = this.debugHandle;
    }
    this.unsubscribers.push(this.platform.lifecycle.onChange((state) => state === 'background' ? this.suspend() : this.resume()));
    } catch (error) { this.dispose(); throw error; }
  }

  private onResize = () => {
    const game = this.root.querySelector('.game') as HTMLElement;
    game.classList.toggle('scene', this.r.sceneMode);
    this.r.reserveBottom = this.r.sceneMode ? (this.root.querySelector('.hud-bottom') as HTMLElement).offsetHeight : 0;
    this.r.resize();
    // Full original scenes carry their own score bar: lay the DOM scoreboard over it.
    const hud = this.root.querySelector('.hud-top') as HTMLElement;
    const bar = this.r.sceneBar();
    if (!bar) {
      hud.removeAttribute('style');
      game.style.removeProperty('--bar-h');
      return;
    }
    hud.style.cssText = `left:${bar.x}px;top:${bar.y}px;width:${bar.w}px;height:${bar.h}px;font-size:${Math.max(9, bar.h * 0.34)}px`;
    game.style.setProperty('--bar-h', `${bar.y + bar.h}px`);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.cancelAim();
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && this.canAim() && !this.gesture) {
      e.preventDefault();
      this.setCurve(this.curve + (e.key === 'ArrowLeft' ? -CURVE_STEP : CURVE_STEP));
      if (this.aim) this.updateAim(this.aim.pointer);
    }
  };

  private setCurve(v: number) {
    this.curve = Math.max(-1, Math.min(1, Math.round(v * 20) / 20));
    this.el.cval.textContent = this.curve === 0 ? '直线' : `${this.curve < 0 ? '左旋' : '右旋'} ${Math.round(Math.abs(this.curve) * 100)}%`;
    const bar = this.root.querySelector('.cmeter i') as HTMLElement;
    bar.style.left = `${50 + Math.min(0, this.curve) * 50}%`;
    bar.style.width = `${Math.abs(this.curve) * 50}%`;
  }

  /**
   * Curve from the drag gesture: how far the drag path bows sideways from the straight pull,
   * relative to the pull length. Bowing towards the shooter's right bends the shot right.
   * A circular arc whose sagitta is a quarter of the chord gives full curve.
   */
  private gestureCurve(): number {
    return gestureCurve(this.dragPath, this.aim!.pointer);
  }

  // ------------------------------------------------------------ host events
  private onState(st: MatchState) {
    if (this.play) {
      this.play.packet.state = st;
      return;
    }
    const prevTurn = this.state?.turn;
    this.state = st;
    this.syncHud();
    if (st.over) this.showResult();
    else if (prevTurn !== st.turn && this.host.mySides.includes(st.turn)) sfx.turn();
  }

  private onShot(p: ShotPacket) {
    if (!this.state) return;
    this.cancelAim();
    sfx.shoot(p.input.power);
    this.play = { packet: p, start: performance.now(), before: this.state, nextEvent: 0, goalShown: false };
    this.setCurve(0);
  }

  private schedule(callback: () => void, ms: number) {
    const timer = setTimeout(() => { this.timers.delete(timer); if (!this.disposed) callback(); }, ms);
    this.timers.add(timer);
  }

  private finishPlayback(animate = true) {
    const p = this.play!;
    this.play = null;
    this.state = p.packet.state;
    const moved = p.packet.events.find((e) => e.type === 'relocate');
    if (animate && moved?.type === 'relocate') {
      const frame = p.packet.frames[p.packet.frames.length - 1];
      const from = new Map<string, { x: number; y: number }>();
      p.packet.ids.forEach((id, j) => j > 0 && moved.ids.includes(id) && from.set(id, { x: frame[j * 2] / 1000, y: frame[j * 2 + 1] / 1000 }));
      this.relocating = { start: performance.now(), from };
    }
    const goal = p.packet.events.find((e) => e.type === 'goal');
    if (animate) {
      this.showEvents(p.packet.events.filter((e) => e.type !== 'goal'));
      if (goal && !p.goalShown) this.showEvents([goal]);
      this.showEvents(p.packet.turnEvents);
    }
    this.syncHud();
    if (this.state.over) { if (animate) this.schedule(() => this.showResult(), goal ? 1200 : 300); else this.showResult(); }
    else if (animate && this.host.mySides.includes(this.state.turn)) sfx.turn();
    this.host.playbackDone();
  }

  // ------------------------------------------------------------ input
  private canAim() {
    if (this.disposed || this.suspended) return false;
    return !!this.state && !this.play && !this.relocating && !this.state.over && this.host.mySides.includes(this.state.turn);
  }

  private selectable(): Set<string> {
    const s = new Set<string>();
    if (!this.canAim()) return s;
    for (const p of this.state!.pieces) if (p.side === this.state!.turn && p.out === 0 && p.frozen === 0) s.add(p.id);
    return s;
  }

  private local(e: PointerEvent) {
    return this.r.clientToWorld(e.clientX, e.clientY);
  }

  private pieceAt(w: { x: number; y: number }) {
    const sel = this.selectable();
    let best: string | null = null, bd = Infinity;
    const reach = data.physics.disc.radius * 1.5;
    for (const p of this.state!.pieces) {
      if (!sel.has(p.id)) continue;
      const d = Math.hypot(p.x - w.x, p.y - w.y);
      if (d < reach && d < bd) { bd = d; best = p.id; }
    }
    return best;
  }

  private onDown(e: PointerEvent) {
    sfx.unlock();
    if (!this.canAim()) return;
    const w = this.local(e);
    const id = this.pieceAt(w);
    if (!id) return;
    const p = this.state!.pieces.find((q) => q.id === id)!;
    this.aimPointer = e.pointerId;
    this.r.canvas.setPointerCapture(e.pointerId);
    this.aim = { pieceId: id, from: { x: p.x, y: p.y }, pointer: w, power: 0, maxPull: MAX_DRAG + data.physics.disc.radius * 0.6, path: [], ghost: null, valid: false };
    this.dragPath = [w];
    this.gesture = e.pointerType === 'touch';
    if (this.gesture) this.setCurve(0);
    this.updateAim(w);
  }

  private onMove(e: PointerEvent) {
    const w = this.local(e);
    if (this.aim && e.pointerId === this.aimPointer) {
      const a = this.aim;
      if (Math.hypot(w.x - a.from.x, w.y - a.from.y) < data.physics.disc.radius) this.dragPath = [w];
      else {
        const last = this.dragPath[this.dragPath.length - 1];
        if (Math.hypot(w.x - last.x, w.y - last.y) > 0.03) this.dragPath.push(w);
      }
      this.updateAim(w);
    } else if (this.canAim()) this.hoverId = this.pieceAt(w);
  }

  private onUp(e: PointerEvent) {
    if (!this.aim || e.pointerId !== this.aimPointer) return;
    const a = this.aim;
    this.updateAim(this.local(e));
    this.cancelAim();
    if (!a.valid || !this.canAim()) return;
    const drag = dragIntent(a.from, a.pointer, data.physics.disc.radius, MAX_DRAG);
    const input: ShotInput = { pieceId: a.pieceId, dirX: round6(drag.dirX), dirY: round6(drag.dirY), power: round3(drag.power), curve: this.curve };
    this.host.shoot(input);
  }

  private cancelAim() {
    if (this.aimPointer !== null) {
      try { this.r.canvas.releasePointerCapture(this.aimPointer); } catch { /* already released */ }
    }
    this.aim = null;
    this.aimPointer = null;
    this.gesture = false;
  }

  private updateAim(w: { x: number; y: number }) {
    const a = this.aim!;
    a.pointer = w;
    if (this.gesture) this.setCurve(this.gestureCurve());
    const { dx, dy, distance: dist, power } = dragIntent(a.from, w, data.physics.disc.radius, MAX_DRAG);
    a.power = power;
    a.valid = a.power >= data.physics.shot.minPower;
    if (!a.valid) {
      a.path = [];
      a.ghost = null;
      return;
    }
    const key = `${a.pieceId}|${dx.toFixed(3)}|${dy.toFixed(3)}|${this.curve}`;
    if (key === this.lastPreviewKey) return;
    this.lastPreviewKey = key;
    const st = this.state!;
    const input: ShotInput = { pieceId: a.pieceId, dirX: dx / dist, dirY: dy / dist, power: a.power, curve: this.curve };
    const { shot } = buildShot(st, data, input, null);
    const setup = buildSetup(st, data, a.pieceId);
    const shooter = setup.pieces.find((q) => q.id === a.pieceId)!;
    const alone = { ball: { x: 900, y: 900 }, pieces: [shooter] };
    const free = simulateShot(OPEN_FIELD, data.physics, alone, shot, { record: false, traceShooter: true, maxSeconds: 3 }).shooterPath;
    const p = st.pieces.find((q) => q.id === a.pieceId)!;
    const assist = pieceStats(data, p.playerId, p.level, p.cond).aimAssist;
    const res = foldAimPath(data.geometry, free, AIM_LENGTH * assist, data.physics.disc.radius);
    a.path = res.path;
    a.ghost = null;
  }

  // ------------------------------------------------------------ rendering
  private frame = (now: number) => {
    if (this.disposed || this.suspended) return;
    this.raf = requestAnimationFrame(this.frame);
    if (!this.state) return;
    let pieces: ScenePiece[];
    let ball: { x: number; y: number };
    if (this.play) {
      const { packet, start, before } = this.play;
      const t = Math.max(0, (now - start) / 1000);
      const sample = samplePlayback(packet.frames, packet.recordHz, t);
      const at = (j: number) => sample.positions[j];
      ball = at(0);
      const pos = new Map<string, { x: number; y: number }>();
      packet.ids.forEach((id, j) => j > 0 && pos.set(id, at(j)));
      pieces = before.pieces.map((p) => ({ ...p, ...(pos.get(p.id) ?? {}) }));
      this.spawnSimEvents(t);
      if (sample.complete) this.finishPlayback();
    } else {
      pieces = this.state.pieces;
      ball = this.state.ball;
      if (this.relocating) {
        const k = Math.min(1, (now - this.relocating.start) / RELOCATE_MS);
        const e = 1 - (1 - k) * (1 - k);
        const from = this.relocating.from;
        pieces = pieces.map((q) => {
          const f = from.get(q.id);
          return f ? { ...q, x: f.x + (q.x - f.x) * e, y: f.y + (q.y - f.y) * e } : q;
        });
        if (k >= 1) this.relocating = null;
      }
    }
    const moved = Math.hypot(ball.x - this.lastBall.x, ball.y - this.lastBall.y);
    this.ballSpin += (moved / data.physics.ball.radius) * 0.6;
    if (moved > 0.5) this.trail = []; // teleport (goal reset), not motion
    this.lastBall = { ...ball };
    this.trail.push({ x: ball.x, y: ball.y, t: now });
    this.trail = this.trail.filter((p) => now - p.t < 260);
    this.effects = this.effects.filter((e) => now - e.t0 < e.dur).slice(-128);
    this.r.draw({
      pieces,
      ball: { ...ball, spin: this.ballSpin },
      aim: this.aim,
      selectable: this.selectable(),
      hoverId: this.hoverId,
      effects: this.effects,
      now,
      springHits: this.springHits,
      trail: this.trail,
    });
    this.updateTimer();
  };

  private spawnSimEvents(t: number) {
    const p = this.play!;
    const evs = p.packet.simEvents;
    const now = performance.now();
    while (p.nextEvent < evs.length && evs[p.nextEvent].t <= t) {
      const e = evs[p.nextEvent++];
      if (e.type === 'goal') {
        p.goalShown = true;
        this.effects.push({ kind: 'burst', x: e.x, y: e.y, t0: now, dur: 1400, color: '#ffd640', size: 2.2 });
        const g = p.packet.events.find((x) => x.type === 'goal');
        if (g) this.showEvents([g]);
        continue;
      }
      if (e.type === 'skill-boost') {
        this.effects.push({ kind: 'ring', x: e.x, y: e.y, t0: now, dur: 600, color: '#ffd640', size: 0.9 });
        continue;
      }
      if (e.type === 'spring-kick') {
        this.springHits[Number(e.b.slice(6))] = now;
        sfx.spring();
        continue;
      }
      if (e.speed < 0.6) continue;
      const hasBall = e.type.includes('ball');
      const wallish = /wall|net|post|spring/.test(e.type);
      if (e.type.includes('post')) sfx.post();
      else if (wallish) sfx.wall(e.speed);
      else if (hasBall) sfx.kick(e.speed);
      else sfx.hit(e.speed);
      if (e.speed > 1.2) {
        this.effects.push({ kind: hasBall ? 'ring' : 'spark', x: e.x, y: e.y, t0: now, dur: 380, color: hasBall ? '#ffffff' : '#fff2b0', size: Math.min(1, 0.25 + e.speed * 0.08) });
      }
    }
  }

  // ------------------------------------------------------------ HUD
  private syncHud() {
    const st = this.state!;
    this.el.score0.textContent = String(st.score[0]);
    this.el.score1.textContent = String(st.score[1]);
    const mine = this.host.mySides.includes(st.turn);
    const who = this.host.seats[st.turn].name;
    this.el.turn.textContent = st.over ? '比赛结束' : this.host.mySides.length > 1 ? `${who} 出手` : mine ? '你的回合' : `${who} 思考中…`;
    this.el.turn.style.color = TEAM_COLORS[st.turn];
    this.root.querySelector('.t0')!.classList.toggle('active', st.turn === 0 && !st.over);
    this.root.querySelector('.t1')!.classList.toggle('active', st.turn === 1 && !st.over);
  }

  private updateTimer() {
    const md = this.host.matchDeadline();
    const left = md === null ? data.rules.matchSeconds : Math.max(0, Math.ceil((md - Date.now()) / 1000));
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (this.el.shots.textContent !== clock) {
      this.el.shots.textContent = clock;
      this.el.shots.classList.toggle('urgent', left <= 30 && !this.state?.over);
    }
    const d = this.host.turnDeadline();
    if (!d || this.play || this.state?.over) {
      this.el.timer.textContent = '';
      return;
    }
    const s = Math.max(0, Math.ceil((d - Date.now()) / 1000));
    this.el.timer.textContent = `${s}s`;
    this.el.timer.classList.toggle('urgent', s <= 5);
  }

  private pieceName(id: string) {
    const st = this.play?.before ?? this.state!;
    const p = st.pieces.find((q) => q.id === id);
    return p ? data.players[p.playerId].name : id;
  }

  private showEvents(ev: MatchEvent[]) {
    for (const e of ev) {
      switch (e.type) {
        case 'skill':
          sfx.skill();
          this.toast(`⚡ ${this.pieceName(e.pieceId)} · ${e.name}`, 'skill', e.text);
          break;
        case 'goal': {
          sfx.goal();
          const name = this.host.seats[e.scoredBy].name;
          this.bannerShow(e.ownGoal ? '乌龙球！' : '进球！', `${name} 得分`, TEAM_COLORS[e.scoredBy]);
          break;
        }
        case 'sendoff':
          this.toast(`🟥 ${e.ids.map((i) => this.pieceName(i)).join('、')} 离场 2 回合`, 'warn');
          break;
        case 'freeze':
          this.toast(`🧊 ${e.ids.map((i) => this.pieceName(i)).join('、')} 被定住到下回合结束`, 'warn');
          break;
        case 'respawn':
          this.toast(`${this.pieceName(e.id)} 回到场上`, 'info');
          break;
        case 'extra':
          this.toast('额外行动！再出手一次', 'skill');
          break;
        case 'pass':
          this.toast(e.reason === 'timeout' ? `${this.host.seats[e.side].name} 超时，回合交换` : '跳过回合', 'info');
          break;
        case 'end':
          break;
      }
    }
  }

  private toast(text: string, kind: string, sub?: string) {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.innerHTML = `<b></b>${sub ? '<small></small>' : ''}`;
    d.querySelector('b')!.textContent = text;
    if (sub) d.querySelector('small')!.textContent = sub;
    this.el.toasts.appendChild(d);
    this.schedule(() => d.classList.add('out'), 2600);
    this.schedule(() => d.remove(), 3100);
  }

  private bannerShow(title: string, sub: string, color: string) {
    const b = this.el.banner;
    b.innerHTML = `<div class="btitle"></div><div class="bsub"></div>`;
    (b.querySelector('.btitle') as HTMLElement).textContent = title;
    (b.querySelector('.bsub') as HTMLElement).textContent = sub;
    b.style.setProperty('--c', color);
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  private showResult() {
    const st = this.state!;
    const panel = this.el.result.querySelector('.panel')!;
    const mine = this.host.mySides;
    let title = '平局';
    if (st.winner !== -1) title = mine.length > 1 ? `${this.host.seats[st.winner].name} 获胜` : mine.includes(st.winner as Side) ? '胜利！' : '惜败';
    const reason = ({ goals: `先进 ${data.rules.goalsToWin} 球`, time: `${data.rules.matchSeconds / 60} 分钟到`, 'shot-limit': `${data.rules.maxShots} 手用完`, surrender: '认输', disconnect: '对手断线超时' } as Record<string, string>)[st.endReason] ?? st.endReason;
    panel.innerHTML = `
      <h2 class="rtitle"></h2>
      <div class="rscore"><span style="color:${TEAM_COLORS[0]}"></span><b>${st.score[0]} : ${st.score[1]}</b><span style="color:${TEAM_COLORS[1]}"></span></div>
      <p class="rreason"></p>
      <div class="rbtns">${this.opts.onRematch ? '<button class="again primary">再来一局</button>' : ''}<button class="back">返回大厅</button></div>`;
    panel.querySelector('.rtitle')!.textContent = title;
    const spans = panel.querySelectorAll('.rscore span');
    spans[0].textContent = this.host.seats[0].name;
    spans[1].textContent = this.host.seats[1].name;
    panel.querySelector('.rreason')!.textContent = `${reason} · 共 ${st.shotNo} 手`;
    panel.querySelector('.again')?.addEventListener('click', () => this.opts.onRematch?.());
    panel.querySelector('.back')!.addEventListener('click', () => this.exit());
    this.el.result.classList.remove('hidden');
  }

  private exit() {
    this.dispose();
    this.opts.onExit();
  }

  resize(_viewport: Viewport) { this.onResize(); }

  suspend() {
    if (this.disposed || this.suspended) return;
    this.suspended = true;
    this.cancelAim();
    cancelAnimationFrame(this.raf);
    this.platform.audio.pause();
    this.effects = []; this.trail = []; this.relocating = null;
  }

  resume() {
    if (this.disposed || !this.suspended) return;
    if (this.play) this.finishPlayback(false);
    this.effects = []; this.trail = []; this.relocating = null;
    this.suspended = false;
    this.platform.audio.resume();
    this.onResize();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.r?.dispose();
    this.platform.dispose();
    const debug = window as unknown as { __pz?: unknown };
    if (debug.__pz === this.debugHandle) delete debug.__pz;
    this.debugHandle = null;
    this.host.dispose();
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
