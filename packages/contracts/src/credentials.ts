import { z } from 'zod';

export const EmailAddressSchema = z.email().max(254);
export const PasswordProofSchema = z.string().min(1).max(256);
export const NewPasswordSchema = PasswordProofSchema.min(12);
export const AccountTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
