import { World, Vec2, Circle, Edge, Settings, type Body, type Contact, type Fixture } from 'planck';
import type { FieldGeometry, PhysicsConfig } from './data';
import { fieldSegments, fieldPosts, goalCrossing } from '../packages/game-core/src/field';
export { fieldSegments, insideField, type FieldSegment, type SegmentKind } from '../packages/game-core/src/field';

/**
 * Coordinates: metres, origin at centre spot, +y points down the screen for side 0.
 * Side 0 defends the bottom goal (y = +L/2) and attacks the top goal (y = -L/2).
 */

export type Side = 0 | 1;

export interface SimPiece {
  id: string;
  side: Side;
  x: number;
  y: number;
  mass: number;
  /** Anchored or frozen pieces are static for this shot. */
  fixed?: boolean;
}

export interface SimSetup {
  ball: { x: number; y: number };
  pieces: SimPiece[];
}

export interface SimShot {
  pieceId: string;
  dirX: number;
  dirY: number;
  /** 0..1 */
  power: number;
  /** -1..1, positive bends to the shooter's right */
  curve: number;
  speedMul?: number;
  curveMul?: number;
  ballBoost?: { mul: number; requireInBox: boolean } | null;
}

export interface SimOptions {
  record?: boolean;
  maxSeconds?: number;
  /** For aim preview: stop as soon as the shooter touches anything. */
  stopAtShooterContact?: boolean;
  /** For the shooter path in the aim preview. */
  traceShooter?: boolean;
  /** Called after every fixed step (tests). */
  onStep?: (step: number, sim: SimWorld) => void;
}

export type ContactKind = 'disc' | 'ball' | 'wall' | 'net' | 'post' | 'spring';
export interface SimEvent {
  t: number;
  type: string;
  a: string;
  b: string;
  speed: number;
  x: number;
  y: number;
}

export interface SimResult {
  ids: string[];
  /** frames[i] = [ballX, ballY, p0x, p0y, ...] in millimetres, recorded at physics.recordHz. */
  frames: number[][];
  steps: number;
  duration: number;
  goal: null | { scoredBy: Side; t: number; x: number };
  events: SimEvent[];
  shooterTouched: string[];
  ballBoosted: boolean;
  final: { ball: { x: number; y: number }; pieces: Record<string, { x: number; y: number }> };
  forcedStop: boolean;
  maxSpeed: number;
  shooterPath: { x: number; y: number }[];
  firstContact: null | { t: number; x: number; y: number; other: string };
  launchSpeed: number;
}

interface Tag {
  kind: ContactKind;
  id: string;
  side?: Side;
  corner?: number;
  n?: [number, number];
}

interface PendingKick {
  body: Body;
  id: string;
  corner: number;
  n: [number, number];
}

export function launchSpeed(phys: PhysicsConfig, power: number, speedMul = 1): number {
  const p = Math.min(1, Math.max(phys.shot.minPower, power));
  return phys.shot.vmax * speedMul * Math.pow(p, phys.shot.gamma);
}

export class SimWorld {
  readonly world: World;
  readonly bodies = new Map<string, Body>();
  readonly ball: Body;
  readonly dt: number;
  private readonly phys: PhysicsConfig;
  private readonly geom: FieldGeometry;

  constructor(geom: FieldGeometry, phys: PhysicsConfig, setup: SimSetup) {
    this.phys = phys;
    this.geom = geom;
    this.dt = 1 / phys.hz;
    Settings.velocityThreshold = phys.velocityThreshold;
    this.world = new World({ gravity: Vec2(0, 0) });

    const ground = this.world.createBody();
    for (const s of fieldSegments(geom)) {
      ground.createFixture(new Edge(Vec2(s.a[0], s.a[1]), Vec2(s.b[0], s.b[1])), {
        friction: phys.friction.wall,
        userData: { kind: s.kind, id: s.kind === 'spring' ? `spring${s.corner}` : s.kind, corner: s.corner, n: s.n } as Tag,
      });
    }
    for (const point of fieldPosts(geom)) {
      const post = this.world.createBody({ position: Vec2(point.x, point.y) });
      post.createFixture(new Circle(point.radius), { userData: { kind: 'post', id: 'post' } as Tag });
    }

    const dr = phys.disc.radius;
    for (const p of setup.pieces) {
      const body = this.world.createBody({
        type: p.fixed ? 'static' : 'dynamic',
        position: Vec2(p.x, p.y),
        fixedRotation: true,
        bullet: true,
      });
      body.createFixture(new Circle(dr), {
        density: p.mass / (Math.PI * dr * dr),
        friction: phys.friction.discDisc,
        userData: { kind: 'disc', id: p.id, side: p.side } as Tag,
      });
      this.bodies.set(p.id, body);
    }
    const br = phys.ball.radius;
    this.ball = this.world.createBody({ type: 'dynamic', position: Vec2(setup.ball.x, setup.ball.y), fixedRotation: true, bullet: true });
    this.ball.createFixture(new Circle(br), {
      density: phys.ball.mass / (Math.PI * br * br),
      friction: phys.friction.discBall,
      userData: { kind: 'ball', id: 'ball' } as Tag,
    });
    this.bodies.set('ball', this.ball);

    this.world.on('pre-solve', (contact: Contact) => {
      const ka = (contact.getFixtureA().getUserData() as Tag).kind;
      const kb = (contact.getFixtureB().getUserData() as Tag).kind;
      contact.setRestitution(this.pairRestitution(ka, kb));
      contact.setFriction(this.pairFriction(ka, kb));
    });
  }

  private pairRestitution(a: ContactKind, b: ContactKind): number {
    const r = this.phys.restitution;
    const has = (k: ContactKind) => a === k || b === k;
    if (has('net')) return r.net;
    if (has('post')) return r.post;
    if (has('spring')) return has('ball') ? r.ballWall : this.phys.spring.restitution;
    if (has('wall')) return has('ball') ? r.ballWall : r.discWall;
    if (has('ball')) return r.discBall;
    return r.discDisc;
  }

  private pairFriction(a: ContactKind, b: ContactKind): number {
    const f = this.phys.friction;
    if (a === 'disc' && b === 'disc') return f.discDisc;
    if ((a === 'disc' || a === 'ball') && (b === 'disc' || b === 'ball')) return f.discBall;
    return f.wall;
  }

  /** Spring kicks applied during the last step (tests use this to exempt deliberate energy gain). */
  kicksThisStep = 0;

  /** Rolling resistance: exponential (air/grass) plus a constant term so bodies come to a clean stop. */
  applyFriction(): boolean {
    let moving = false;
    const dt = this.dt;
    for (const [id, body] of this.bodies) {
      if (!body.isDynamic()) continue;
      const v = body.getLinearVelocity();
      const s = Math.hypot(v.x, v.y);
      if (s === 0) continue;
      const cfg = id === 'ball' ? this.phys.ball : this.phys.disc;
      let ns = s / (1 + cfg.linDamp * dt) - cfg.coulomb * dt;
      if (ns < this.phys.stopSpeed) ns = 0;
      if (ns === 0) body.setLinearVelocity(Vec2(0, 0));
      else {
        body.setLinearVelocity(Vec2(v.x * (ns / s), v.y * (ns / s)));
        moving = true;
      }
    }
    return moving;
  }

  speedOf(id: string): number {
    const v = this.bodies.get(id)!.getLinearVelocity();
    return Math.hypot(v.x, v.y);
  }
}

const MM = 1000;

/**
 * One shot, advanced one fixed step at a time. The step sequence is independent of who drives it
 * (server loop, render loop at any FPS, AI search), so the outcome is identical for identical inputs.
 */
export class ShotRunner {
  readonly sim: SimWorld;
  readonly ids: string[];
  readonly frames: number[][] = [];
  readonly events: SimEvent[] = [];
  readonly shooterTouched: string[] = [];
  readonly shooterPath: { x: number; y: number }[] = [];
  firstContact: SimResult['firstContact'] = null;
  goal: SimResult['goal'] = null;
  ballBoosted = false;
  forcedStop = false;
  maxSpeed = 0;
  step = 0;
  done = false;
  readonly v0: number;

  private readonly phys: PhysicsConfig;
  private readonly geom: FieldGeometry;
  private readonly shot: SimShot;
  private readonly opts: SimOptions;
  private readonly shooter: Body;
  private readonly shooterSide: Side;
  private turnRate: number;
  private readonly maxTurn: number;
  private kicks: PendingKick[] = [];
  private readonly recordEvery: number;
  private readonly maxSteps: number;
  private readonly postGoalSteps: number;
  private readonly setup: SimSetup;
  private curveActive: boolean;
  private curveTurned = 0;
  private pendingBoost = false;
  private shooterHit = false;
  private goalStep = -1;

  constructor(geom: FieldGeometry, phys: PhysicsConfig, setup: SimSetup, shot: SimShot, opts: SimOptions = {}) {
    this.geom = geom;
    this.phys = phys;
    this.shot = shot;
    this.opts = opts;
    this.setup = setup;
    this.sim = new SimWorld(geom, phys, setup);
    const shooter = this.sim.bodies.get(shot.pieceId);
    if (!shooter) throw new Error('unknown shooter ' + shot.pieceId);
    this.shooter = shooter;
    this.shooterSide = setup.pieces.find((p) => p.id === shot.pieceId)!.side;
    this.ids = ['ball', ...setup.pieces.map((p) => p.id)];

    const len = Math.hypot(shot.dirX, shot.dirY) || 1;
    this.v0 = launchSpeed(phys, shot.power, shot.speedMul ?? 1);
    shooter.setLinearVelocity(Vec2((shot.dirX / len) * this.v0, (shot.dirY / len) * this.v0));
    this.turnRate = Math.max(-1, Math.min(1, shot.curve)) * phys.curve.turnRate * (shot.curveMul ?? 1);
    this.curveActive = this.turnRate !== 0;
    this.maxTurn = (phys.curve.maxTurnDeg * Math.PI) / 180;
    this.recordEvery = Math.max(1, Math.round(phys.hz / phys.recordHz));
    this.maxSteps = Math.round((opts.maxSeconds ?? phys.maxSimSeconds) * phys.hz);
    this.postGoalSteps = Math.round(phys.postGoalSeconds * phys.hz);

    this.sim.world.on('begin-contact', (c: Contact) => this.onContact(c));
    if (opts.record !== false) this.record();
    if (opts.traceShooter) this.shooterPath.push(this.pos(this.shooter));
  }

  get t() {
    return this.step * this.sim.dt;
  }

  private pos(b: Body) {
    const p = b.getPosition();
    return { x: p.x, y: p.y };
  }

  private inOppBox(x: number, y: number) {
    const L = this.geom.length / 2;
    return Math.abs(x) <= this.geom.boxWidth / 2 &&
      (this.shooterSide === 0 ? y <= -L + this.geom.boxDepth : y >= L - this.geom.boxDepth);
  }

  private onContact(c: Contact) {
    const fa: Fixture = c.getFixtureA(), fb: Fixture = c.getFixtureB();
    const ta = fa.getUserData() as Tag, tb = fb.getUserData() as Tag;
    const ba = fa.getBody(), bb = fb.getBody();
    const va = ba.getLinearVelocity(), vb = bb.getLinearVelocity();
    const speed = Math.hypot(va.x - vb.x, va.y - vb.y);
    const at = ba.isDynamic() ? ba.getPosition() : bb.getPosition();
    this.events.push({ t: this.t, type: ta.kind + '-' + tb.kind, a: ta.id, b: tb.id, speed, x: at.x, y: at.y });
    const [spr, sprBody, hit, hitBody] = ta.kind === 'spring' ? [ta, ba, tb, bb] : [tb, bb, ta, ba];
    if (spr.kind === 'spring' && hit.kind === 'disc' && hitBody.isDynamic() && sprBody !== hitBody) {
      const v = hitBody.getLinearVelocity();
      const approach = -(v.x * spr.n![0] + v.y * spr.n![1]);
      if (approach > this.phys.spring.minSpeed) this.kicks.push({ body: hitBody, id: hit.id, corner: spr.corner!, n: spr.n! });
    }
    let other: Tag | null = null;
    if (ta.id === this.shot.pieceId) other = tb;
    else if (tb.id === this.shot.pieceId) other = ta;
    if (!other) return;
    // A curving shot that hits a wall keeps curving as its mirror image (not physical, as in the original);
    // touching a player, the ball, a post or the net ends the curve.
    if (other.kind === 'wall' || other.kind === 'spring') this.turnRate = -this.turnRate;
    else this.curveActive = false;
    this.shooterHit = true;
    const sp = this.shooter.getPosition();
    if (!this.firstContact) this.firstContact = { t: this.t, x: sp.x, y: sp.y, other: other.id };
    if (!this.shooterTouched.includes(other.id)) this.shooterTouched.push(other.id);
    if (other.kind === 'ball' && this.shot.ballBoost && !this.ballBoosted) {
      if (!this.shot.ballBoost.requireInBox || this.inOppBox(sp.x, sp.y)) this.pendingBoost = true;
    }
  }

  private record() {
    const f: number[] = [];
    for (const id of this.ids) {
      const p = this.sim.bodies.get(id)!.getPosition();
      f.push(Math.round(p.x * MM), Math.round(p.y * MM));
    }
    this.frames.push(f);
  }

  /** Advance one fixed step. Returns true when the shot is over. */
  stepOnce(): boolean {
    if (this.done) return true;
    const { phys, sim } = this;
    const moving = sim.applyFriction();
    if (!moving) return this.finish();

    // Spin: the heading turns at a constant rate in time, so a fast disc travels nearly straight
    // and the path hooks harder as it slows down. Speed is untouched, so no energy is added.
    if (this.curveActive) {
      const v = this.shooter.getLinearVelocity();
      const ang = this.turnRate * sim.dt;
      this.curveTurned += Math.abs(ang);
      if (this.curveTurned > this.maxTurn) this.curveActive = false;
      else {
        const cs = Math.cos(ang), sn = Math.sin(ang);
        this.shooter.setLinearVelocity(Vec2(v.x * cs - v.y * sn, v.x * sn + v.y * cs));
      }
    }

    const beforeBall = this.pos(sim.ball);
    sim.world.step(sim.dt, phys.velocityIterations, phys.positionIterations);
    this.step++;

    sim.kicksThisStep = this.kicks.length;
    for (const k of this.kicks) {
      const sp = phys.spring;
      const v = k.body.getLinearVelocity();
      let nx = v.x + k.n[0] * sp.boost, ny = v.y + k.n[1] * sp.boost;
      const s = Math.hypot(nx, ny);
      if (s > sp.maxSpeed) { nx *= sp.maxSpeed / s; ny *= sp.maxSpeed / s; }
      k.body.setLinearVelocity(Vec2(nx, ny));
      const p = k.body.getPosition();
      this.events.push({ t: this.t, type: 'spring-kick', a: k.id, b: `spring${k.corner}`, speed: Math.hypot(nx, ny), x: p.x, y: p.y });
    }
    this.kicks = [];

    if (this.pendingBoost) {
      this.pendingBoost = false;
      this.ballBoosted = true;
      const v = sim.ball.getLinearVelocity();
      const m = this.shot.ballBoost!.mul;
      sim.ball.setLinearVelocity(Vec2(v.x * m, v.y * m));
      const bp = sim.ball.getPosition();
      this.events.push({ t: this.t, type: 'skill-boost', a: this.shot.pieceId, b: 'ball', speed: 0, x: bp.x, y: bp.y });
    }
    const bv = sim.ball.getLinearVelocity();
    const bs = Math.hypot(bv.x, bv.y);
    if (bs > phys.maxBallSpeed) sim.ball.setLinearVelocity(Vec2((bv.x * phys.maxBallSpeed) / bs, (bv.y * phys.maxBallSpeed) / bs));
    for (const body of sim.bodies.values()) {
      if (!body.isDynamic()) continue;
      const v = body.getLinearVelocity();
      const s = Math.hypot(v.x, v.y);
      if (s > this.maxSpeed) this.maxSpeed = s;
    }

    if (!this.goal) {
      const bp = sim.ball.getPosition();
      const crossing = goalCrossing(this.geom, phys.ball.radius, beforeBall, bp);
      if (crossing) this.goal = { ...crossing, t: this.t };
      if (this.goal) {
        this.goalStep = this.step;
        this.events.push({ t: this.t, type: 'goal', a: String(this.goal.scoredBy), b: '', speed: 0, x: bp.x, y: bp.y });
      }
    }
    if (this.opts.traceShooter && !this.shooterHit) this.shooterPath.push(this.pos(this.shooter));
    if (this.opts.record !== false && this.step % this.recordEvery === 0) this.record();
    this.opts.onStep?.(this.step, sim);

    if (this.opts.stopAtShooterContact && this.shooterHit) return this.finish();
    if (this.goalStep >= 0 && this.step - this.goalStep >= this.postGoalSteps) return this.finish();
    if (this.step >= this.maxSteps) {
      this.forcedStop = true;
      return this.finish();
    }
    return false;
  }

  private finish(): boolean {
    for (const body of this.sim.bodies.values()) if (body.isDynamic()) body.setLinearVelocity(Vec2(0, 0));
    if (this.opts.record !== false) this.record();
    this.done = true;
    return true;
  }

  /** Current positions in metres, keyed by id ('ball' included). */
  positions(): Record<string, { x: number; y: number }> {
    const out: Record<string, { x: number; y: number }> = {};
    for (const [id, b] of this.sim.bodies) out[id] = this.pos(b);
    return out;
  }

  result(): SimResult {
    const final: SimResult['final'] = { ball: this.pos(this.sim.ball), pieces: {} };
    for (const p of this.setup.pieces) final.pieces[p.id] = this.pos(this.sim.bodies.get(p.id)!);
    return {
      ids: this.ids,
      frames: this.frames,
      steps: this.step,
      duration: this.t,
      goal: this.goal,
      events: this.events,
      shooterTouched: this.shooterTouched,
      ballBoosted: this.ballBoosted,
      final,
      forcedStop: this.forcedStop,
      maxSpeed: this.maxSpeed,
      shooterPath: this.shooterPath,
      firstContact: this.firstContact,
      launchSpeed: this.v0,
    };
  }
}

export function simulateShot(geom: FieldGeometry, phys: PhysicsConfig, setup: SimSetup, shot: SimShot, opts: SimOptions = {}): SimResult {
  const r = new ShotRunner(geom, phys, setup, shot, opts);
  while (!r.stepOnce()) { /* fixed steps until rest */ }
  return r.result();
}

