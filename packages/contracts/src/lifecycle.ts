import { z } from 'zod';
import { WechatLoginSchema } from './accounts';
import {
  EmailAddressSchema as email,
  PasswordProofSchema as password,
  NewPasswordSchema,
  AccountTokenSchema,
} from './credentials';

export const ReauthenticateSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('password'), password }),
  z.strictObject({ method: z.literal('wechat'), code: WechatLoginSchema.shape.code }),
]);
export const LinkIdentitySchema = z.discriminatedUnion('provider', [
  z.strictObject({ provider: z.literal('email'), email, password: NewPasswordSchema }),
  z.strictObject({ provider: z.literal('wechat'), code: WechatLoginSchema.shape.code }),
]);
export const ConfirmIdentitySchema = z.strictObject({ token: AccountTokenSchema });
export const DeleteAccountSchema = z.strictObject({ confirm: z.literal('DELETE') });
export const DeletionRecoverySchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('password'), email, password }),
  z.strictObject({ method: z.literal('wechat'), code: WechatLoginSchema.shape.code }),
]);
export const ReauthenticatedSchema = z.strictObject({ authenticatedUntil: z.iso.datetime() });
export const IdentityLinkedSchema = z.strictObject({ linked: z.literal(true) });
export const IdentityStatusSchema = z.strictObject({ email: z.boolean(), wechat: z.boolean() });
export const DeletionPolicySchema = z.strictObject({
  enabled: z.boolean(),
  graceHours: z.number().int().min(0).max(2160),
  version: z.string().min(1).max(80),
});
export const DeletionRequestedSchema = z.strictObject({
  requested: z.literal(true),
  executeAt: z.iso.datetime(),
  policyVersion: z.string().min(1).max(80),
});
export const DeletionStatusSchema = z.strictObject({
  status: z.enum(['none', 'pending', 'cancelled', 'completed']),
  executeAt: z.iso.datetime().nullable(),
  policyVersion: z.string().min(1).max(80).nullable(),
});
export const DeletionCancelledSchema = z.strictObject({ cancelled: z.literal(true) });
