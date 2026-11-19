import { z } from 'zod';

export const MoneySchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(19)
  .refine((v) => v.length < 19 || v <= '9223372036854775807', 'PostgreSQL bigint maximum exceeded')
  .describe('Nonnegative PostgreSQL bigint serialized as a decimal string');

export const SignedMoneySchema = z.union([
  MoneySchema,
  z
    .string()
    .regex(/^-[1-9][0-9]*$/)
    .max(20)
    .refine((value) => value.length < 20 || (value.length === 20 && value.slice(1) <= '9223372036854775808')),
]);
