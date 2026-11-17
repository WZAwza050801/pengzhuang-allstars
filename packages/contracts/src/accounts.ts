import { z } from 'zod';
import { MoneySchema } from './money';
import { OpaqueCursorQuerySchema, ChronologicalCursorSchema } from './pagination';

export const DeviceKindSchema = z.enum(['desktop', 'mobile', 'tablet', 'unknown']);
export const WechatLoginSchema = z.strictObject({
  code: z
    .string()
    .min(1)
    .max(256)
    .refine(
      (value) =>
        !/\s/u.test(value) && Array.from(value).every((char) => char.charCodeAt(0) > 32 && char.charCodeAt(0) !== 127),
    ),
});
export type DeviceKind = z.infer<typeof DeviceKindSchema>;
export const CurrentUserSchema = z.strictObject({
  userId: z.uuid(),
  sessionId: z.uuid(),
  profile: z
    .strictObject({
      nickname: z.string().min(1).max(64),
      avatarAssetId: z.string().min(1).max(64),
      level: z.number().int().min(1),
      exp: MoneySchema,
      version: z.number().int().min(0),
    })
    .nullable(),
});
export type CurrentUser = z.infer<typeof CurrentUserSchema>;
export const SessionListQuerySchema = OpaqueCursorQuerySchema;
export const SessionCursorSchema = ChronologicalCursorSchema;
export const SessionListSchema = z.strictObject({
  sessions: z
    .array(
      z.strictObject({
        id: z.uuid(),
        deviceKind: DeviceKindSchema,
        isCurrent: z.boolean(),
        createdAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
      }),
    )
    .max(50),
  nextCursor: z.string().max(256).nullable(),
});
export type SessionList = z.infer<typeof SessionListSchema>;
export const LogoutSchema = z.strictObject({ allSessions: z.boolean() });
export const LogoutResultSchema = z.strictObject({ loggedOut: z.literal(true) });
export const RevokeSessionResultSchema = z.strictObject({ revoked: z.literal(true) });
export const AuthOptionsSchema = z.strictObject({
  emailEnabled: z.boolean(),
  wechatMiniProgram: z.boolean(),
  sessionPresent: z.boolean(),
});
export const AccountAcceptedSchema = z.strictObject({ accepted: z.literal(true) });
export const SignedInSchema = z.strictObject({ userId: z.uuid() });
export const EmailVerifiedSchema = z.strictObject({ verified: z.literal(true) });
export const PasswordResetSchema = z.strictObject({ reset: z.literal(true) });
