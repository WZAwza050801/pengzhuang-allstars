import { z } from 'zod';
import { Sha256Schema, VersionIdSchema } from './configuration';
export const AssetVariantsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    version: VersionIdSchema,
    maxEdge: z.literal(768),
    generatorSha256: Sha256Schema,
    generatorEngine: z.string().min(1),
    variants: z
      .array(
        z.strictObject({
          sourcePath: z.string().regex(/^\/assets\/fields\/[A-Za-z0-9_/-]+\.(png|jpg|webp)$/),
          sourceSha256: Sha256Schema,
          sourceWidth: z.number().int().positive(),
          sourceHeight: z.number().int().positive(),
          path: z.string().regex(/^\/assets\/fields\/low\/field-[a-f0-9]{12}\.webp$/),
          sha256: Sha256Schema,
          bytes: z.number().int().positive(),
          width: z.number().int().positive().max(768),
          height: z.number().int().positive().max(768),
        }),
      )
      .max(32),
  })
  .superRefine((v, ctx) => {
    if (
      new Set(v.variants.map((x) => x.sourcePath)).size !== v.variants.length ||
      new Set(v.variants.map((x) => x.path)).size !== v.variants.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate resolution variant' });
    for (const s of v.variants) {
      const factor = v.maxEdge / Math.max(s.sourceWidth, s.sourceHeight);
      if (
        factor >= 1 ||
        s.width !== Math.max(1, Math.round(s.sourceWidth * factor)) ||
        s.height !== Math.max(1, Math.round(s.sourceHeight * factor))
      )
        ctx.addIssue({ code: 'custom', message: 'Variant must preserve the full image aspect ratio' });
    }
  });
export type AssetVariants = z.infer<typeof AssetVariantsSchema>;
