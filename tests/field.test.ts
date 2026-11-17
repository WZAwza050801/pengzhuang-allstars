import { expect, test } from 'vitest';
import fields from '../data/fields.json';
import { FieldDefinitionsSchema, FieldGeometrySchema } from '@pengzhuang/contracts';
import { fieldSegments } from '@pengzhuang/game-core';
import { DEFAULT_DATA, FIELD_SKINS } from '../shared/data';

test('all skins share one validated measured geometry and the legacy boundary remains symmetric', () => {
  const data = FieldDefinitionsSchema.parse(fields);
  expect(data.geometry).toEqual(DEFAULT_DATA.geometry);
  expect([data.geometry.width, data.geometry.length, data.geometry.goalWidth, data.geometry.goalDepth]).toEqual([
    6, 9.78, 2.05, 0.4,
  ]);
  expect(FIELD_SKINS).toHaveLength(9);
  const segments = fieldSegments(data.geometry);
  expect(segments).toHaveLength(16);
  for (const segment of segments) {
    expect(segment.a).not.toEqual(segment.b);
    expect(
      segments.some(
        (s) =>
          s.kind === segment.kind &&
          ((s.a[0] === -segment.a[0] &&
            s.a[1] === -segment.a[1] &&
            s.b[0] === -segment.b[0] &&
            s.b[1] === -segment.b[1]) ||
            (s.b[0] === -segment.a[0] &&
              s.b[1] === -segment.a[1] &&
              s.a[0] === -segment.b[0] &&
              s.a[1] === -segment.b[1])),
      ),
    ).toBe(true);
  }
  for (const skin of fields.skins)
    expect(FieldDefinitionsSchema.safeParse({ ...fields, skins: [{ ...skin, geometry: { width: 9 } }] }).success).toBe(
      false,
    );
});
test('geometry and skin schema reject invalid dimensions, ratios, missing provenance, crop, duplicates and private collision overrides', () => {
  for (const bad of [
    { width: 0 },
    { length: 2 },
    { length: Infinity },
    { width: NaN },
    { goalWidth: 6 },
    { cornerCut: 5 },
    { boxDepth: 9 },
    { smallBoxWidth: 1 },
    { centerRadius: 4 },
    { source: '' },
    { length: 80 },
  ]) {
    expect(FieldGeometrySchema.safeParse({ ...fields.geometry, ...bad }).success, JSON.stringify(bad)).toBe(false);
  }
  for (const skins of [
    [fields.skins[0], fields.skins[0]],
    [{ ...fields.skins[4], artCrop: [1, 1, 2000, 2000] }],
    [{ ...fields.skins[0], postRadius: 9 }],
  ])
    expect(FieldDefinitionsSchema.safeParse({ ...fields, skins }).success).toBe(false);
});
