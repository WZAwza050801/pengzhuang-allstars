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
