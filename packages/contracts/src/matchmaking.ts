import { z } from 'zod';
import { ACCOUNT_PROTOCOL_VERSION } from '../../../shared/protocol';
import { RoomCodeSchema } from './match-tickets';
import { ModeRulesSchema } from './modes';

export const QueueModeSchema = z.enum(['friend', 'ranked', 'growth']);
const region = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
const version = z.string().min(1).max(1024);
export const MatchmakingPolicySchema = z.strictObject({
  version: z.string().regex(/^[a-z0-9-]{1,40}$/),
  regions: z
    .array(z.strictObject({ id: region, label: z.string().min(1).max(40) }))
    .min(1)
    .max(8)
    .refine((values) => new Set(values.map((value) => value.id)).size === values.length),
  maxQueued: z.number().int().min(2).max(1024),
  waitMs: z.number().int().min(1000).max(600000),
  joinMs: z.number().int().min(1000).max(300000),
  ratingDifference: z.number().int().min(0).max(5000),
});
export type MatchmakingPolicy = z.infer<typeof MatchmakingPolicySchema>;
export const QueueCommandSchema = z.strictObject({
  intentId: z.uuid(),
  mode: QueueModeSchema,
  lineupId: z.uuid(),
  expectedRevision: z.number().int().min(0).max(2147483647),
  protocol: z.literal(ACCOUNT_PROTOCOL_VERSION),
  configVersion: version,
  region,
});
export type QueueCommand = z.infer<typeof QueueCommandSchema>;
export const QueueRatingSchema = z.strictObject({
  scope: z.enum(['ranked', 'growth']),
  season: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
  points: z.number().int().min(0).max(2147483647),
});
export type QueueRating = z.infer<typeof QueueRatingSchema>;
export const QueueEntrySchema = z
  .strictObject({
    id: z.uuid(),
    intentId: z.uuid(),
    mode: QueueModeSchema,
    configVersion: version,
    policyVersion: z.string().min(1).max(40),
    rules: ModeRulesSchema,
    region,
    lineupId: z.uuid(),
    lineupRevision: z.number().int().min(0).max(2147483647),
    rating: QueueRatingSchema.nullable(),
    state: z.enum(['queued', 'matched', 'cancelled', 'expired', 'failed', 'completed']),
    reason: z.enum([
      'waiting-compatible-player',
      'other-server',
      'paired',
      'cancelled',
      'timeout',
      'account-unavailable',
      'room-unavailable',
      'match-completed',
    ]),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    assignment: z
      .strictObject({
        id: z.uuid(),
        roomCode: RoomCodeSchema,
        expiresAt: z.iso.datetime(),
        state: z.enum(['preparing', 'ready', 'failed', 'completed']),
      })
      .nullable(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.state === 'matched' && !value.assignment) ||
      (value.state === 'queued' && value.assignment) ||
      value.rules.mode !== value.mode ||
      value.rules.gameDataVersion !== value.configVersion ||
      (value.mode === 'friend' ? value.rating !== null : value.rating?.scope !== value.mode)
    )
      ctx.addIssue({ code: 'custom', message: 'Queue state bindings are inconsistent' });
  });
export type QueueEntry = z.infer<typeof QueueEntrySchema>;
export const QueueStatusSchema = z.strictObject({
  userId: z.uuid(),
  serverNow: z.iso.datetime(),
  entry: QueueEntrySchema.nullable(),
});
export type QueueStatus = z.infer<typeof QueueStatusSchema>;
export const QueueOptionsSchema = z.strictObject({
  protocol: z.literal(ACCOUNT_PROTOCOL_VERSION),
  configVersion: version,
  policy: MatchmakingPolicySchema,
  enabledModes: z.array(QueueModeSchema).max(3),
});
export type QueueOptions = z.infer<typeof QueueOptionsSchema>;
