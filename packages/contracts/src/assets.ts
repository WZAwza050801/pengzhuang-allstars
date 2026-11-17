import { z } from 'zod';
import { VersionIdSchema, Sha256Schema } from './configuration';
const id = VersionIdSchema;
const anchor = z.strictObject({ x: z.number(), y: z.number(), space: z.enum(['pixel', 'normalized']) });
export const CatalogAssetSchema = z
  .strictObject({
    id,
    kind: z.enum(['image', 'procedural-audio', 'procedural-field']),
    path: z
      .string()
      .regex(/^\/(?:assets|art)\/[A-Za-z0-9_./-]+$|^\/favicon\.ico$/)
      .nullable()
      .refine((p) => p === null || !p.split('/').some((part) => part === '..' || part === '.'), 'Unsafe asset path'),
    bytes: z.number().int().nonnegative(),
    sha256: Sha256Schema,
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    anchors: z.record(z.string(), anchor),
    category: z.string().min(1),
    priority: z.enum(['critical', 'lobby', 'match', 'optional']),
    source: z.strictObject({ evidence: z.string().min(1), kind: z.enum(['original', 'rebuilt', 'mixed', 'unknown']) }),
    rights: z.enum(['unverified', 'verified']),
    releaseAllowed: z.boolean(),
    rightsEvidence: z.string().nullable(),
    geometryVersion: z.string().nullable(),
  })
  .superRefine((a, ctx) => {
    if (a.kind === 'image' && (!a.path || !a.width || !a.height))
      ctx.addIssue({ code: 'custom', message: 'Image needs path and dimensions' });
    if (a.kind !== 'image' && (a.path !== null || a.width !== null || a.height !== null))
      ctx.addIssue({ code: 'custom', message: 'Procedural assets have no image path or dimensions' });
    if (a.releaseAllowed && (a.rights !== 'verified' || !a.rightsEvidence))
      ctx.addIssue({ code: 'custom', message: 'Release requires verified evidence' });
    for (const v of Object.values(a.anchors))
      if (
        (v.space === 'normalized' && (v.x < 0 || v.x > 1 || v.y < 0 || v.y > 1)) ||
        (v.space === 'pixel' && (v.x < 0 || v.y < 0 || v.x > (a.width ?? 0) || v.y > (a.height ?? 0)))
      )
        ctx.addIssue({ code: 'custom', message: 'Anchor outside asset' });
  });
export const AssetCatalogSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    version: id,
    minProtocol: z.number().int().positive(),
    maxProtocol: z.number().int().positive(),
    assets: z.array(CatalogAssetSchema),
    aliases: z.array(
      z.strictObject({
        id,
        target: id,
        usage: z.enum(['portrait', 'field-art', 'field-scene', 'lobby-field', 'audio', 'field-generated']),
      }),
    ),
  })
  .superRefine((v, ctx) => {
    const ids = new Set(v.assets.map((a) => a.id));
    if (ids.size !== v.assets.length || new Set(v.aliases.map((a) => a.id)).size !== v.aliases.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate asset or alias ID' });
    const paths = v.assets.map((a) => a.path).filter((p) => p !== null);
    if (new Set(paths).size !== paths.length) ctx.addIssue({ code: 'custom', message: 'Duplicate runtime path' });
    if (v.aliases.some((a) => !ids.has(a.target) || ids.has(a.id)))
      ctx.addIssue({ code: 'custom', message: 'Unresolved/conflicting asset alias' });
    if (v.maxProtocol < v.minProtocol) ctx.addIssue({ code: 'custom', message: 'Invalid compatibility range' });
  });
export type AssetCatalog = z.infer<typeof AssetCatalogSchema>;
