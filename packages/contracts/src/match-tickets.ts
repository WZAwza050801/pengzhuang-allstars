import { z } from 'zod';
import { ACCOUNT_PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../../shared/protocol';

export const RoomCodeSchema = z
  .string()
  .length(ROOM_CODE_LENGTH)
  .regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]+$`));
export const RoomTicketTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const AccountRoomJoinSchema = z.strictObject({
  protocol: z.literal(ACCOUNT_PROTOCOL_VERSION),
  ticket: RoomTicketTokenSchema,
});
export const MatchTicketResultSchema = z.strictObject({
  ticket: RoomTicketTokenSchema,
  roomCode: RoomCodeSchema,
  expiresAt: z.iso.datetime(),
  protocol: z.literal(ACCOUNT_PROTOCOL_VERSION),
  configVersion: z.string().min(1).max(1024),
  mode: z.enum(['friend', 'ranked', 'growth']),
});
export type MatchTicketResult = z.infer<typeof MatchTicketResultSchema>;
