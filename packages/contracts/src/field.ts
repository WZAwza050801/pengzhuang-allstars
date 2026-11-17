import { z } from 'zod';
import type { FieldGeometry } from '../../game-core/src/field';
const positive = () => z.number().positive();
const nonnegative = () => z.number().nonnegative();
export const FieldGeometrySchema: z.ZodType<FieldGeometry> = z
  .strictObject({
    width: positive(),
    length: positive(),
    goalWidth: positive(),
    goalDepth: positive(),
    postRadius: positive(),
    cornerCut: positive(),
    boxWidth: positive(),
    boxDepth: positive(),
    smallBoxWidth: nonnegative(),
    smallBoxDepth: nonnegative(),
    arcRadius: positive(),
    penaltySpot: positive(),
    centerRadius: positive(),
    source: z.string().min(1),
  })
  .superRefine((g, context) => {
    const reject = (field: string, message: string) => context.addIssue({ code: 'custom', path: [field], message });
    if (g.length <= g.width || g.length / g.width > 3) reject('length', 'Portrait field ratio must be within (1, 3]');
    if (g.goalWidth + 2 * g.postRadius >= g.width - 2 * g.cornerCut)
      reject('goalWidth', 'Goal must fit between cut corners');
    if (g.cornerCut >= g.width / 2 || g.cornerCut >= g.length / 2) reject('cornerCut', 'Corners overlap');
    if (g.boxWidth < g.goalWidth || g.boxWidth >= g.width || g.boxDepth >= g.length / 2)
      reject('boxWidth', 'Penalty box must contain goal and fit in one half');
    if (
      g.smallBoxWidth > g.boxWidth ||
      g.smallBoxDepth > g.boxDepth ||
      (g.smallBoxWidth === 0) !== (g.smallBoxDepth === 0)
    )
      reject('smallBoxWidth', 'Small box must fit or be fully disabled');
    if (g.centerRadius >= Math.min(g.width, g.length) / 2) reject('centerRadius', 'Centre circle must fit');
    if (g.penaltySpot >= g.boxDepth) reject('penaltySpot', 'Penalty spot must be inside box');
    if (g.arcRadius >= g.width / 2) reject('arcRadius', 'Arc must fit in field');
  });
const crop = z.tuple([nonnegative(), nonnegative(), positive(), positive()]);
const size = z.tuple([positive(), positive()]);
export const FieldSkinSchema = z
  .strictObject({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    name: z.string().min(1),
    desc: z.string(),
    source: z.string().min(1),
    grassA: z.string(),
    grassB: z.string(),
    pattern: z.enum(['checker', 'rings', 'stripes']),
    line: z.string(),
    wallTop: z.string(),
    wallSide: z.string(),
    wallTrim: z.string(),
    outside: z.string(),
    net: z.string(),
    goalFrame: z.string(),
    centerStar: z.boolean().optional(),
    style: z.literal('drawn').optional(),
    art: z.string().optional(),
    artSource: z.string().optional(),
    artCrop: crop.optional(),
    artRotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
    artFit: z.enum(['cover', 'contain']).optional(),
    scene: z.string().optional(),
    sceneSize: size.optional(),
  })
  .superRefine((skin, ctx) => {
    if ((skin.scene || skin.style === 'drawn') && (!skin.artCrop || !skin.sceneSize))
      ctx.addIssue({ code: 'custom', message: 'Scene needs source size and crop' });
    if (skin.art && (!skin.artSource || !skin.artCrop))
      ctx.addIssue({ code: 'custom', message: 'Art needs source and crop' });
    if (skin.artCrop) {
      const [l, t, r, b] = skin.artCrop;
      if (r <= l || b <= t || (skin.sceneSize && (r > skin.sceneSize[0] || b > skin.sceneSize[1])))
        ctx.addIssue({ code: 'custom', message: 'Crop outside scene' });
    }
  });
export const FieldDefinitionsSchema = z
  .strictObject({
    version: z.string().regex(/^field-[A-Za-z0-9_.-]{1,100}$/),
    note: z.string().min(1),
    geometry: FieldGeometrySchema,
    skins: z.array(FieldSkinSchema).min(1),
  })
  .superRefine((data, ctx) => {
    if (new Set(data.skins.map((s) => s.id)).size !== data.skins.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate field skin id' });
  });
