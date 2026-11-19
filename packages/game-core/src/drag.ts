import type { Point } from './camera';
/** Shared by input and preview. Distances are world metres, never backing pixels. */
export function dragIntent(from: Point, pointer: Point, radius: number, maxDrag: number) {
  const dx = from.x - pointer.x,
    dy = from.y - pointer.y;
  const distance = Math.hypot(dx, dy);
  const power = Math.min(1, Math.max(0, distance - radius * 0.6) / maxDrag);
  return { dx, dy, distance, power, dirX: distance ? dx / distance : 0, dirY: distance ? dy / distance : 0 };
}
/** Existing signed bow integral; positive means shooter's right in y-down world coordinates. */
export function gestureCurve(path: readonly Point[], pointer: Point): number {
  if (path.length < 3) return 0;
  const p0 = path[0];
  const cx = pointer.x - p0.x,
    cy = pointer.y - p0.y;
  const chord = Math.hypot(cx, cy);
  if (chord < 0.5) return 0;
  const rx = cy / chord,
    ry = -cx / chord;
  let len = 0,
    acc = 0;
  const pts = [...path, pointer];
  for (let i = 1; i < pts.length; i++) {
    const s = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const mx = (pts[i].x + pts[i - 1].x) / 2 - p0.x,
      my = (pts[i].y + pts[i - 1].y) / 2 - p0.y;
    acc += (mx * rx + my * ry) * s;
    len += s;
  }
  return len > 0 ? Math.max(-1, Math.min(1, (acc / len / chord) * 6)) : 0;
}
