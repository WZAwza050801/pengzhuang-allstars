import { z } from 'zod';

export const VersionIdSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/);
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const ConfigPackageSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    version: VersionIdSchema,
    minProtocol: z.number().int().positive(),
    maxProtocol: z.number().int().positive(),
    sha256: Sha256Schema,
    payload: z.unknown(),
  })
  .refine((v) => v.maxProtocol >= v.minProtocol, 'Invalid compatibility range');
export const ResourceManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    version: VersionIdSchema,
    assets: z
      .array(
        z.strictObject({
          id: VersionIdSchema,
          path: z
            .string()
            .regex(/^\/(assets|art)\/[A-Za-z0-9_./-]+$/)
            .refine((v) => !v.split('/').includes('..'), 'Path traversal'),
          bytes: z.number().int().min(0).max(67108864),
          sha256: Sha256Schema,
          width: z.number().int().positive().optional(),
          height: z.number().int().positive().optional(),
        }),
      )
      .max(10000),
  })
  .refine((v) => new Set(v.assets.map((asset) => asset.id)).size === v.assets.length, 'Duplicate resource id');
