import { z } from 'zod';

const season = z.string().regex(/^[A-Za-z0-9._-]{1,80}$/);
const points = z.number().int().min(0).max(2147483647);
export const RatingScopeSchema = z.enum(['ranked', 'growth']);
export type RatingScope = z.infer<typeof RatingScopeSchema>;
export const RatingTierSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  label: z.string().min(1).max(20),
  min: points,
});
export const RatingsConfigSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    version: z.string().regex(/^ratings-[0-9]{1,4}$/),
    status: z.enum(['engineering-default', 'confirmed']),
    season,
    initialPoints: points,
    floorPoints: points,
    k: z.number().int().min(1).max(128),
    scale: z.number().int().min(100).max(1000),
    tiers: z.array(RatingTierSchema).min(1).max(12),
  })
  .superRefine((config, ctx) => {
    if (config.floorPoints > config.initialPoints)
      ctx.addIssue({ code: 'custom', message: 'Floor cannot exceed initial points' });
    const mins = config.tiers.map((tier) => tier.min);
    if (mins[0] !== 0 || mins.some((min, i) => i > 0 && min <= mins[i - 1]))
      ctx.addIssue({ code: 'custom', message: 'Tiers must start at 0 and ascend strictly' });
    if (new Set(config.tiers.map((tier) => tier.id)).size !== config.tiers.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate tier id' });
  });
export type RatingsConfig = z.infer<typeof RatingsConfigSchema>;
export const OwnRatingSchema = z.strictObject({
  scope: RatingScopeSchema,
  season,
  points,
  tier: z.strictObject({ id: RatingTierSchema.shape.id, label: RatingTierSchema.shape.label }),
  wins: z.number().int().min(0),
  draws: z.number().int().min(0),
  losses: z.number().int().min(0),
  version: z.number().int().min(0),
});
export const OwnRatingsSchema = z.strictObject({
  userId: z.uuid(),
  season,
  ratings: z.array(OwnRatingSchema).max(2),
});
export type OwnRatings = z.infer<typeof OwnRatingsSchema>;
export const LeaderboardQuerySchema = z.strictObject({
  scope: RatingScopeSchema,
  season: season.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(256).optional(),
});
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;
export const LeaderboardEntrySchema = z.strictObject({
  nickname: z.string().min(1).max(24),
  points,
  tier: z.strictObject({ id: RatingTierSchema.shape.id, label: RatingTierSchema.shape.label }),
  wins: z.number().int().min(0),
  draws: z.number().int().min(0),
  losses: z.number().int().min(0),
});
export const LeaderboardSchema = z.strictObject({
  scope: RatingScopeSchema,
  season,
  entries: z.array(LeaderboardEntrySchema).max(100),
  nextCursor: z.string().max(256).nullable(),
});
export type Leaderboard = z.infer<typeof LeaderboardSchema>;
