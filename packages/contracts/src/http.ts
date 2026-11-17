import { z } from 'zod';
import { PROTOCOL_VERSION } from '../../../shared/protocol';
import { parseNickname } from './game-validation';

export const API_VERSION = 'v1';
export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = Object.freeze([PROTOCOL_VERSION]);
export function supportsProtocol(version: unknown): version is number {
  return typeof version === 'number' && SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}
export const API_ERROR_CODES = [
  'INVALID_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INSUFFICIENT_FUNDS',
  'RATE_LIMITED',
  'UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export const ApiErrorSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({ code: z.enum(API_ERROR_CODES), message: z.string().max(300), retryable: z.boolean() }),
  requestId: z.string().min(1).max(128),
});
export type ApiResult<T> = { ok: true; data: T; requestId: string } | z.infer<typeof ApiErrorSchema>;
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const nickname = z
  .string()
  .max(64)
  .refine((v) => v === v.trim() && parseNickname(v).ok, 'Invalid nickname');
export const MoneySchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(19)
  .refine((v) => v.length < 19 || v <= '9223372036854775807', 'PostgreSQL bigint maximum exceeded')
  .describe('Nonnegative PostgreSQL bigint serialized as a decimal string');
export const RegisterSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(12).max(256),
  nickname,
});
export const LoginSchema = z.strictObject({ email: z.email().max(254), password: z.string().min(1).max(256) });
export const ProfileSchema = z.strictObject({
  nickname,
  avatarAssetId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  expectedRevision: revision,
});
export const LineupSchema = z.strictObject({
  ownedCardIds: z
    .array(z.uuid())
    .length(5)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate card'),
  expectedRevision: revision,
});
export const UpgradeSchema = z.strictObject({ expectedRevision: revision });
export const MatchTicketSchema = z.strictObject({
  mode: z.enum(['friend', 'ranked', 'growth']),
  lineupId: z.uuid(),
  expectedRevision: revision,
  protocol: z.literal(PROTOCOL_VERSION),
});
export const QueueSchema = z.strictObject({
  mode: z.enum(['ranked', 'growth']),
  lineupId: z.uuid(),
  expectedRevision: revision,
  protocol: z.literal(PROTOCOL_VERSION),
});
export const HTTP_CONTRACTS = [
  { method: 'post', path: '/api/v1/auth/register', operationId: 'register', body: RegisterSchema },
  { method: 'post', path: '/api/v1/auth/login', operationId: 'login', body: LoginSchema },
  { method: 'patch', path: '/api/v1/me/profile', operationId: 'updateProfile', body: ProfileSchema },
  { method: 'put', path: '/api/v1/me/lineups/{id}', operationId: 'saveLineup', body: LineupSchema },
  { method: 'post', path: '/api/v1/me/cards/{id}/upgrade', operationId: 'upgradeCard', body: UpgradeSchema },
  { method: 'post', path: '/api/v1/matches/tickets', operationId: 'matchTicket', body: MatchTicketSchema },
  { method: 'post', path: '/api/v1/matchmaking/entries', operationId: 'enterQueue', body: QueueSchema },
] as const;

/** Boundary validation only; authentication/ownership/idempotency belong to the service. */
export function decodeBody<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { ok: true; value: T } | { ok: false; code: 'INVALID_REQUEST' } {
  const parsed = schema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: 'INVALID_REQUEST' };
}
