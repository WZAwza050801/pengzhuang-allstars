import { z } from 'zod';
import { MoneySchema } from './http';
const positiveMoney = MoneySchema.pipe(z.string().refine((value) => BigInt(value) > 0n, 'Positive amount required'));
const max = 9223372036854775807n;
export const EconomyPolicySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    version: z.string().regex(/^economy-[A-Za-z0-9_.-]{1,100}$/),
    status: z.literal('engineering-default'),
    sourceType: z.literal('rebuilt'),
    sourceNote: z.string().min(1),
    paymentsEnabled: z.literal(false),
    inventoryModel: z.literal('unique-definition'),
    maxLevel: z.literal(10),
    starter: z.strictObject({
      grantId: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
      coins: MoneySchema,
      fragments: MoneySchema,
      playerDefIds: z
        .array(z.string().regex(/^p[0-9]{2,4}$/))
        .min(5)
        .refine((ids) => new Set(ids).size === ids.length, 'Duplicate starter definition'),
    }),
    upgrade: z.strictObject({
      baseCoins: positiveMoney,
      growthNumerator: z.number().int().min(1).max(1000),
      growthDenominator: z.number().int().min(1).max(1000),
      rounding: z.literal('half-up'),
      consumesDuplicateCards: z.literal(false),
    }),
    matchRewards: z.strictObject({
      win: MoneySchema,
      draw: MoneySchema,
      loss: MoneySchema,
      dailyCoinsCap: positiveMoney,
    }),
    qualification: z.strictObject({
      minActionsByUser: z.number().int().min(1),
      minDurationSeconds: z.number().int().min(1),
      allowForfeitRewards: z.literal(false),
    }),
    dailyResetOffsetMinutes: z.number().int().min(-720).max(840),
    participationCard: z.strictObject({
      qualifiedMatches: z.number().int().min(1),
      dailyCap: z.literal(1),
      selection: z.literal('qualified-day-rotation'),
      progressScope: z.enum(['daily', 'carry-until-claim']).optional(),
    }),
    duplicateFragments: z.strictObject({
      '1': positiveMoney,
      '2': positiveMoney,
      '3': positiveMoney,
      '4': positiveMoney,
      '5': positiveMoney,
      '9': positiveMoney,
    }),
    rebuiltRarityByQuality: z.strictObject({
      white: z.literal(1),
      green: z.literal(2),
      blue: z.literal(3),
      purple: z.literal(4),
      orange: z.literal(5),
    }),
    craft: z.strictObject({
      costMultiplier: z.number().int().min(2).max(1000),
      pool: z.literal('implemented-or-no-skill'),
    }),
    ledgerKinds: z.tuple([
      z.literal('account.starter'),
      z.literal('match.reward'),
      z.literal('participation.card'),
      z.literal('card.duplicate'),
      z.literal('card.upgrade'),
      z.literal('card.craft'),
      z.literal('admin.correction'),
      z.literal('mission.reward'),
      z.literal('mail.reward'),
      z.literal('achievement.reward'),
    ]),
  })
  .superRefine((p, ctx) => {
    if (p.version !== 'economy-1' && p.participationCard.progressScope === undefined)
      ctx.addIssue({ code: 'custom', message: 'Explicit participation progress scope required after economy-1' });
    // Zod may run object refinements after recoverable child-range issues. Never calculate with invalid operands.
    if (
      !Number.isInteger(p.upgrade.growthNumerator) ||
      p.upgrade.growthNumerator < 1 ||
      p.upgrade.growthNumerator > 1000 ||
      !Number.isInteger(p.upgrade.growthDenominator) ||
      p.upgrade.growthDenominator < 1 ||
      p.upgrade.growthDenominator > 1000 ||
      !Number.isInteger(p.craft.costMultiplier) ||
      p.craft.costMultiplier < 2 ||
      p.craft.costMultiplier > 1000 ||
      !MoneySchema.safeParse(p.upgrade.baseCoins).success ||
      Object.values(p.duplicateFragments).some((value) => !MoneySchema.safeParse(value).success)
    )
      return;
    if (p.upgrade.growthNumerator < p.upgrade.growthDenominator)
      ctx.addIssue({ code: 'custom', message: 'Upgrade costs must not decrease' });
    for (let level = 1; level < p.maxLevel; level++) {
      const den = BigInt(p.upgrade.growthDenominator) ** BigInt(level - 1),
        cost = (BigInt(p.upgrade.baseCoins) * BigInt(p.upgrade.growthNumerator) ** BigInt(level - 1) + den / 2n) / den;
      if (cost > max) ctx.addIssue({ code: 'custom', message: 'Upgrade cost exceeds ledger amount' });
    }
    for (const amount of Object.values(p.duplicateFragments))
      if (BigInt(amount) * BigInt(p.craft.costMultiplier) > max)
        ctx.addIssue({ code: 'custom', message: 'Craft quote exceeds ledger amount' });
  });
export type EconomyPolicy = z.infer<typeof EconomyPolicySchema>;

export const EconomyBundleManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  economyVersion: z.string().min(1).max(128),
  gameDataVersion: z.string().min(1).max(1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  pricingSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
