/** Virtual metres; +x right, +y down for side 0, origin at centre spot. */
export interface FieldGeometry {
  width: number;
  length: number;
  goalWidth: number;
  goalDepth: number;
  postRadius: number;
  cornerCut: number;
  boxWidth: number;
  boxDepth: number;
  smallBoxWidth: number;
  smallBoxDepth: number;
  arcRadius: number;
  penaltySpot: number;
  centerRadius: number;
  source: string;
}
export type SegmentKind = 'wall' | 'net' | 'spring';

export interface FieldSegment {
  a: [number, number];
  b: [number, number];
  kind: SegmentKind;
  /** Corner index for springs: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left. */
  corner?: number;
  /** Unit normal pointing into the field (springs only). */
  n?: [number, number];
}

/** Outline of the playable area as wall/net segments, shared by physics, rendering and tests. */
export function fieldSegments(g: FieldGeometry): FieldSegment[] {
  const W = g.width / 2,
    L = g.length / 2,
    gw = g.goalWidth / 2,
    gd = g.goalDepth,
    c = g.cornerCut;
  const segs: FieldSegment[] = [];
  const w = (a: [number, number], b: [number, number], kind: SegmentKind = 'wall') => segs.push({ a, b, kind });
  const spring = (a: [number, number], b: [number, number], corner: number, sx: number, sy: number) =>
    segs.push({ a, b, kind: 'spring', corner, n: [-sx * Math.SQRT1_2, -sy * Math.SQRT1_2] });
  for (const s of [-1, 1]) {
    const y = s * L;
    w([-W + c, y], [-gw, y]);
    w([gw, y], [W - c, y]);
    w([-gw, y], [-gw, y + s * gd], 'net');
    w([-gw, y + s * gd], [gw, y + s * gd], 'net');
    w([gw, y + s * gd], [gw, y], 'net');
    spring([W - c, y], [W, y - s * c], s < 0 ? 1 : 2, 1, s);
    spring([-W, y - s * c], [-W + c, y], s < 0 ? 0 : 3, -1, s);
  }
  w([W, -L + c], [W, L - c]);
  w([-W, -L + c], [-W, L - c]);
  return segs;
}

/** True if a circle of radius r centred at (x,y) lies inside the playable outline (incl. goal pockets). */
export function insideField(g: FieldGeometry, x: number, y: number, r: number, slop = 0.02): boolean {
  const W = g.width / 2,
    L = g.length / 2,
    gw = g.goalWidth / 2,
    c = g.cornerCut;
  const ax = Math.abs(x),
    ay = Math.abs(y);
  const inMain = ax <= W && ay <= L && ax + ay <= W + L - c;
  const inPocket = ax <= gw && ay <= L + g.goalDepth;
  if (!inMain && !inPocket) return false;
  const need = r - slop;
  for (const s of fieldSegments(g)) {
    if (segDist(x, y, s.a[0], s.a[1], s.b[0], s.b[1]) < need) return false;
  }
  const pd = Math.hypot(ax - gw, ay - L);
  return pd >= r + g.postRadius - slop;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Goal posts are shared by collision construction and development overlays. */
export function fieldPosts(g: FieldGeometry) {
  return [-1, 1].flatMap((sy) =>
    [-1, 1].map((sx) => ({ x: (sx * g.goalWidth) / 2, y: (sy * g.length) / 2, radius: g.postRadius })),
  );
}
export function fieldOutline(g: FieldGeometry): [number, number][] {
  const W = g.width / 2,
    L = g.length / 2,
    c = g.cornerCut;
  return [
    [-W + c, -L],
    [W - c, -L],
    [W, -L + c],
    [W, L - c],
    [W - c, L],
    [-W + c, L],
    [-W, L - c],
    [-W, -L + c],
  ];
}
/** Sweep the whole-circle threshold. Existing out-of-bounds positions never count as a newly scored goal. */
export function goalCrossing(
  g: FieldGeometry,
  radius: number,
  before: { x: number; y: number },
  after: { x: number; y: number },
): null | { scoredBy: 0 | 1; x: number } {
  if (![radius, before.x, before.y, after.x, after.y].every(Number.isFinite) || radius <= 0) return null;
  const line = g.length / 2 + radius;
  for (const sign of [-1, 1] as const) {
    if (sign * before.y > line || sign * after.y <= line) continue;
    const fraction = (sign * line - before.y) / (after.y - before.y);
    if (fraction < 0 || fraction > 1) continue;
    const x = before.x + (after.x - before.x) * fraction;
    if (Math.abs(x) + radius > g.goalWidth / 2) continue;
    return { scoredBy: sign === -1 ? 0 : 1, x };
  }
  return null;
}
