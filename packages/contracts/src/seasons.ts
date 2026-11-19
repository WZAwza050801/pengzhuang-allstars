import { z } from 'zod';
import { MoneySchema } from './money';
import { RatingScopeSchema, LeaderboardEntrySchema } from './ratings';

const seasonId = z.string().regex(/^[A-Za-z0-9._-]{1,80}$/);
export const SeasonWindowSchema = z.strictObject({
  id: seasonId,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});
export const SeasonsConfigSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    version: z.string().regex(/^seasons-[0-9]{1,4}$/),
    status: z.enum(['engineering-default', 'confirmed']),
    softResetFactor: z.number().min(0).max(1),
    tierRewards: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), MoneySchema),
    seasons: z.array(SeasonWindowSchema).min(1).max(64),
  })
  .superRefine((config, ctx) => {
    const windows = config.seasons.map((s) => ({ ...s, start: Date.parse(s.startsAt), end: Date.parse(s.endsAt) }));
    if (windows.some((w) => Number.isNaN(w.start) || Number.isNaN(w.end) || w.end <= w.start))
      ctx.addIssue({ code: 'custom', message: 'Season windows must be valid and ascending' });
    const sorted = [...windows].sort((a, b) => a.start - b.start);
    if (sorted.some((w, i) => i > 0 && w.start < sorted[i - 1].end))
      ctx.addIssue({ code: 'custom', message: 'Season windows must not overlap' });
    if (new Set(config.seasons.map((s) => s.id)).size !== config.seasons.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate season id' });
  });
export type SeasonsConfig = z.infer<typeof SeasonsConfigSchema>;
export const SeasonStatusSchema = z.enum(['scheduled', 'active', 'closed']);
export const SeasonSchema = z.strictObject({
  id: seasonId,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  status: SeasonStatusSchema,
  closedAt: z.iso.datetime().nullable(),
});
export const SeasonListSchema = z.strictObject({ seasons: z.array(SeasonSchema).max(64) });
export const SeasonHistoryQuerySchema = z.strictObject({
  season: seasonId,
  scope: RatingScopeSchema,
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(256).optional(),
});
export type SeasonHistoryQuery = z.infer<typeof SeasonHistoryQuerySchema>;
export const SeasonHistorySchema = z.strictObject({
  season: seasonId,
  scope: RatingScopeSchema,
  entries: z.array(LeaderboardEntrySchema).max(100),
  nextCursor: z.string().max(256).nullable(),
});
export type SeasonHistory = z.infer<typeof SeasonHistorySchema>;
