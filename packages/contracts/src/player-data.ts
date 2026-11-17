import { z } from 'zod';
import { CurrentUserSchema } from './accounts';
import { MoneySchema } from './money';
import { PageLimitSchema } from './pagination';

/** Reserved asset for the built-in monogram avatar; arbitrary URLs/uploads are not accepted. */
export const DEFAULT_AVATAR_ASSET_ID = 'avatar_default';
export const UserProfileSchema = CurrentUserSchema.shape.profile.unwrap();
export const OwnedCardSchema = z.strictObject({
  id: z.uuid(),
  playerDefId: z.string().regex(/^p[0-9]{2,4}$/),
  level: z.number().int().min(1).max(10),
  exp: MoneySchema,
  version: z.number().int().min(0),
  status: z.enum(['active', 'disabled']),
});
export const CardPageQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: PageLimitSchema.optional(),
});
export const CardPageSchema = z.strictObject({
  cards: z.array(OwnedCardSchema).max(50),
  nextCursor: z.uuid().nullable(),
});
export const WalletListSchema = z.strictObject({
  wallets: z
    .array(
      z.strictObject({
        currency: z.enum(['coins', 'fragments']),
        balance: MoneySchema,
        version: z.number().int().min(0),
      }),
    )
    .max(2),
});
