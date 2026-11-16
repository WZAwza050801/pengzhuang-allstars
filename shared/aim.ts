import type { FieldGeometry } from './data';
import { fieldSegments } from './physics';

export interface Pt { x: number; y: number }
export interface AimPreview { path: Pt[]; ghost: Pt | null }

interface Mirror { ax: number; ay: number; bx: number; by: number; rad: number }

function closest(px: number, py: number, m: Mirror): Pt {
  const dx = m.bx - m.ax, dy = m.by - m.ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - m.ax) * dx + (py - m.ay) * dy) / l2)) : 0;
  return { x: m.ax + t * dx, y: m.ay + t * dy };
}

/**
 * Aim line of fixed length, as in the original: the shot's free-flight path (curve included) is laid
 * into the field, and every wall it reaches mirrors the rest of the line, so a curving line bounces
 * as a mirrored curve and the shown length never shrinks. Players and the ball do not shorten it:
 * the length comes only from precision.
 * `free` starts at the shooter; if it is shorter than `length` it is extended along its last heading.
 */
export function foldAimPath(geom: FieldGeometry, free: Pt[], length: number, r: number, step = 0.02): AimPreview {
  const mirrors: Mirror[] = fieldSegments(geom).map((s) => ({ ax: s.a[0], ay: s.a[1], bx: s.b[0], by: s.b[1], rad: r }));
  const L = geom.length / 2, gw = geom.goalWidth / 2;
  for (const sy of [-1, 1]) for (const sx of [-1, 1]) {
    mirrors.push({ ax: sx * gw, ay: sy * L, bx: sx * gw, by: sy * L, rad: r + geom.postRadius });
  }
  const start = free[0];
  const out: AimPreview = { path: [{ ...start }], ghost: null };
  if (free.length < 2 || length <= 0) return out;

  // T(p) = M·p + t, composed of every reflection so far.
  let m00 = 1, m01 = 0, m10 = 0, m11 = 1, tx = 0, ty = 0;
  let prev = { ...start };
  let seg = 1, segPos = 0, travelled = 0;
  let q = { ...start };
  const last = free[free.length - 1], beforeLast = free[free.length - 2];
  let hx = last.x - beforeLast.x, hy = last.y - beforeLast.y;
  const hl = Math.hypot(hx, hy) || 1;
  hx /= hl;
  hy /= hl;

  while (travelled < length) {
    const ds = Math.min(step, length - travelled);
    travelled += ds;
    // advance q by ds along the free path (then straight along its last heading)
    let left = ds;
    while (left > 0) {
      if (seg < free.length) {
        const a = free[seg - 1], b = free[seg];
        const sl = Math.hypot(b.x - a.x, b.y - a.y);
        if (segPos + left < sl) {
          segPos += left;
          q = { x: a.x + ((b.x - a.x) * segPos) / sl, y: a.y + ((b.y - a.y) * segPos) / sl };
          left = 0;
        } else {
          left -= sl - segPos;
          q = { ...b };
          seg++;
          segPos = 0;
        }
      } else {
        q = { x: q.x + hx * left, y: q.y + hy * left };
        left = 0;
      }
    }
    let p = { x: m00 * q.x + m01 * q.y + tx, y: m10 * q.x + m11 * q.y + ty };
    for (let k = 0; k < 4; k++) {
      let hit: { nx: number; ny: number; cx: number; cy: number; rad: number } | null = null;
      for (const w of mirrors) {
        const c = closest(p.x, p.y, w);
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d >= w.rad) continue;
        const c0 = closest(prev.x, prev.y, w);
        const d0 = Math.hypot(prev.x - c0.x, prev.y - c0.y);
        if (d >= d0 || d0 < 1e-9) continue;
        hit = { nx: (prev.x - c0.x) / d0, ny: (prev.y - c0.y) / d0, cx: c0.x, cy: c0.y, rad: w.rad };
        break;
      }
      if (!hit) break;
      // reflect across the line { X : (X - C)·n = rad }
      const { nx, ny } = hit;
      const ox = hit.cx + nx * hit.rad, oy = hit.cy + ny * hit.rad;
      const r00 = 1 - 2 * nx * nx, r01 = -2 * nx * ny, r11 = 1 - 2 * ny * ny;
      const rtx = ox - (r00 * ox + r01 * oy), rty = oy - (r01 * ox + r11 * oy);
      [m00, m01, m10, m11, tx, ty] = [
        r00 * m00 + r01 * m10, r00 * m01 + r01 * m11,
        r01 * m00 + r11 * m10, r01 * m01 + r11 * m11,
        r00 * tx + r01 * ty + rtx, r01 * tx + r11 * ty + rty,
      ];
      p = { x: m00 * q.x + m01 * q.y + tx, y: m10 * q.x + m11 * q.y + ty };
    }
    out.path.push(p);
    prev = p;
  }
  return out;
}
