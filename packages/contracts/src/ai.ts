import { z } from 'zod';
export const AiEpochSchema = z.strictObject({
  shotNo: z.number().int().nonnegative(),
  turn: z.union([z.literal(0), z.literal(1)]),
  dataVersion: z.string().min(1).max(512),
});
export const AiReplySchema = z.strictObject({
  epoch: AiEpochSchema,
  input: z
    .strictObject({
      pieceId: z.string().min(1).max(32),
      dirX: z.number(),
      dirY: z.number(),
      power: z.number().min(0).max(1),
      curve: z.number().min(-1).max(1),
    })
    .nullable(),
  stats: z.strictObject({
    evaluated: z.number().int().nonnegative(),
    elapsedMs: z.number().nonnegative(),
    reason: z.enum(['complete', 'budget', 'evaluations', 'cancelled', 'no-move', 'ended']),
  }),
});
export const AiPolicySchema = z
  .strictObject({
    version: z.string().min(1),
    presentationDelayMs: z.number().int().min(0).max(2000),
    computeBudgetMs: z.number().int().min(1).max(5000),
    workerDeadlineMs: z.number().int().min(1).max(10000),
    maxEvaluations: z.number().int().min(1).max(1000),
    fallback: z.literal('nearest-legal-direct-shot'),
    note: z.string(),
  })
  .refine((v) => v.workerDeadlineMs > v.computeBudgetMs, 'Worker deadline must include startup/transport allowance');
