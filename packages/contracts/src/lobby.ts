import { z } from 'zod';
import { VersionIdSchema } from './configuration';
import { ModeIdSchema, ModeRulesSchema } from './modes';
import { UserProfileSchema, WalletListSchema } from './player-data';

const announcement = z
  .strictObject({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    title: z.string().min(1).max(80),
    body: z.string().min(1).max(2000),
    publishedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .refine((item) => item.expiresAt === null || Date.parse(item.expiresAt) > Date.parse(item.publishedAt));
export const LobbyContentSchema = z.strictObject({
  version: VersionIdSchema,
  announcements: z
    .array(announcement)
    .max(20)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length),
});
export type LobbyContent = z.infer<typeof LobbyContentSchema>;
export const PublicManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  protocolVersions: z.array(z.number().int().positive()).min(1).max(10),
  gameDataVersion: z.string().min(1).max(1024),
  maintenance: z.boolean(),
  modes: z.array(ModeRulesSchema).length(4),
  availableModes: z.array(ModeIdSchema).max(4),
});
export type PublicManifest = z.infer<typeof PublicManifestSchema>;
export const LobbyAccountSchema = z.strictObject({
  userId: z.uuid(),
  profile: UserProfileSchema.nullable(),
  wallets: WalletListSchema.shape.wallets,
  cardCount: z.number().int().min(0).max(2147483647),
  defaultLineup: z
    .strictObject({
      id: z.uuid(),
      name: z.string().min(1).max(50),
      revision: z.number().int().min(0),
      readyCards: z.number().int().min(0).max(5),
    })
    .nullable(),
});
export type LobbyAccount = z.infer<typeof LobbyAccountSchema>;
