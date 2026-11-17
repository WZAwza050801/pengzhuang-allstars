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
