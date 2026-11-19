import { z } from 'zod';
import { CardPageQuerySchema } from './player-data';

export const LineupPageQuerySchema = CardPageQuerySchema;
export const SavedLineupSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(40),
  revision: z.number().int().min(0).max(2147483647),
  ownedCardIds: z.array(z.uuid()).max(5),
});
export const LineupPageSchema = z.strictObject({
  lineups: z.array(SavedLineupSchema).max(50),
  nextCursor: z.uuid().nullable(),
});
