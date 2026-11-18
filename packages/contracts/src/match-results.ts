import { z } from 'zod';
import { ACCOUNT_PROTOCOL_VERSION } from '../../../shared/protocol';
import { MoneySchema } from './money';
import { OpaqueCursorQuerySchema } from './pagination';

export const SettlementStatusSchema = z.enum(['pending', 'recorded', 'settled', 'failed']);
export type SettlementStatus = z.infer<typeof SettlementStatusSchema>;
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const uuid = z.uuid().transform((value) => value.toLowerCase());
const participant = z.strictObject({ userId: uuid, side: z.union([z.literal(0), z.literal(1)]), actions: integer });
/** Server-only intent. Player HTTP routes never accept this shape. It contains no connection credentials. */
export const OutcomeIntentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    protocol: z.literal(ACCOUNT_PROTOCOL_VERSION),
    matchId: uuid,
    mode: z.enum(['friend', 'growth', 'ranked']),
    configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
    configVersion: z.string().min(1).max(1024),
    finalSeq: integer,
    score: z.tuple([integer, integer]),
    winner: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    reason: z.enum(['goals', 'time', 'surrender', 'disconnect', 'abandoned', 'server-fault', 'shot-limit']),
    elapsedSeconds: integer,
    endedAt: z.iso.datetime(),
    participants: z.tuple([participant, participant]),
  })
  .superRefine((outcome, ctx) => {
    const [a, b] = outcome.participants;
    if (a.side !== 0 || b.side !== 1 || a.userId === b.userId || a.actions + b.actions !== outcome.finalSeq)
      ctx.addIssue({ code: 'custom', message: 'Participants and accepted actions must match both sides' });
    if (['abandoned', 'server-fault', 'shot-limit'].includes(outcome.reason) && outcome.winner !== -1)
      ctx.addIssue({ code: 'custom', message: 'Void outcomes cannot declare a winner' });
  });
export type OutcomeIntent = z.infer<typeof OutcomeIntentSchema>;

export const MatchHistoryQuerySchema = OpaqueCursorQuerySchema;
export const MatchRewardSchema = z.strictObject({
  eligible: z.boolean(),
  coins: MoneySchema,
  fragments: MoneySchema,
  playerDefId: z
    .string()
    .regex(/^p[0-9]{2,4}$/)
    .nullable(),
  operationId: z.uuid().nullable(),
  ledgerIds: z.array(z.uuid()).max(8),
  dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export const MatchResultSchema = z
  .strictObject({
    userId: z.uuid(),
    matchId: z.uuid(),
    side: z.union([z.literal(0), z.literal(1)]),
    mode: z.enum(['friend', 'growth', 'ranked']),
    configVersion: z.string().min(1).max(1024),
    economyVersion: z.string().min(1).max(128),
    modesVersion: z.string().min(1).max(128),
    finalSeq: integer,
    score: z.tuple([integer, integer]),
    winner: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    reason: z.string().min(1).max(100),
    endedAt: z.iso.datetime(),
    status: SettlementStatusSchema,
    recorded: z.boolean(),
    pendingReason: z
      .enum([
        'rating-unavailable',
        'account-restricted',
        'processing-failed',
        'outcome-conflict',
        'storage-unavailable',
        'retry-exhausted',
      ])
      .nullable(),
    reward: MatchRewardSchema.nullable(),
  })
  .superRefine((result, ctx) => {
    if (
      (result.status === 'settled' && (!result.recorded || !result.reward || result.pendingReason !== null)) ||
      (result.status === 'recorded' && !result.recorded) ||
      (result.status === 'pending' && result.recorded) ||
      (result.status !== 'settled' && result.reward !== null)
    )
      ctx.addIssue({ code: 'custom', message: 'Only a committed settlement can expose a reward receipt' });
  });
export const MatchHistorySchema = z.strictObject({
  userId: z.uuid(),
  matches: z.array(MatchResultSchema).max(50),
  nextCursor: z.string().max(256).nullable(),
});
export type MatchResult = z.infer<typeof MatchResultSchema>;
