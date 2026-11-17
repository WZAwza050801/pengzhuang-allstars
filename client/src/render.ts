import type { FieldGeometry, PhysicsConfig } from '../../shared/data';
import type { Side } from '../../shared/physics';
import { QUALITY_PROFILES, type Quality } from './quality';
import { portraitUrl } from './portraits';
import { WebAssetScene } from './assets';
import { fieldArtMapping } from '../../packages/game-core/src/field-art';
import { fieldOutline } from '../../packages/game-core/src/field';
import { worldToView, viewToWorld, clientToWorld, cameraMatrix, fieldViewport, type Camera } from '../../packages/game-core/src/camera';

export interface Skin {
  id: string;
  grassA: string; grassB: string; pattern: string; line: string;
  wallTop: string; wallSide: string; wallTrim: string; outside: string; net: string; goalFrame: string;
  centerStar?: boolean;
  /** Original pitch art (relative to client/public). Present on the "scene_xx" skins. */
  art?: string;
  /** How the art is laid over the playable rectangle: "cover" or "contain". */
  artFit?: string;
  /** Source pixels [left, top, right, bottom) of the playable rectangle inside the full scene. */
  artCrop?: number[];
  artRotate?: number;
  /** The whole original screen (stands, walls, corner springs, score bar), relative to client/public. */
  scene?: string;
  sceneSize?: number[];
  /** "drawn": the whole match screen is painted in code after the 2016 match screenshots (no texture). */
  style?: string;
}

/** Deterministic noise, so the cached backdrop looks the same on every rebuild. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Original score bar in the 1440x1920 scene: cyan | black tab | red, in source pixels. */
const SCENE_BAR = { left: 240, right: 1210, bottom: 100 };

export interface ScenePiece {
  id: string; side: Side; playerId: string; x: number; y: number;
  out: number; frozen: number; anchored: boolean; ready: boolean;
}

export interface Aim {
  pieceId: string;
  from: { x: number; y: number };
  pointer: { x: number; y: number };
  power: number;
  /** Pull distance (m) at which power reaches 100%. */
  maxPull: number;
  path: { x: number; y: number }[];
  ghost: { x: number; y: number } | null;
  valid: boolean;
}

export interface Effect {
  kind: 'ring' | 'spark' | 'text' | 'burst';
  x: number; y: number; t0: number; dur: number; color: string; size: number; text?: string;
}

export interface Scene {
  pieces: ScenePiece[];
  ball: { x: number; y: number; spin: number };
  aim: Aim | null;
  selectable: Set<string>;
  hoverId: string | null;
  effects: Effect[];
  now: number;
  /** Last kick time (ms, same clock as `now`) per corner spring: 0 TL, 1 TR, 2 BR, 3 BL. */
  springHits: number[];
  /** Recent ball positions, oldest first. */
  trail: { x: number; y: number; t: number }[];
}

const SPRING_SIGNS: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const TRAIL_MS = 260;

export const TEAM_COLORS: [string, string] = ['#2f80ed', '#e5483b'];
const TEAM_DARK: [string, string] = ['#1b4f9c', '#9e2a20'];

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private camera: Camera = { cx: 0, cy: 0, scale: 1, side: 0 };
  private get s() { return this.camera.scale; }
  private get cx() { return this.camera.cx; }
  private get cy() { return this.camera.cy; }
  get flip() { return this.camera.side === 1; }
  set flip(value: boolean) { this.camera.side = value ? 1 : 0; }
  skin: Skin;
  private readonly avatars = new Map<string, HTMLImageElement>();
  /** Original corner assembly (stone + coil + dirt), grass keyed out. */
  private springImg: HTMLImageElement | null = null;
  /** Original pitch art, keyed by skin.art. Loaded lazily; absent until it decodes. */
  private readonly artImages = new Map<string, HTMLImageElement>();
  private artKey = '';
  /** This frame drew the full original scene, so its walls, grass and lines replace the procedural ones. */
  private sceneDrawn = false;
  /** CSS pixels at the bottom of the canvas covered by the game's bottom bar (full-scene layout only). */
  reserveBottom = 0;
  private readonly g: FieldGeometry;
  private readonly p: PhysicsConfig;
  private outline: [number, number][] = [];
  private staticCache: HTMLCanvasElement | null = null;
  private staticKey = '';
  private disposed = false;
  private quality: Quality = 'high';
  private readonly resources = new WebAssetScene();
  /** Static layers of the "drawn" skin (backdrop, hedge, grass, walls) at canvas resolution. */
  private drawnCache: HTMLCanvasElement | null = null;
  private drawnKey = '';
  /** Flat colour of a scene picture's bottom edge, so a taller screen continues the ground instead of smearing it. */
  private readonly floorColors = new Map<string, string>();
  /** Full-viewport canvas above every DOM layer, so the pull line can never be clipped or covered. */
  private overlay: HTMLCanvasElement | null = null;
  private octx: CanvasRenderingContext2D | null = null;

  constructor(canvas: HTMLCanvasElement, g: FieldGeometry, p: PhysicsConfig, skin: Skin) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.g = g;
    this.p = p;
    this.skin = skin;
    this.outline = fieldOutline(g);
  }

  attachOverlay(c: HTMLCanvasElement) {
    this.overlay = c;
    this.octx = c.getContext('2d');
  }

  avatar(playerId: string) {
    const cached = this.avatars.get(playerId);
    if (cached) { this.avatars.delete(playerId); this.avatars.set(playerId, cached); return cached; }
    const img = new Image();
    this.resources.bind(portraitUrl(playerId), img);
    this.avatars.set(playerId, img);
    this.trimImages(this.avatars, 32);
    return img;
  }

  /** Bound face URLs, for the portrait smoke check. */
  boundAvatars() {
    return [...this.avatars.entries()].map(([playerId, img]) => ({
      playerId,
      src: this.resources.source(img),
      complete: img.complete && img.naturalWidth > 0,
    }));
  }

  /**
   * Original pitch art for the current skin, or null when the skin has none or it
   * has not decoded yet. The art is the playable area of the 1.5.5 pitch texture
   * (956x1559 px) stretched over the geometry rectangle, so it carries its own
   * grass and white lines: when it is present the procedural grass and line
   * passes are skipped, otherwise the two would double up.
   */
  private artImage(): HTMLImageElement | null {
    const src = this.skin.art;
    if (!src) return null;
    let img = this.artImages.get(src);
    if (!img) {
      img = new Image();
      this.resources.bind(`/${src}`, img, this.quality === 'low' ? 'low' : 'high');
      this.artImages.set(src, img);
      this.trimImages(this.artImages, 4);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  /** Decode the selected field before a calibration capture or explicit scene transition. */
  async preloadField(): Promise<void> {
    const images: HTMLImageElement[] = [];
    for (const src of [this.skin.art, this.skin.scene]) {
      if (!src) continue;
      let image = this.artImages.get(src);
      if (!image) { image = new Image(); this.resources.bind(`/${src}`, image, this.quality === 'low' ? 'low' : 'high'); this.artImages.set(src, image); this.trimImages(this.artImages, 4); }
      images.push(image);
    }
    this.springImage();
    if (this.springImg) images.push(this.springImg);
    await Promise.all(images.map(image => this.resources.wait(image)));
  }

  /**
   * Where the full original scene sits in world metres. artCrop is the playable rectangle in the
   * scene's pixels, so one scene pixel is width/(right-left) metres and the crop lands on [-W,W]x[-L,L].
   */
  private sceneBox() {
    const sk = this.skin;
    if ((!sk.scene && !this.drawn) || !sk.sceneSize || !sk.artCrop) return null;
    return fieldArtMapping(this.g, sk).sceneBox;
  }

  private sceneImage(): HTMLImageElement | null {
    const src = this.skin.scene;
    if (!src) return null;
    let img = this.artImages.get(src);
    if (!img) {
      img = new Image();
      this.resources.bind(`/${src}`, img, this.quality === 'low' ? 'low' : 'high');
      this.artImages.set(src, img);
      this.trimImages(this.artImages, 4);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  private get drawn() {
    return this.skin.style === 'drawn';
  }

  /** True when the skin lays out around the full original scene (score bar on top, stands at the sides). */
  get sceneMode() {
    return !!this.sceneBox();
  }

  /** The original score bar in CSS pixels relative to the canvas, for laying the DOM scoreboard over it. */
  sceneBar() {
    const b = this.sceneBox();
    if (!b) return null;
    const mapping = fieldArtMapping(this.g, this.skin);
    const corners = [{x:SCENE_BAR.left,y:0},{x:SCENE_BAR.right,y:0},{x:SCENE_BAR.right,y:SCENE_BAR.bottom},{x:SCENE_BAR.left,y:SCENE_BAR.bottom}]
      .map(p => worldToView(mapping.sourceToWorld(p), { ...this.camera, side: 0 }));
    const x = Math.min(...corners.map(p=>p.x)), y = Math.min(...corners.map(p=>p.y));
    const w = Math.max(...corners.map(p=>p.x))-x, h = Math.max(...corners.map(p=>p.y))-y;
    return { x, y, w, h, px: w/(SCENE_BAR.right-SCENE_BAR.left) };
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, QUALITY_PROFILES[this.quality].maxDpr);
    // Hidden/zero-sized stages may occur during platform transitions; keep the previous camera until visible.
    if (r.width <= 0 || r.height <= 0) return;
    const layout = fieldViewport(this.g, { width: r.width, height: r.height, dpr: this.dpr, side: this.camera.side, scene: this.sceneBox(), reserveBottom: this.reserveBottom });
    this.camera = layout.camera;
    this.canvas.width = layout.backing.width;
    this.canvas.height = layout.backing.height;
    this.staticKey = '';
    this.drawnKey = '';
    if (this.overlay) {
      this.overlay.width = Math.round(window.innerWidth * this.dpr);
      this.overlay.height = Math.round(window.innerHeight * this.dpr);
    }
  }

  /** Pixels per metre in CSS pixels. */
  get scale() {
    return this.s;
  }

  toScreen(x: number, y: number) {
    return worldToView({ x, y }, this.camera);
  }

  toWorld(sx: number, sy: number) {
    return viewToWorld({ x: sx, y: sy }, this.camera);
  }

  clientToWorld(x: number, y: number) {
    const rect = this.canvas.getBoundingClientRect();
    return clientToWorld({ x, y }, { x: rect.left, y: rect.top }, this.camera);
  }

  private worldTransform() {
    this.ctx.setTransform(...cameraMatrix(this.camera, this.dpr));
  }

  setQuality(quality: Quality) { if (this.quality !== quality) { this.quality = quality; for (const image of this.artImages.values()) this.resources.release(image); this.artImages.clear(); this.floorColors.clear(); this.resize(); } }

  private trimImages(cache: Map<string, HTMLImageElement>, max: number) {
    while (cache.size > max) {
      const key = cache.keys().next().value!;
      this.resources.release(cache.get(key)!); cache.delete(key);
    }
  }

  /** Bounded resource counters for lifecycle acceptance, not a claim about device-wide GPU memory. */
  resourceStats() {
    return { quality: this.quality, avatars: this.avatars.size, art: this.artImages.size,
      floorColors: this.floorColors.size, canvases: Number(!!this.staticCache) + Number(!!this.drawnCache),
      backingPixels: this.canvas.width * this.canvas.height, disposed: this.disposed, assets: this.resources.stats() };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resources.dispose();
    for (const image of [...this.avatars.values(), ...this.artImages.values(), ...(this.springImg ? [this.springImg] : [])]) image.removeAttribute('src');
    this.avatars.clear(); this.artImages.clear(); this.floorColors.clear(); this.springImg = null;
    for (const canvas of [this.staticCache, this.drawnCache, this.overlay, this.canvas]) if (canvas) { canvas.width = 0; canvas.height = 0; }
    this.staticCache = null; this.drawnCache = null; this.overlay = null; this.octx = null;
  }

  draw(sc: Scene) {
    if (this.disposed) return;
    this.drawStaticLayer();
    this.worldTransform();
    this.drawSprings(sc.springHits, sc.now);
    this.drawShadowLayer(sc);
    this.drawTrajectoryLayer(sc);
    this.drawActorLayer(sc);
    this.drawGoalFronts();
    this.drawEffects(sc.effects.slice(-QUALITY_PROFILES[this.quality].maxEffects), sc.now);
    this.drawOverlay(sc.aim);
  }

  private drawStaticLayer() {
    // Readiness participates in the key so the procedural fallback is replaced after an image decodes.
    const art = this.artImage(), scene = this.sceneImage();
    const key = `${this.skin.id}|${this.canvas.width}|${this.canvas.height}|${this.cx}|${this.cy}|${this.s}|${this.flip}|${this.quality}|${art?.naturalWidth ?? 0}|${scene?.naturalWidth ?? 0}`;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.staticCache && this.staticKey === key) { this.ctx.drawImage(this.staticCache, 0, 0); return; }
    this.ctx.fillStyle = this.skin.outside;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.sceneDrawn = this.drawScene();
    this.worldTransform(); this.drawField();
    const cache = this.staticCache ?? document.createElement('canvas');
    cache.width = this.canvas.width; cache.height = this.canvas.height;
    cache.getContext('2d')!.drawImage(this.canvas, 0, 0);
    this.staticCache = cache; this.staticKey = key;
  }

  private drawShadowLayer(sc: Scene) {
    if (!QUALITY_PROFILES[this.quality].shadows) return;
    for (const p of sc.pieces) if (p.out === 0) this.drawShadow(p.x, p.y, this.p.disc.radius);
    this.drawShadow(sc.ball.x, sc.ball.y, this.p.ball.radius);
  }
  private drawTrajectoryLayer(sc: Scene) {
    if (QUALITY_PROFILES[this.quality].trail) this.drawTrail(sc.trail, sc.now);
  }
  private drawActorLayer(sc: Scene) {
    this.drawBall(sc.ball.x, sc.ball.y, sc.ball.spin);
    for (const p of sc.pieces) if (p.out === 0) this.drawPiece(p, sc);
  }

  /**
   * The full original scene, never flipped: it is symmetric about the pitch centre except for the
   * stands and the score bar, which must stay on top for both players.
   */
  private drawScene(): boolean {
    const b = this.sceneBox();
    if (b && this.drawn) return this.drawDrawnScene(b);
    const img = b && this.sceneImage();
    if (!b || !img) return false;
    const ctx = this.ctx, k = this.s * this.dpr;
    ctx.setTransform(k, 0, 0, k, this.cx * this.dpr, this.cy * this.dpr);
    const mapping = fieldArtMapping(this.g, this.skin);
    ctx.save();
    ctx.transform(...mapping.matrix);
    ctx.drawImage(img, 0, 0, this.skin.sceneSize![0], this.skin.sceneSize![1]);
    ctx.restore();
    // The original scene is 3:4. A phone or a desktop window is taller, so the picture ends
    // above the bottom bar. Stretching those last pixels turns the hedge into vertical streaks.
    const viewBottom = (this.canvas.height / this.dpr - this.cy) / this.s;
    const sceneBottom = b.y0 + b.h;
    if (viewBottom > sceneBottom) {
      const left = -this.cx / this.s, right = (this.canvas.width / this.dpr - this.cx) / this.s;
      ctx.fillStyle = this.sceneFloor(img);
      ctx.fillRect(left, sceneBottom, right - left, viewBottom - sceneBottom);
    }
    return true;
  }

  /** Average of the paving along the bottom-centre of the scene, cached per image. */
  private sceneFloor(img: HTMLImageElement): string {
    const hit = this.floorColors.get(img.src);
    if (hit) return hit;
    const sample = document.createElement('canvas');
    sample.width = 24;
    sample.height = 1;
    const sx = sample.getContext('2d', { willReadFrequently: true });
    if (!sx || img.naturalWidth < 1 || img.naturalHeight < 1) return this.skin.outside;
    const band = Math.min(4, img.naturalHeight);
    const cropX = Math.floor(img.naturalWidth * 0.35);
    const cropW = Math.max(1, Math.floor(img.naturalWidth * 0.3));
    sx.drawImage(img, cropX, img.naturalHeight - band, cropW, band, 0, 0, 24, 1);
    const px = sx.getImageData(0, 0, 24, 1).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      r += px[i]; g += px[i + 1]; b += px[i + 2]; n += 1;
    }
    const color = n ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` : this.skin.outside;
    this.floorColors.set(img.src, color);
    if (this.floorColors.size > 4) this.floorColors.delete(this.floorColors.keys().next().value!);
    return color;
  }

  /** The "drawn" skin: static layers are painted once per layout into drawnCache, then blitted every frame. */
  private drawDrawnScene(b: { k: number; ky: number; x0: number; y0: number; w: number; h: number }): boolean {
    const cw = this.canvas.width, ch = this.canvas.height;
    const key = `${this.skin.id}|${cw}x${ch}|${this.s}|${this.cx}|${this.cy}|${this.flip}`;
    if (!this.drawnCache || key !== this.drawnKey) {
      const c = this.drawnCache ?? document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const x = c.getContext('2d')!;
      const k = this.s * this.dpr;
      x.setTransform(k, 0, 0, k, this.cx * this.dpr, this.cy * this.dpr);
      const view = { l: -this.cx / this.s, r: (cw / this.dpr - this.cx) / this.s, t: -this.cy / this.s, b: (ch / this.dpr - this.cy) / this.s };
      this.paintBackdrop(x, b, view);
      const f = (this.flip ? -1 : 1) * k;
      x.setTransform(f, 0, 0, f, this.cx * this.dpr, this.cy * this.dpr);
      this.paintPitch(x);
      this.drawnCache = c;
      this.drawnKey = key;
    }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.drawnCache, 0, 0);
    return true;
  }

  /** Never flipped: ground, red stands, hedge ring, bunting and rocks, and the cyan | black | red score bar. */
  private paintBackdrop(x: CanvasRenderingContext2D, b: { k: number; ky: number; x0: number; y0: number }, v: { l: number; r: number; t: number; b: number }) {
    const g = this.g, W = g.width / 2, L = g.length / 2;
    const rand = rng(2016);

    x.fillStyle = '#c5cd6d';
    x.fillRect(v.l, v.t, v.r - v.l, v.b - v.t);
    for (let i = 0; i < 220; i++) {
      x.beginPath();
      x.ellipse(v.l + rand() * (v.r - v.l), v.t + rand() * (v.b - v.t), 0.2 + rand() * 0.5, 0.1 + rand() * 0.25, rand() * Math.PI, 0, Math.PI * 2);
      x.fillStyle = rand() < 0.5 ? 'rgba(150,170,60,0.18)' : 'rgba(240,240,160,0.2)';
      x.fill();
    }

    const sx0 = W + 0.5;
    for (const s of [-1, 1]) {
      const a = s < 0 ? v.l : sx0, w = s < 0 ? -sx0 - v.l : v.r - sx0;
      if (w <= 0) continue;
      x.fillStyle = '#c43f4c';
      x.fillRect(a, v.t, w, v.b - v.t);
      x.fillStyle = '#9c2b3a';
      for (let y = Math.floor(v.t / 0.22) * 0.22; y < v.b; y += 0.22) x.fillRect(a, y, w, 0.06);
      x.fillStyle = '#e8838a';
      x.fillRect(s < 0 ? -sx0 - 0.05 : sx0, v.t, 0.05, v.b - v.t);
    }

    // hedge ring around the walls
    const hx = W + 0.45, hy = L + 0.8, hr = 0.4;
    x.fillStyle = 'rgba(40,60,10,0.22)';
    x.beginPath();
    x.roundRect(-hx, -hy + 0.08, 2 * hx, 2 * hy, hr);
    x.fill();
    x.fillStyle = '#3a8f16';
    x.beginPath();
    x.roundRect(-hx, -hy, 2 * hx, 2 * hy, hr);
    x.fill();
    const leaves = ['#3f9b18', '#4daa1f', '#5cbb28', '#6fca35'];
    for (let py = -hy + 0.04; py < hy; py += 0.075) {
      for (let px = -hx + 0.04; px < hx; px += 0.085) {
        const lx = px + (rand() - 0.5) * 0.05, ly = py + (rand() - 0.5) * 0.04;
        if (Math.abs(lx) < W && Math.abs(ly) < L) continue;
        const dx = Math.max(0, Math.abs(lx) - (hx - hr)), dy = Math.max(0, Math.abs(ly) - (hy - hr));
        if (dx * dx + dy * dy > (hr - 0.04) ** 2) continue;
        const r0 = 0.05 + rand() * 0.03;
        x.fillStyle = leaves[Math.floor(rand() * leaves.length)];
        x.beginPath();
        x.ellipse(lx, ly, r0, r0 * 0.75, rand() * Math.PI, 0, Math.PI * 2);
        x.fill();
        x.fillStyle = 'rgba(200,245,130,0.35)';
        x.beginPath();
        x.ellipse(lx - r0 * 0.25, ly - r0 * 0.3, r0 * 0.45, r0 * 0.22, -0.5, 0, Math.PI * 2);
        x.fill();
      }
    }

    // bunting between the score bar and the hedge
    const barBottom = b.y0 + 100 * b.ky;
    const yb = (barBottom - hy) / 2 - 0.12;
    const colors = ['#33a9e6', '#ff6f91', '#f39a2b', '#41c9d6', '#ffd43b', '#8c6ce0'];
    let ci = 0;
    for (const [x0, x1] of [[-W - 0.7, -0.25], [0.25, W + 0.7]]) {
      const at = (t: number) => ({ x: x0 + (x1 - x0) * t, y: yb - 0.08 + 0.2 * 4 * t * (1 - t) });
      x.strokeStyle = '#f4f1e6';
      x.lineWidth = 0.015;
      x.beginPath();
      for (let t = 0; t <= 1.001; t += 0.05) {
        const p = at(t);
        if (t === 0) x.moveTo(p.x, p.y); else x.lineTo(p.x, p.y);
      }
      x.stroke();
      const n = Math.floor((x1 - x0) / 0.32);
      for (let i = 0; i < n; i++) {
        const p = at((i + 0.3) / n), q = at((i + 0.3) / n + 0.16 / (x1 - x0));
        x.beginPath();
        x.moveTo(p.x, p.y);
        x.lineTo(q.x, q.y);
        x.lineTo((p.x + q.x) / 2, (p.y + q.y) / 2 + 0.22);
        x.closePath();
        x.fillStyle = colors[ci++ % colors.length];
        x.fill();
        x.fillStyle = 'rgba(0,0,0,0.12)';
        x.beginPath();
        x.moveTo((p.x + q.x) / 2, (p.y + q.y) / 2);
        x.lineTo(q.x, q.y);
        x.lineTo((p.x + q.x) / 2, (p.y + q.y) / 2 + 0.22);
        x.closePath();
        x.fill();
      }
    }

    const rock = (rx: number, ry: number, r: number) => {
      const pts: [number, number][] = [];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2, rr = r * (0.75 + rand() * 0.3);
        pts.push([rx + Math.cos(a) * rr * 1.2, ry + Math.sin(a) * rr * 0.8]);
      }
      x.fillStyle = 'rgba(60,70,20,0.25)';
      x.beginPath();
      x.ellipse(rx + 0.03, ry + r * 0.6, r * 1.2, r * 0.4, 0, 0, Math.PI * 2);
      x.fill();
      x.beginPath();
      pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
      x.closePath();
      x.fillStyle = '#9aa3ad';
      x.fill();
      x.fillStyle = '#c9cfd6';
      x.beginPath();
      x.ellipse(rx - r * 0.2, ry - r * 0.25, r * 0.7, r * 0.35, -0.2, 0, Math.PI * 2);
      x.fill();
    };
    rock(-W - 0.15, yb + 0.25, 0.14);
    rock(-W + 0.75, yb + 0.05, 0.11);
    rock(W - 0.6, yb - 0.02, 0.1);
    rock(W + 0.2, yb + 0.28, 0.13);
    rock(-W + 0.4, hy + 0.3, 0.12);
    rock(W - 0.3, hy + 0.35, 0.14);

    // score bar: cyan | black tab | red; the DOM scoreboard sits on top
    const bx = (p: number) => b.x0 + p * b.k, by = (p: number) => b.y0 + p * b.ky, k = b.k;
    const bar = (l: number, r: number, bottom: number, radii: number[], top: string, bot: string, edge: string) => {
      x.beginPath();
      x.roundRect(bx(l), by(-40), bx(r) - bx(l), by(bottom) - by(-40), radii.map((q) => q * k));
      x.fillStyle = edge;
      x.fill();
      const grad = x.createLinearGradient(0, by(0), 0, by(bottom));
      grad.addColorStop(0, top);
      grad.addColorStop(1, bot);
      x.beginPath();
      x.roundRect(bx(l), by(-40), bx(r) - bx(l), by(bottom - 9) - by(-40), radii.map((q) => q * k));
      x.fillStyle = grad;
      x.fill();
    };
    bar(240, 660, 100, [0, 0, 0, 30], '#55c6ec', '#2b8fc6', '#1d6593');
    bar(784, 1210, 100, [0, 0, 30, 0], '#f2645d', '#c93a33', '#8e231f');
    bar(628, 816, 132, [0, 0, 34, 34], '#41444d', '#25272d', '#121316');
  }

  /** Flipped with the world: wall band, corner stones, goal pockets, checker grass and lines. */
  private paintPitch(x: CanvasRenderingContext2D) {
    const g = this.g, sk = this.skin;
    const W = g.width / 2, L = g.length / 2, gw = g.goalWidth / 2, gd = g.goalDepth, c = g.cornerCut;
    const rand = rng(916);
    const outline = () => {
      x.beginPath();
      this.outline.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
      x.closePath();
    };

    // corner flags on the hedge
    for (const [sx, sy] of SPRING_SIGNS) {
      const px = sx * (W + 0.22), py = sy * (L + 0.22);
      x.strokeStyle = '#a7b0bf';
      x.lineWidth = 0.035;
      x.lineCap = 'round';
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px + sx * 0.12, py - 0.42);
      x.stroke();
      x.beginPath();
      x.moveTo(px + sx * 0.12, py - 0.42);
      x.lineTo(px + sx * 0.4, py - 0.32);
      x.lineTo(px + sx * 0.1, py - 0.24);
      x.closePath();
      x.fillStyle = '#f5862b';
      x.fill();
    }

    // white wall band and corner stones
    x.lineJoin = 'round';
    const T = 0.18;
    for (const [sx, sy] of SPRING_SIGNS) {
      x.beginPath();
      x.moveTo(sx * (W - c - 0.05), sy * (L + T));
      x.lineTo(sx * (W + T * 0.7), sy * (L + T * 0.7));
      x.lineTo(sx * (W + T), sy * (L - c - 0.05));
      x.lineTo(sx * W, sy * (L - c));
      x.lineTo(sx * (W - c), sy * L);
      x.closePath();
      x.fillStyle = '#f8f7f3';
      x.fill();
    }
    outline();
    x.strokeStyle = 'rgba(40,60,10,0.3)';
    x.lineWidth = 2 * T + 0.08;
    x.stroke();
    x.strokeStyle = '#cfcdc4';
    x.lineWidth = 2 * T + 0.03;
    x.stroke();
    x.strokeStyle = '#f8f7f3';
    x.lineWidth = 2 * T - 0.04;
    x.stroke();

    // goal pockets: grass inside the net
    for (const s of [-1, 1]) {
      x.fillStyle = '#93bf41';
      x.fillRect(-gw, s < 0 ? -L - gd : L, 2 * gw, gd);
      x.fillStyle = 'rgba(40,70,10,0.25)';
      x.fillRect(-gw, s < 0 ? -L - gd : L + gd - 0.06, 2 * gw, 0.06);
    }

    // checker grass
    x.save();
    outline();
    x.clip();
    x.fillStyle = sk.grassA;
    x.fillRect(-W, -L, 2 * W, 2 * L);
    x.fillStyle = sk.grassB;
    const n = g.width / 17;
    for (let i = 0; i * n < 2 * W; i++) for (let j = 0; j * n < 2 * L + n; j++) if ((i + j) % 2) x.fillRect(-W + i * n, -L + j * n, n + 0.001, n + 0.001);
    for (let i = 0; i < 2600; i++) {
      x.fillStyle = rand() < 0.5 ? 'rgba(255,255,220,0.08)' : 'rgba(40,80,0,0.08)';
      x.fillRect(-W + rand() * 2 * W, -L + rand() * 2 * L, 0.025, 0.025);
    }

    x.strokeStyle = sk.line;
    x.lineWidth = 0.05;
    x.beginPath();
    x.moveTo(-W, 0); x.lineTo(W, 0);
    x.moveTo(g.centerRadius, 0);
    x.arc(0, 0, g.centerRadius, 0, Math.PI * 2);
    for (const s of [-1, 1]) {
      const y = s * L;
      x.rect(-g.boxWidth / 2, s < 0 ? y : y - g.boxDepth, g.boxWidth, g.boxDepth);
      const yb = y - s * g.boxDepth;
      x.moveTo(g.arcRadius, yb);
      x.arc(0, yb, g.arcRadius, s < 0 ? 0 : Math.PI, s < 0 ? Math.PI : 0);
    }
    x.stroke();
    x.fillStyle = sk.line;
    for (const [px, py, r] of [[0, 0, 0.07], [0, -(L - g.penaltySpot), 0.05], [0, L - g.penaltySpot, 0.05]]) {
      x.beginPath();
      x.arc(px, py, r, 0, Math.PI * 2);
      x.fill();
    }

    // soft shadow the wall casts on the grass, then grass tufts along its foot
    for (const [w, a] of [[0.34, 0.08], [0.2, 0.1], [0.09, 0.12]]) {
      outline();
      x.strokeStyle = `rgba(30,60,0,${a})`;
      x.lineWidth = w;
      x.stroke();
    }
    x.fillStyle = '#86b636';
    for (let e = 0; e < this.outline.length; e++) {
      const [ax, ay] = this.outline[e], [bx2, by2] = this.outline[(e + 1) % this.outline.length];
      const len = Math.hypot(bx2 - ax, by2 - ay), ux = (bx2 - ax) / len, uy = (by2 - ay) / len;
      let nx = -uy, ny = ux;
      if (nx * (ax + bx2) + ny * (ay + by2) > 0) { nx = -nx; ny = -ny; }
      x.beginPath();
      for (let t = 0.02; t < len - 0.02; t += 0.06) {
        const px = ax + ux * t, py = ay + uy * t;
        if (Math.abs(py) > L - 0.01 && Math.abs(px) < gw) continue;
        const h = 0.035 + rand() * 0.025;
        x.moveTo(px - ux * 0.025, py - uy * 0.025);
        x.lineTo(px + nx * h, py + ny * h);
        x.lineTo(px + ux * 0.025, py + uy * 0.025);
      }
      x.fill();
    }
    x.restore();

    // goal line across the mouth
    x.strokeStyle = sk.line;
    x.lineWidth = 0.05;
    x.beginPath();
    x.moveTo(-gw, -L); x.lineTo(gw, -L);
    x.moveTo(-gw, L); x.lineTo(gw, L);
    x.stroke();
  }

  /** Red corner bumpers with two coils on the stone, kicked back by springHits. */
  private drawBumpers(hits: number[], now: number) {
    const ctx = this.ctx, g = this.g;
    const W = g.width / 2, L = g.length / 2, c = g.cornerCut;
    const half = (c * Math.SQRT2) / 2;
    for (let i = 0; i < 4; i++) {
      const [sx, sy] = SPRING_SIGNS[i];
      const { disp, glow } = this.springMotion(hits[i] ?? -1e9, now);
      ctx.save();
      ctx.translate(sx * (W - c / 2), sy * (L - c / 2));
      // local +y points out of the pitch, into the corner stone
      ctx.rotate(Math.atan2(sy, sx) - Math.PI / 2);
      const by = 0.05 - disp * 0.6;
      ctx.lineCap = 'round';
      for (const cxl of [-half * 0.45, half * 0.45]) {
        const top = by + 0.05, bot = 0.2;
        for (let j = 0; j < 3; j++) {
          const y = bot + (top - bot) * (j / 2);
          ctx.strokeStyle = '#6f7d99';
          ctx.lineWidth = 0.024;
          ctx.beginPath();
          ctx.ellipse(cxl, y, 0.075, 0.026, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = '#dde3ef';
          ctx.lineWidth = 0.01;
          ctx.beginPath();
          ctx.ellipse(cxl, y, 0.075, 0.026, 0, Math.PI, 0);
          ctx.stroke();
        }
      }
      const arc = (dy: number) => {
        ctx.beginPath();
        ctx.moveTo(-half * 1.05, by + dy + 0.05);
        ctx.quadraticCurveTo(0, by + dy - 0.1, half * 1.05, by + dy + 0.05);
      };
      if (glow > 0.01) {
        arc(0);
        ctx.strokeStyle = `rgba(255,236,200,${(0.6 * glow).toFixed(3)})`;
        ctx.lineWidth = 0.2;
        ctx.stroke();
      }
      arc(0.016);
      ctx.strokeStyle = '#8e2723';
      ctx.lineWidth = 0.14;
      ctx.stroke();
      arc(0);
      ctx.strokeStyle = '#dc4a42';
      ctx.lineWidth = 0.115;
      ctx.stroke();
      arc(-0.028);
      ctx.strokeStyle = '#f59486';
      ctx.lineWidth = 0.03;
      ctx.stroke();
      ctx.restore();
    }
  }

  /** White goal frames with net, standing outside the wall over the hedge; drawn over the ball. */
  private drawGoalFrames() {
    const ctx = this.ctx, g = this.g;
    const L = g.length / 2, gw = g.goalWidth / 2, gd = g.goalDepth;
    // The frame reaches past the physical pocket (goalDepth) over the hedge, like the raised goal in the screenshots.
    const depth = gd + 0.24;
    for (const s of [-1, 1]) {
      const y0 = s * L, y1 = s * (L + depth), yc = s * (L + depth * 0.42);
      ctx.save();
      ctx.beginPath();
      ctx.rect(-gw, Math.min(y0, y1), 2 * gw, depth);
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(-gw, Math.min(yc, y1), 2 * gw, Math.abs(y1 - yc));
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      for (let px = -gw; px <= gw + 1e-6; px += (2 * gw) / 18) { ctx.moveTo(px, y0); ctx.lineTo(px, yc); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.78)';
      ctx.lineWidth = 0.016;
      ctx.beginPath();
      for (let px = -gw; px <= gw + 1e-6; px += (2 * gw) / 18) { ctx.moveTo(px, yc); ctx.lineTo(px, y1); }
      for (let t = depth * 0.42; t <= depth + 1e-6; t += (depth * 0.58) / 3) { ctx.moveTo(-gw, y0 + s * t); ctx.lineTo(gw, y0 + s * t); }
      ctx.stroke();
      ctx.restore();

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const frame = (dy: number) => {
        ctx.beginPath();
        ctx.moveTo(-gw, y0 + dy);
        ctx.lineTo(-gw, y1 + dy);
        ctx.lineTo(gw, y1 + dy);
        ctx.lineTo(gw, y0 + dy);
        ctx.moveTo(-gw, yc + dy);
        ctx.lineTo(gw, yc + dy);
      };
      frame(0.05);
      ctx.strokeStyle = 'rgba(30,50,10,0.3)';
      ctx.lineWidth = 0.07;
      ctx.stroke();
      frame(0);
      ctx.strokeStyle = '#b9bdc4';
      ctx.lineWidth = 0.095;
      ctx.stroke();
      ctx.strokeStyle = '#fdfdfb';
      ctx.lineWidth = 0.068;
      ctx.stroke();
      for (const px of [-gw, gw]) {
        ctx.beginPath();
        ctx.arc(px, y0, g.postRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#fdfdfb';
        ctx.fill();
        ctx.strokeStyle = '#b9bdc4';
        ctx.lineWidth = 0.015;
        ctx.stroke();
      }
    }
  }

  /** Everything that belongs to aiming is drawn last, above the pitch, the pieces and the HUD. */
  private drawOverlay(aim: Aim | null) {
    const o = this.overlay, octx = this.octx;
    if (!o || !octx) {
      if (aim) {
        this.drawPowerRing(aim, this.ctx);
        this.drawAimOver(aim, this.ctx);
      }
      return;
    }
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, o.width, o.height);
    if (!aim) return;
    const r = this.canvas.getBoundingClientRect();
    octx.setTransform(...cameraMatrix(this.camera, this.dpr, { x: r.left, y: r.top }));
    this.drawPowerRing(aim, octx);
    this.drawAimOver(aim, octx);
  }

  /**
   * Corner cut from the 1.5.5 pitch photo. Grass is transparent.
   * 956 px is the playable width of that photo, so one source pixel is `width/956` metres.
   */
  private springImage(): HTMLImageElement | null {
    if (!this.springImg) {
      const img = new Image();
      this.resources.bind('/assets/fields/spring_corner.png', img);
      this.springImg = img;
    }
    return this.springImg.complete && this.springImg.naturalWidth > 0 ? this.springImg : null;
  }

  private springMotion(hit: number, now: number) {
    const tau = (now - hit) / 1000;
    if (tau < 0 || tau >= 0.9) return { disp: 0, glow: 0 };
    const disp = tau < 0.05
      ? -0.07 * Math.sin((Math.PI * tau) / 0.05)
      : 0.13 * Math.exp(-6 * (tau - 0.05)) * Math.sin(19 * (tau - 0.05));
    return { disp, glow: Math.exp(-5 * tau) };
  }

  /** Corner springs. The photo's own corner is clipped off by the chamfer, so this puts it back. */
  private drawSprings(hits: number[], now: number) {
    if (this.drawn) return this.drawBumpers(hits, now);
    const img = this.springImage();
    if (img) this.drawSpringSprites(img, hits, now);
    else if (!this.sceneDrawn) this.drawSpringFallback(hits, now);
  }

  private drawSpringSprites(img: HTMLImageElement, hits: number[], now: number) {
    const ctx = this.ctx, g = this.g;
    const W = g.width / 2, L = g.length / 2, c = g.cornerCut;
    const size = img.naturalWidth * (g.width / 956);
    for (let i = 0; i < 4; i++) {
      const [sx, sy] = SPRING_SIGNS[i];
      const { disp, glow } = this.springMotion(hits[i] ?? -1e9, now);
      // The full scene already shows every corner at rest; only the bounce needs the sprite.
      if (this.sceneDrawn && disp === 0 && glow <= 0.01) continue;
      // Negative disp pulls the assembly into the corner; the rebound overshoots into the pitch.
      const squash = Math.min(1.08, Math.max(0.88, 1 + disp * 0.9));
      ctx.save();
      ctx.translate(sx * W, sy * L);
      ctx.scale(-sx * squash, -sy * squash);
      if (this.skin.art || this.sceneDrawn) {
        // Only the chamfer triangle. The rest of the assembly is already in the pitch photo,
        // and a second copy would sit a JPEG apart from that photo.
        const reach = (c + 0.04) / squash;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(reach, 0);
        ctx.lineTo(0, reach);
        ctx.closePath();
        ctx.clip();
      }
      ctx.drawImage(img, 0, 0, size, size);
      if (glow > 0.01) {
        ctx.globalAlpha = 0.35 * glow;
        ctx.drawImage(img, 0, 0, size, size);
      }
      ctx.restore();
    }
  }

  /** Shown until the corner sprite has decoded: stone, blue-gray coils, sand. */
  private drawSpringFallback(hits: number[], now: number) {
    const ctx = this.ctx, g = this.g;
    const W = g.width / 2, L = g.length / 2, c = g.cornerCut;
    const h = c * Math.SQRT1_2;
    for (let i = 0; i < 4; i++) {
      const [sx, sy] = SPRING_SIGNS[i];
      const { disp, glow } = this.springMotion(hits[i] ?? -1e9, now);
      ctx.save();
      const mx = sx * (W - c / 2), my = sy * (L - c / 2);
      ctx.translate(mx, my);
      ctx.rotate(Math.atan2(sy, sx) - Math.PI / 2);
      const half = (c * Math.SQRT2) / 2;
      ctx.beginPath();
      ctx.moveTo(-half, 0); ctx.lineTo(half, 0); ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = '#f0f0ee';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-half * 0.55, 0); ctx.lineTo(half * 0.55, 0); ctx.lineTo(0, -h * 0.42);
      ctx.closePath();
      ctx.fillStyle = '#d9c08a';
      ctx.fill();
      const padY = -disp;
      ctx.strokeStyle = '#6b7a9c';
      ctx.lineWidth = 0.035;
      ctx.lineCap = 'round';
      const top = padY + 0.04, bot = h * 0.72;
      for (let k = 0; k < 3; k++) {
        const y = bot + (top - bot) * ((k + 0.5) / 3);
        ctx.beginPath();
        ctx.ellipse(0, y, half * 0.34, 0.045, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = '#c5d0e4';
      ctx.lineWidth = 0.015;
      ctx.beginPath();
      ctx.ellipse(0, top, half * 0.34, 0.045, 0, Math.PI, 0);
      ctx.stroke();
      if (glow > 0.01) {
        ctx.globalAlpha = 0.45 * glow;
        ctx.strokeStyle = '#e8eef8';
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.ellipse(0, top, half * 0.4, 0.06, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** Short fading streak behind the rolling ball; strength follows ball speed. */
  private drawTrail(trail: { x: number; y: number; t: number }[], now: number) {
    if (trail.length < 2) return;
    const ctx = this.ctx, br = this.p.ball.radius;
    ctx.lineCap = 'round';
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      const dt = Math.max(1, b.t - a.t) / 1000;
      const speed = Math.hypot(b.x - a.x, b.y - a.y) / dt;
      const age = 1 - (now - b.t) / TRAIL_MS;
      const k = Math.min(1, Math.max(0, (speed - 0.8) / 7)) * Math.max(0, age);
      if (k <= 0.01) continue;
      ctx.strokeStyle = `rgba(255,255,255,${(0.3 * k).toFixed(3)})`;
      ctx.lineWidth = br * 1.7 * Math.max(0.15, age);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  private path(points: [number, number][]) {
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  private drawField() {
    const ctx = this.ctx, g = this.g, sk = this.skin;
    const W = g.width / 2, L = g.length / 2, gw = g.goalWidth / 2, gd = g.goalDepth;
    if (this.drawn && this.sceneDrawn) return;

    const full = this.sceneDrawn;
    // walls: a thick band hugging the outline (the full scene has its own stone walls)
    if (!full) {
      ctx.lineJoin = 'round';
      this.path(this.outline);
      ctx.strokeStyle = sk.wallSide;
      ctx.lineWidth = 0.62;
      ctx.stroke();
      ctx.strokeStyle = sk.wallTop;
      ctx.lineWidth = 0.44;
      ctx.stroke();
      ctx.strokeStyle = sk.wallTrim;
      ctx.lineWidth = 0.1;
      ctx.stroke();
    }

    // goal pockets: the photo's own gap is wider than the physics mouth, so the
    // stone stops exactly at geometry.goalWidth and the opening outside that is clear.
    for (const s of [-1, 1]) {
      const yLine = s * L;
      const yOut = s * (L + gd);
      const yLip = yLine - s * 0.08;
      const outer = Math.min(yOut, yLip);
      const inner = Math.max(yOut, yLip);
      if (!full) {
        ctx.fillStyle = sk.outside;
        ctx.fillRect(-gw, Math.min(yLine, yOut), gw * 2, gd);
        ctx.save();
        ctx.beginPath();
        ctx.rect(-gw, Math.min(yLine, yOut), gw * 2, gd);
        ctx.clip();
        ctx.strokeStyle = sk.net;
        ctx.lineWidth = 0.012;
        ctx.beginPath();
        for (let x = -gw - gd; x <= gw + gd; x += 0.22) {
          ctx.moveTo(x, yLine); ctx.lineTo(x + gd, yOut);
          ctx.moveTo(x, yOut); ctx.lineTo(x + gd, yLine);
        }
        ctx.stroke();
        ctx.restore();
      }
      if (full) continue;
      ctx.fillStyle = sk.goalFrame;
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? -W + g.cornerCut : gw;
        const x1 = side < 0 ? -gw : W - g.cornerCut;
        ctx.fillRect(x0, outer, x1 - x0, inner - outer);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        const hy = s < 0 ? outer : inner - 0.035;
        ctx.fillRect(x0, hy, x1 - x0, 0.035);
        ctx.fillStyle = sk.goalFrame;
        ctx.strokeStyle = 'rgba(120,120,118,0.45)';
        ctx.lineWidth = 0.012;
        ctx.beginPath();
        const span = x1 - x0;
        const seams = Math.max(2, Math.round(span / (g.goalWidth / 6)));
        for (let i = 1; i < seams; i++) {
          const x = x0 + (span * i) / seams;
          ctx.moveTo(x, outer);
          ctx.lineTo(x, inner);
        }
        ctx.stroke();
      }
    }

    // grass
    ctx.save();
    this.path(this.outline);
    ctx.clip();
    // The original pitch art carries its own grass and white lines and is cropped to
    // exactly the playable rectangle, so it replaces both instead of being drawn under
    // them (that would double the lines).
    const art = full ? null : this.artImage();
    if (art) {
      ctx.drawImage(art, -W, -L, 2 * W, 2 * L);
    } else if (!full) {
    ctx.fillStyle = sk.grassA;
    ctx.fillRect(-W, -L, 2 * W, 2 * L);
    ctx.fillStyle = sk.grassB;
    if (sk.pattern === 'checker') {
      const n = 0.6;
      for (let i = 0; i * n < 2 * W; i++) for (let j = 0; j * n < 2 * L; j++) if ((i + j) % 2) ctx.fillRect(-W + i * n, -L + j * n, n, n);
    } else if (sk.pattern === 'stripes') {
      for (let j = 0; j * 0.8 < 2 * L; j += 2) ctx.fillRect(-W, -L + j * 0.8, 2 * W, 0.8);
    } else if (sk.pattern === 'rings') {
      for (let r = 7; r > 0; r -= 0.7) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = Math.round(r / 0.7) % 2 ? sk.grassA : sk.grassB;
        ctx.fill();
      }
    }
    // lines
    ctx.strokeStyle = sk.line;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(-W, 0); ctx.lineTo(W, 0);
    ctx.moveTo(g.centerRadius, 0);
    ctx.arc(0, 0, g.centerRadius, 0, Math.PI * 2);
    for (const s of [-1, 1]) {
      const y = s * L;
      ctx.rect(-g.boxWidth / 2, s < 0 ? y : y - g.boxDepth, g.boxWidth, g.boxDepth);
      if (g.smallBoxWidth > 0) ctx.rect(-g.smallBoxWidth / 2, s < 0 ? y : y - g.smallBoxDepth, g.smallBoxWidth, g.smallBoxDepth);
      const yb = y - s * g.boxDepth;
      ctx.moveTo(g.arcRadius, yb);
      ctx.arc(0, yb, g.arcRadius, s < 0 ? 0 : Math.PI, s < 0 ? Math.PI : 0);
    }
    ctx.stroke();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(0, s * (L - g.penaltySpot), 0.05, 0, Math.PI * 2);
      ctx.fillStyle = sk.line;
      ctx.fill();
    }
    ctx.fillStyle = sk.line;
    ctx.beginPath();
    ctx.arc(0, 0, 0.08, 0, Math.PI * 2);
    ctx.fill();
    if (sk.centerStar) this.star(0, 0, 0.75, 0.32, 'rgba(230,255,250,0.25)');
    }
    ctx.restore();

    // goal line across the mouth
    ctx.strokeStyle = sk.line;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(-gw, -L); ctx.lineTo(gw, -L);
    ctx.moveTo(-gw, L); ctx.lineTo(gw, L);
    ctx.stroke();
  }

  /** Coil at each post, in place of the old round cap. The mouth itself is geometry.goalWidth. */
  private drawGoalFronts() {
    if (this.drawn) return this.drawGoalFrames();
    const ctx = this.ctx, g = this.g;
    const L = g.length / 2, gw = g.goalWidth / 2;
    for (const sy of [-1, 1]) for (const sx of [-1, 1]) {
      ctx.save();
      ctx.translate(sx * gw, sy * L);
      ctx.strokeStyle = '#6b7a9c';
      ctx.lineWidth = 0.028;
      ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.ellipse(0, sy * (0.05 + k * 0.05), 0.13, 0.03, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = '#e4ebf6';
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      ctx.ellipse(0, sy * 0.05, 0.13, 0.03, 0, 0, Math.PI);
      ctx.stroke();
      ctx.restore();
    }
  }

  private star(x: number, y: number, R: number, r: number, fill: string) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r : R;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  private drawShadow(x: number, y: number, r: number) {
    const ctx = this.ctx;
    const k = this.flip ? -1 : 1;
    ctx.beginPath();
    ctx.ellipse(x + 0.05 * k, y + 0.07 * k, r * 1.02, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
  }

  private drawBall(x: number, y: number, spin: number) {
    const ctx = this.ctx, r = this.p.ball.radius;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    const grd = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(1, '#cfd6dc');
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.clip();
    ctx.rotate(spin);
    ctx.fillStyle = '#1d232b';
    const pent = (cx: number, cy: number, rr: number) => {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    };
    pent(0, 0, r * 0.38);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5 + Math.PI / 5;
      pent(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, r * 0.3);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 0.015;
    ctx.stroke();
  }

  private drawPiece(p: ScenePiece, sc: Scene) {
    const ctx = this.ctx, r = this.p.disc.radius;
    const t = sc.now / 1000;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (this.flip) ctx.rotate(Math.PI);

    // ready / selectable glow under the disc
    if (p.ready) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.beginPath();
      ctx.arc(0, 0, r + 0.08 + pulse * 0.05, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,214,64,${0.35 + pulse * 0.35})`;
      ctx.fill();
    }
    if (sc.selectable.has(p.id)) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      ctx.beginPath();
      ctx.arc(0, 0, r + 0.05, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.35 + pulse * 0.45})`;
      ctx.lineWidth = sc.hoverId === p.id ? 0.07 : 0.035;
      ctx.stroke();
    }

    // disc body: white rim, team ring, avatar
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    const rim = ctx.createLinearGradient(0, -r, 0, r);
    rim.addColorStop(0, '#ffffff');
    rim.addColorStop(1, '#b9c3cc');
    ctx.fillStyle = rim;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_COLORS[p.side];
    ctx.fill();
    ctx.lineWidth = 0.02;
    ctx.strokeStyle = TEAM_DARK[p.side];
    ctx.stroke();

    const img = this.avatar(p.playerId);
    const ir = r * 0.74;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, ir, 0, Math.PI * 2);
    ctx.clip();
    if (img.complete && img.naturalWidth) ctx.drawImage(img, -ir, -ir, ir * 2, ir * 2);
    else {
      ctx.fillStyle = '#dde6ee';
      ctx.fill();
    }
    ctx.restore();

    if (p.frozen > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(150,220,255,0.55)';
      ctx.fill();
      ctx.strokeStyle = '#e8fbff';
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        ctx.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
        ctx.lineTo(-Math.cos(a) * r * 0.6, -Math.sin(a) * r * 0.6);
      }
      ctx.stroke();
    }
    if (p.anchored) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 0.03, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 0.06;
      ctx.setLineDash([0.08, 0.05]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.ready) this.star(r * 0.72, -r * 0.72, 0.13, 0.055, '#ffd640');
    ctx.restore();
  }

  private drawPowerRing(a: Aim, ctx: CanvasRenderingContext2D) {
    const pr = this.p.disc.radius + 0.15 + a.power * 1.25;
    ctx.beginPath();
    ctx.arc(a.from.x, a.from.y, pr, 0, Math.PI * 2);
    ctx.fillStyle = a.valid ? `rgba(230,70,40,${0.12 + a.power * 0.16})` : 'rgba(80,80,80,0.12)';
    ctx.fill();
    ctx.strokeStyle = a.valid ? 'rgba(230,70,40,0.65)' : 'rgba(80,80,80,0.4)';
    ctx.lineWidth = 0.03;
    ctx.stroke();
  }

  private drawAimOver(a: Aim, ctx: CanvasRenderingContext2D) {
    // pull-back line: solid up to the full-power point, faint beyond it
    const dx = a.pointer.x - a.from.x, dy = a.pointer.y - a.from.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1e-6) {
      const ux = dx / dist, uy = dy / dist;
      const solid = Math.min(dist, a.maxPull);
      const ex = a.from.x + ux * solid, ey = a.from.y + uy * solid;
      const r0 = this.p.disc.radius;
      ctx.lineCap = 'round';
      if (dist > a.maxPull) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 0.025;
        ctx.setLineDash([0.07, 0.06]);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(a.pointer.x, a.pointer.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (solid > r0) {
        const sx = a.from.x + ux * r0, sy = a.from.y + uy * r0;
        ctx.strokeStyle = 'rgba(25,12,5,0.55)';
        ctx.lineWidth = 0.11;
        ctx.beginPath();
        ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
        ctx.stroke();
        const grd = ctx.createLinearGradient(sx, sy, ex, ey);
        grd.addColorStop(0, '#ffe066');
        grd.addColorStop(1, a.power >= 1 ? '#ff3b2f' : `hsl(${50 - a.power * 45}, 100%, 55%)`);
        ctx.strokeStyle = grd;
        ctx.lineWidth = 0.065;
        ctx.beginPath();
        ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(ex, ey, 0.09, 0, Math.PI * 2);
      ctx.fillStyle = a.power >= 1 ? '#ff3b2f' : '#fff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(25,12,5,0.6)';
      ctx.lineWidth = 0.025;
      ctx.stroke();
      if (a.valid) {
        ctx.save();
        ctx.translate(ex + uy * 0.32, ey - ux * 0.32);
        if (this.flip) ctx.rotate(Math.PI);
        ctx.scale(0.01, 0.01);
        ctx.font = '900 26px system-ui, "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(25,12,5,0.75)';
        const label = `${Math.round(a.power * 100)}%`;
        ctx.strokeText(label, 0, 0);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
    if (!a.valid) return;
    // predicted path dots
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    let acc = 0;
    for (let i = 1; i < a.path.length; i++) {
      const p0 = a.path[i - 1], p1 = a.path[i];
      acc += Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (acc >= 0.22) {
        acc = 0;
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, 0.045, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (a.ghost) {
      ctx.beginPath();
      ctx.arc(a.ghost.x, a.ghost.y, this.p.disc.radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 0.025;
      ctx.setLineDash([0.06, 0.05]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawEffects(effects: Effect[], now: number) {
    const ctx = this.ctx;
    for (const e of effects) {
      const k = Math.min(1, (now - e.t0) / e.dur);
      if (k < 0) continue;
      const alpha = 1 - k;
      if (e.kind === 'ring') {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size * (0.3 + k), 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(e.color, alpha);
        ctx.lineWidth = 0.05 * (1 - k) + 0.01;
        ctx.stroke();
      } else if (e.kind === 'spark') {
        ctx.strokeStyle = withAlpha(e.color, alpha);
        ctx.lineWidth = 0.035;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + e.size;
          const r0 = 0.1 + k * e.size * 0.6, r1 = r0 + 0.12 * (1 - k);
          ctx.moveTo(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0);
          ctx.lineTo(e.x + Math.cos(a) * r1, e.y + Math.sin(a) * r1);
        }
        ctx.stroke();
      } else if (e.kind === 'burst') {
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const d = k * e.size * (0.6 + ((i * 37) % 10) / 20);
          ctx.fillStyle = withAlpha(['#ffd640', '#ffffff', '#ff6b5a', '#5ad1ff'][i % 4], alpha);
          ctx.fillRect(e.x + Math.cos(a) * d - 0.04, e.y + Math.sin(a) * d - 0.04, 0.08, 0.08);
        }
      } else if (e.kind === 'text') {
        ctx.save();
        ctx.translate(e.x, e.y - k * 0.5 * (this.flip ? -1 : 1));
        if (this.flip) ctx.rotate(Math.PI);
        ctx.scale(0.02, 0.02);
        const px = e.size * 50;
        ctx.font = `900 ${px}px system-ui, "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = px * 0.18;
        ctx.strokeStyle = withAlpha('#2a1500', alpha);
        ctx.strokeText(e.text ?? '', 0, 0);
        ctx.fillStyle = withAlpha(e.color, alpha);
        ctx.fillText(e.text ?? '', 0, 0);
        ctx.restore();
      }
    }
  }
}

function withAlpha(hex: string, a: number) {
  if (hex.startsWith('rgba')) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}
