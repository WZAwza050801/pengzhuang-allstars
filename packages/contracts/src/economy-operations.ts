import { z } from 'zod';
import { MoneySchema, SignedMoneySchema } from './money';
import { OwnedCardSchema, WalletListSchema } from './player-data';
import { OpaqueCursorQuerySchema } from './pagination';
import { VersionIdSchema } from './configuration';
/** In-game economy DTOs, separate from the visual asset catalog. */

const revision = z.number().int().min(0).max(2147483647);
const playerId = z.string().regex(/^p[0-9]{2,4}$/);
const sourceId = z.string().regex(/^[A-Za-z0-9_:./-]{1,200}$/);
export const UpgradeQuoteSchema = z.strictObject({
  ownedCardId: z.uuid(),
  playerDefId: playerId,
  currentLevel: z.number().int().min(1).max(9),
  nextLevel: z.number().int().min(2).max(10),
  coins: MoneySchema,
  expectedRevision: revision,
  economyVersion: VersionIdSchema,
});
export const CraftQuoteQuerySchema = z.strictObject({ playerDefId: playerId });
export const CraftQuoteSchema = z.strictObject({
  playerDefId: playerId,
  fragments: MoneySchema,
  expectedRevision: revision,
  economyVersion: VersionIdSchema,
});
export const AssetOperationSchema = z.strictObject({
  operationId: z.string().min(1).max(200),
  kind: z.enum(['upgrade', 'craft', 'grant', 'debit']),
  economyVersion: VersionIdSchema,
  wallets: WalletListSchema.shape.wallets,
  cards: z.array(OwnedCardSchema).max(50),
  ledgerIds: z.array(z.uuid()).max(3),
});
export type AssetOperation = z.infer<typeof AssetOperationSchema>;
export const LedgerQuerySchema = OpaqueCursorQuerySchema;
export const LedgerPageSchema = z.strictObject({
  entries: z
    .array(
      z.strictObject({
        id: z.uuid(),
        currency: z.enum(['coins', 'fragments']),
        delta: SignedMoneySchema,
        balanceAfter: MoneySchema,
        reason: z.string().min(1).max(100),
        sourceId: z.string().min(1).max(200),
        createdAt: z.iso.datetime(),
      }),
    )
    .max(50),
  nextCursor: z.string().max(256).nullable(),
});
/** Trusted service ports only. These schemas are never mounted as player grant/debit routes. */
export const TrustedGrantSchema = z
  .strictObject({
    userId: z.uuid(),
    operationId: sourceId,
    sourceId,
    reason: z.enum([
      'match.reward',
      'participation.card',
      'mission.reward',
      'mail.reward',
      'achievement.reward',
      'admin.correction',
    ]),
    coins: MoneySchema.default('0'),
    fragments: MoneySchema.default('0'),
    playerDefIds: z.array(playerId).max(50).default([]),
  })
  .refine((input) => input.coins !== '0' || input.fragments !== '0' || input.playerDefIds.length > 0);
export const TrustedDebitSchema = z.strictObject({
  userId: z.uuid(),
  operationId: sourceId,
  sourceId,
  reason: z.literal('admin.correction'),
  currency: z.enum(['coins', 'fragments']),
  amount: MoneySchema.refine((value) => value !== '0'),
});
