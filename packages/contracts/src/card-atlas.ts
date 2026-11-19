import { z } from 'zod';
import { VersionIdSchema, Sha256Schema } from './configuration';

export const CARD_QUALITIES = ['green', 'blue', 'purple', 'orange', 'red', 'silver'] as const;
export const CARD_STATES = ['normal', 'selected', 'disabled'] as const;
export const PlayerCardIdentitySchema = z.strictObject({
  id: z.string().regex(/^p\d{2,4}$/),
  name: z.string().min(1).max(80),
  position: z.string().min(1).max(16),
  quality: z.enum(CARD_QUALITIES),
  rarity: z.number().int().min(1).max(9).nullable().default(null),
});
export type PlayerCardIdentity = z.infer<typeof PlayerCardIdentitySchema>;
const page = z.strictObject({
  id: VersionIdSchema,
  path: z.string().regex(/^\/assets\/cards\/[a-z0-9-]+\.png$/),
  width: z.number().int().positive().max(2048),
  height: z.number().int().positive().max(2048),
});
const region = {
  pageId: VersionIdSchema,
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
};
const base = z.strictObject({
  schemaVersion: z.literal(1),
  generatorVersion: z.literal('card-textures-1'),
  gutter: z.literal(2),
  source: z.literal('procedural-placeholder'),
  pages: z.array(page).min(1).max(256),
  portraits: z
    .array(
      PlayerCardIdentitySchema.omit({ id: true }).extend({
        playerId: PlayerCardIdentitySchema.shape.id,
        ...region,
        width: z.literal(128),
        height: z.literal(128),
      }),
    )
    .min(1)
    .max(20000),
  frames: z
    .array(
      z.strictObject({
        quality: z.enum(CARD_QUALITIES),
        state: z.enum(CARD_STATES),
        ...region,
        width: z.literal(160),
        height: z.literal(224),
      }),
    )
    .length(18),
});
function errorsForLayout(atlas: z.infer<typeof base>): string[] {
  const errors: string[] = [];
  const pages = new Map(atlas.pages.map((p) => [p.id, p]));
  if (pages.size !== atlas.pages.length || new Set(atlas.pages.map((p) => p.path)).size !== pages.size)
    errors.push('Duplicate atlas page');
  if (new Set(atlas.portraits.map((p) => p.playerId)).size !== atlas.portraits.length)
    errors.push('Duplicate player identity');
  if (new Set(atlas.frames.map((f) => `${f.quality}.${f.state}`)).size !== 18)
    errors.push('Missing or duplicate frame state');
  if (errors.length) return errors;
  const regions = [...atlas.portraits, ...atlas.frames];
  for (const area of regions) {
    const p = pages.get(area.pageId);
    if (
      !p ||
      area.x < atlas.gutter ||
      area.y < atlas.gutter ||
      area.x + area.width + atlas.gutter > p.width ||
      area.y + area.height + atlas.gutter > p.height
    )
      return ['Region exceeds page or gutter'];
  }
  for (const p of atlas.pages) {
    const areas = regions.filter((r) => r.pageId === p.id);
    if (!areas.length) errors.push('Unused atlas page');
    for (let i = 0; i < areas.length; i++)
      for (let j = i + 1; j < areas.length; j++) {
        const a = areas[i],
          b = areas[j],
          gap = atlas.gutter * 2;
        if (
          a.x < b.x + b.width + gap &&
          b.x < a.x + a.width + gap &&
          a.y < b.y + b.height + gap &&
          b.y < a.y + a.height + gap
        )
          return ['Overlapping atlas regions'];
      }
  }
  return errors;
}
export const CardAtlasLayoutSchema = base.superRefine((value, ctx) => {
  for (const message of errorsForLayout(value)) ctx.addIssue({ code: 'custom', message });
});
export const CardAtlasSchema = base
  .extend({
    version: VersionIdSchema,
    generatorSha256: Sha256Schema,
    generatorEngine: z.string().min(1).max(80),
    pages: z
      .array(page.extend({ bytes: z.number().int().positive(), sha256: Sha256Schema }))
      .min(1)
      .max(256),
  })
  .superRefine((value, ctx) => {
    for (const message of errorsForLayout(value)) ctx.addIssue({ code: 'custom', message });
  });
export type CardAtlasLayout = z.infer<typeof CardAtlasLayoutSchema>;
export type CardAtlas = z.infer<typeof CardAtlasSchema>;
