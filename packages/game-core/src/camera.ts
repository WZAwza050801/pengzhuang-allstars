import type { FieldGeometry } from './field';
export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Camera {
  cx: number;
  cy: number;
  scale: number;
  side: 0 | 1;
}
export interface SceneBox {
  x0: number;
  y0: number;
  w: number;
  h: number;
}
export function worldToView(p: Point, c: Camera): Point {
  const k = c.side === 0 ? c.scale : -c.scale;
  return { x: c.cx + p.x * k, y: c.cy + p.y * k };
}
export function viewToWorld(p: Point, c: Camera): Point {
  const k = c.side === 0 ? c.scale : -c.scale;
  return { x: (p.x - c.cx) / k, y: (p.y - c.cy) / k };
}
export function clientToWorld(p: Point, canvas: Pick<Rect, 'x' | 'y'>, camera: Camera): Point {
  return viewToWorld({ x: p.x - canvas.x, y: p.y - canvas.y }, camera);
}
export function cameraMatrix(
  c: Camera,
  dpr: number,
  offset: Point = { x: 0, y: 0 },
): [number, number, number, number, number, number] {
  const k = (c.side === 0 ? 1 : -1) * c.scale * dpr;
  return [k, 0, 0, k, (c.cx + offset.x) * dpr, (c.cy + offset.y) * dpr];
}
/** CSS pixels in; DPR changes only backing size. inset content is canvas-local, never a DOM page offset. */
export function fieldViewport(
  g: FieldGeometry,
  options: {
    width: number;
    height: number;
    dpr: number;
    side: 0 | 1;
    content?: Rect;
    scene?: SceneBox | null;
    reserveBottom?: number;
  },
) {
  const { width, height, dpr, side } = options;
  const content = options.content ?? { x: 0, y: 0, width, height };
  if (
    ![width, height, dpr, content.width, content.height].every((v) => Number.isFinite(v) && v > 0) ||
    ![content.x, content.y].every(Number.isFinite) ||
    content.x < 0 ||
    content.y < 0 ||
    content.x + content.width > width + 1e-6 ||
    content.y + content.height > height + 1e-6
  )
    throw new Error('Invalid viewport');
  const reserve = options.reserveBottom ?? 0;
  if (!Number.isFinite(reserve) || reserve < 0) throw new Error('Invalid HUD reservation');
  const usable = Math.max(1, content.height - reserve);
  const b = options.scene;
  if (
    b &&
    (![b.x0, b.y0, b.w, b.h].every(Number.isFinite) ||
      b.w <= 0 ||
      b.h <= 0 ||
      g.length / 2 + g.goalDepth + 0.15 - b.y0 <= 0)
  )
    throw new Error('Invalid scene box');
  const scale = b
    ? Math.min(content.width / (g.width + 0.8), usable / (g.length / 2 + g.goalDepth + 0.15 - b.y0))
    : Math.min(content.width / (g.width + 0.9), usable / (g.length + 2 * g.goalDepth + 0.7));
  const camera: Camera = b
    ? { cx: content.x + content.width / 2 - (b.x0 + b.w / 2) * scale, cy: content.y - b.y0 * scale, scale, side }
    : { cx: content.x + content.width / 2, cy: content.y + usable / 2, scale, side };
  const corner = worldToView({ x: -g.width / 2, y: -g.length / 2 }, { ...camera, side: 0 });
  return {
    camera,
    content,
    fieldRect: { ...corner, width: g.width * scale, height: g.length * scale },
    backing: { width: Math.round(width * dpr), height: Math.round(height * dpr) },
  };
}
