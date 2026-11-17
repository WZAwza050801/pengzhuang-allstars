import { z } from 'zod';
import { Sha256Schema, VersionIdSchema } from './configuration';
export const UI_THEMES = ['light', 'dark'] as const;
export const UI_SURFACES = ['primary', 'secondary', 'panel'] as const;
export const UI_STATES = ['normal', 'selected', 'disabled'] as const;
export const UI_ICONS = ['back', 'settings', 'ball', 'lineup', 'mail', 'trophy', 'check', 'close'] as const;
export const UI_STADIUMS = ['scene_01', 'scene_02', 'scene_03', 'scene_04', 'scene_05'] as const;
export const UI_AUDIO = ['hit', 'kick', 'wall', 'spring', 'post', 'shoot', 'goal', 'skill', 'turn'] as const;
const color = z.string().regex(/^#[0-9a-f]{6}$/);
const theme = z.strictObject({
  background: color,
  panel: color,
  ink: color,
  muted: color,
  border: color,
  accent: color,
  accentInk: color,
  success: color,
  danger: color,
  disabled: color,
  disabledInk: color,
  focus: color,
  scrim: color,
});
export const UiTokensSchema = z.strictObject({
  version: VersionIdSchema,
  touchTarget: z.number().int().min(44).max(96),
  spacing: z.tuple([z.literal(4), z.literal(8), z.literal(12), z.literal(16), z.literal(24)]),
  radius: z.number().min(0).max(16),
  typography: z.strictObject({
    body: z.number().min(16).max(24),
    title: z.number().min(24).max(48),
    number: z.number().min(20).max(48),
    lineHeight: z.number().min(1.4).max(2),
  }),
  motion: z.strictObject({
    fastMs: z.number().min(0).max(200),
    normalMs: z.number().min(0).max(400),
    reducedMs: z.literal(0),
  }),
  themes: z.strictObject({ light: theme, dark: theme }),
  quality: z.strictObject({ white: color, green: color, blue: color, purple: color, orange: color }),
  stadium: z.strictObject({
    grass: color,
    stripe: color,
    line: color,
    wall: color,
    stand: color,
    standSide: color,
    ball: color,
  }),
});
export type UiTokens = z.infer<typeof UiTokensSchema>;
const page = z.strictObject({
  id: VersionIdSchema,
  path: z.string().regex(/^\/assets\/ui\/[a-z0-9-]+\.png$/),
  width: z.number().int().positive().max(2048),
  height: z.number().int().positive().max(2048),
});
const sprite = z.strictObject({
  id: VersionIdSchema,
  kind: z.enum(['surface', 'icon', 'stadium']),
  pageId: VersionIdSchema,
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  inset: z.number().int().nonnegative().max(16),
});
const base = z.strictObject({
  schemaVersion: z.literal(1),
  gutter: z.literal(2),
  source: z.literal('original-procedural-placeholder'),
  pages: z.array(page).length(3),
  sprites: z.array(sprite).length(39),
});
function validateLayout(v: z.infer<typeof base>, ctx: z.RefinementCtx) {
  const ids = new Set(v.sprites.map((s) => s.id));
  const expected = [
    ...UI_THEMES.flatMap((t) => UI_SURFACES.flatMap((k) => UI_STATES.map((s) => `surface.${t}.${k}.${s}`))),
    ...UI_THEMES.flatMap((t) => UI_ICONS.map((i) => `icon.${t}.${i}`)),
    ...UI_STADIUMS.map((s) => `stadium.${s}`),
  ];
  if (
    ids.size !== 39 ||
    expected.some((id) => !ids.has(id)) ||
    new Set(v.pages.map((p) => p.id)).size !== 3 ||
    new Set(v.pages.map((p) => p.path)).size !== 3
  ) {
    ctx.addIssue({ code: 'custom', message: 'Incomplete or duplicate UI resource' });
    return;
  }
  for (const s of v.sprites) {
    const p = v.pages.find((p) => p.id === s.pageId);
    if (
      !p ||
      !s.id.startsWith(s.kind + '.') ||
      s.x < 2 ||
      s.y < 2 ||
      s.x + s.width + 2 > p.width ||
      s.y + s.height + 2 > p.height ||
      (s.kind === 'surface' ? s.inset !== 16 || s.width !== 64 || s.height !== 64 : s.inset !== 0)
    ) {
      ctx.addIssue({ code: 'custom', message: 'Invalid UI region or cap' });
      return;
    }
  }
  for (const p of v.pages) {
    const regions = v.sprites.filter((s) => s.pageId === p.id);
    if (!regions.length) ctx.addIssue({ code: 'custom', message: 'Unused UI page' });
    for (let i = 0; i < regions.length; i++)
      for (let j = i + 1; j < regions.length; j++) {
        const a = regions[i],
          b = regions[j];
        if (
          a.x < b.x + b.width + 4 &&
          b.x < a.x + a.width + 4 &&
          a.y < b.y + b.height + 4 &&
          b.y < a.y + a.height + 4
        ) {
          ctx.addIssue({ code: 'custom', message: 'Overlapping UI regions' });
          return;
        }
      }
  }
}
export const UiPackLayoutSchema = base.superRefine(validateLayout);
export const UiPackSchema = base
  .extend({
    version: VersionIdSchema,
    tokensVersion: VersionIdSchema,
    generatorSha256: Sha256Schema,
    generatorEngine: z.string().min(1),
    pages: z.array(page.extend({ bytes: z.number().int().positive(), sha256: Sha256Schema })).length(3),
    audio: z.strictObject({
      ids: z.array(z.enum(UI_AUDIO)).length(9),
      sourcePath: z.literal('client/src/sfx.ts'),
      sha256: Sha256Schema,
      strategy: z.literal('user-gesture-procedural'),
    }),
  })
  .superRefine((v, ctx) => {
    validateLayout(v, ctx);
    if (new Set(v.audio.ids).size !== 9) ctx.addIssue({ code: 'custom', message: 'Incomplete UI audio' });
  });
export type UiPackLayout = z.infer<typeof UiPackLayoutSchema>;
export type UiPack = z.infer<typeof UiPackSchema>;
