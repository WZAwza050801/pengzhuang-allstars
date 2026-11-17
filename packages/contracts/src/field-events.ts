import { z } from 'zod';
const id = z.string().min(1).max(64);
export const SpringKickEventSchema = z.strictObject({
  t: z.number().nonnegative(),
  type: z.literal('spring-kick'),
  a: id,
  b: z.enum(['spring0', 'spring1', 'spring2', 'spring3']),
  speed: z.number().nonnegative(),
  x: z.number(),
  y: z.number(),
});
export const RelocateEventSchema = z.strictObject({
  type: z.literal('relocate'),
  ids: z
    .array(id)
    .min(1)
    .max(64)
    .refine((ids) => new Set(ids).size === ids.length),
});
