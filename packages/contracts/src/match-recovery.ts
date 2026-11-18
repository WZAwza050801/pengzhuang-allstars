import { z } from 'zod';
import { ACCOUNT_PROTOCOL_VERSION } from '../../../shared/protocol';
import { RoomCodeSchema } from './match-tickets';

export const ReentryCommandSchema = z.strictObject({ protocol: z.literal(ACCOUNT_PROTOCOL_VERSION) });
export const RecoverableMatchSchema = z.strictObject({
  matchId: z.uuid(),
  roomCode: RoomCodeSchema,
  side: z.union([z.literal(0), z.literal(1)]),
  protocol: z.literal(ACCOUNT_PROTOCOL_VERSION),
  mode: z.enum(['friend', 'ranked', 'growth']),
  configVersion: z.string().min(1).max(1024),
  reconnectMs: z.number().int().min(0).max(86400000).nullable(),
});
export const ActiveMatchSchema = z.discriminatedUnion('state', [
  z.strictObject({ userId: z.uuid(), state: z.literal('available'), match: RecoverableMatchSchema }),
  z.strictObject({ userId: z.uuid(), state: z.enum(['none', 'expired', 'ended', 'unavailable']), match: z.null() }),
]);
export type RecoverableMatch = z.infer<typeof RecoverableMatchSchema>;
export type ActiveMatch = z.infer<typeof ActiveMatchSchema>;
