import { z } from 'zod';
import { parseNickname, parseSkin } from './game-validation';

export const ImportedSettingsSchema = z.strictObject({
  skinId: z
    .string()
    .max(64)
    .refine((value) => parseSkin(value).ok)
    .optional(),
  muted: z.boolean().optional(),
});
const slot = z.number().int().min(0).max(2);
const nicknameDraft = z
  .string()
  .max(64)
  .refine((value) => value === value.normalize('NFC').trim() && parseNickname(value).ok)
  .nullable();
const definitionSet = z
  .array(z.string().regex(/^p[0-9]{2,4}$/))
  .length(5)
  .refine((ids) => new Set(ids).size === ids.length);
export const LocalImportCommandSchema = z
  .strictObject({
    version: z.literal('pz-local-v1'),
    settings: ImportedSettingsSchema,
    nicknameDraft,
    lineups: z
      .array(z.strictObject({ slot, playerDefIds: definitionSet }))
      .max(3)
      .refine((sets) => new Set(sets.map((set) => set.slot)).size === sets.length),
    activeLineup: slot.nullable(),
  })
  .refine((value) => Object.keys(value.settings).length > 0 || value.nicknameDraft !== null || value.lineups.length > 0)
  .refine((value) => value.activeLineup === null || value.lineups.some((set) => set.slot === value.activeLineup));
export type LocalImportCommand = z.infer<typeof LocalImportCommandSchema>;
export const LocalImportReceiptSchema = z.strictObject({
  version: z.literal('pz-local-v1'),
  migratedAt: z.iso.datetime(),
  settings: ImportedSettingsSchema,
  nicknameDraft,
  lineups: z.array(z.strictObject({ slot, ownedCardIds: z.array(z.uuid()).length(5) })).max(3),
  activeLineup: slot.nullable(),
  skippedLineups: z.array(slot).max(3),
});
export const LocalImportStatusSchema = z.strictObject({ receipt: LocalImportReceiptSchema.nullable() });
export type LocalImportReceipt = z.infer<typeof LocalImportReceiptSchema>;
