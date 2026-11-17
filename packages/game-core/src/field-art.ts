import type { FieldGeometry } from './field';
import type { Point } from './camera';
export interface FieldArtDefinition {
  artCrop?: readonly number[];
  artRotate?: number;
  sceneSize?: readonly number[];
}
/** Crop then clockwise rotation, matching the image exporter. X/Y scales fit the canonical pitch independently. */
export function fieldArtMapping(g: FieldGeometry, art: FieldArtDefinition) {
  const crop = art.artCrop,
    size = art.sceneSize,
    rotation = art.artRotate ?? 0;
  if (!crop || crop.length !== 4 || !size || size.length !== 2 || ![0, 90, 180, 270].includes(rotation))
    throw new Error('Invalid field art definition');
  const [left, top, right, bottom] = crop,
    [sw, sh] = size;
  if (
    ![...crop, ...size].every(Number.isFinite) ||
    left < 0 ||
    top < 0 ||
    right <= left ||
    bottom <= top ||
    right > sw ||
    bottom > sh
  )
    throw new Error('Invalid field art crop');
  const cw = right - left,
    ch = bottom - top;
  const sourceToWorld = (p: Point): Point => {
    const u = (p.x - left) / cw,
      v = (p.y - top) / ch;
    const [x, y] =
      rotation === 90 ? [1 - v, u] : rotation === 180 ? [1 - u, 1 - v] : rotation === 270 ? [v, 1 - u] : [u, v];
    return { x: (x - 0.5) * g.width, y: (y - 0.5) * g.length };
  };
  const worldToSource = (p: Point): Point => {
    const x = p.x / g.width + 0.5,
      y = p.y / g.length + 0.5;
    const [u, v] =
      rotation === 90 ? [y, 1 - x] : rotation === 180 ? [1 - x, 1 - y] : rotation === 270 ? [1 - y, x] : [x, y];
    return { x: left + u * cw, y: top + v * ch };
  };
  const origin = sourceToWorld({ x: 0, y: 0 }),
    x1 = sourceToWorld({ x: 1, y: 0 }),
    y1 = sourceToWorld({ x: 0, y: 1 });
  const matrix: [number, number, number, number, number, number] = [
    x1.x - origin.x,
    x1.y - origin.y,
    y1.x - origin.x,
    y1.y - origin.y,
    origin.x,
    origin.y,
  ];
  const corners = [
    { x: 0, y: 0 },
    { x: sw, y: 0 },
    { x: sw, y: sh },
    { x: 0, y: sh },
  ].map(sourceToWorld);
  const x0 = Math.min(...corners.map((p) => p.x)),
    y0 = Math.min(...corners.map((p) => p.y));
  return {
    sourceToWorld,
    worldToSource,
    matrix,
    sceneBox: {
      x0,
      y0,
      w: Math.max(...corners.map((p) => p.x)) - x0,
      h: Math.max(...corners.map((p) => p.y)) - y0,
      k: g.width / cw,
      ky: g.length / ch,
    },
  };
}
