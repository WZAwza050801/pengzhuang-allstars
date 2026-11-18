import { z } from 'zod';
import { ACCOUNT_PROTOCOL_VERSION, SUPPORTED_MATCH_PROTOCOLS } from '../../../shared/protocol';
import { VersionIdSchema } from './configuration';
import { RoomCodeSchema, MatchTicketResultSchema } from './match-tickets';
import { QueueCommandSchema, QueueStatusSchema, QueueOptionsSchema } from './matchmaking';
import { OwnRatingsSchema, LeaderboardQuerySchema, LeaderboardSchema } from './ratings';
import { ActiveMatchSchema, ReentryCommandSchema } from './match-recovery';
import { MatchResultSchema, MatchHistorySchema, MatchHistoryQuerySchema, MatchLedgerSchema } from './match-results';
import { parseNickname } from './game-validation';
import { UserProfileSchema, CardPageQuerySchema, CardPageSchema, WalletListSchema } from './player-data';
import { LineupPageQuerySchema, LineupPageSchema, SavedLineupSchema } from './lineups';
import { LocalImportCommandSchema, LocalImportReceiptSchema, LocalImportStatusSchema } from './local-import';
import { PublicManifestSchema, LobbyContentSchema, LobbyAccountSchema } from './lobby';
import {
  UpgradeQuoteSchema,
  CraftQuoteQuerySchema,
  CraftQuoteSchema,
  AssetOperationSchema,
  LedgerQuerySchema,
  LedgerPageSchema,
} from './economy-operations';
import { EmailAddressSchema, PasswordProofSchema, NewPasswordSchema, AccountTokenSchema } from './credentials';
import {
  CurrentUserSchema,
  LogoutSchema,
  LogoutResultSchema,
  SessionListQuerySchema,
  SessionListSchema,
  RevokeSessionResultSchema,
  WechatLoginSchema,
  AuthOptionsSchema,
} from './accounts';
export { MoneySchema } from './money';
import {
  ReauthenticateSchema,
  LinkIdentitySchema,
  ConfirmIdentitySchema,
  DeleteAccountSchema,
  DeletionRecoverySchema,
  IdentityStatusSchema,
} from './lifecycle';

export const API_VERSION = 'v1';
export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = Object.freeze([...SUPPORTED_MATCH_PROTOCOLS]);
export function supportsProtocol(version: unknown): version is number {
  return typeof version === 'number' && SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}
export const API_ERROR_CODES = [
  'INVALID_REQUEST',
  'PROTOCOL_UNSUPPORTED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'ACCOUNT_CHANGED',
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
const revision = z.number().int().min(0).max(2147483647);
const nickname = z
  .string()
  .max(64)
  .refine((v) => v === v.trim() && parseNickname(v).ok, 'Invalid nickname');
export const RegisterSchema = z.strictObject({
  email: EmailAddressSchema,
  password: NewPasswordSchema,
  nickname,
});
export const LoginSchema = z.strictObject({ email: EmailAddressSchema, password: PasswordProofSchema });
export const VerifyEmailSchema = z.strictObject({ token: AccountTokenSchema });
export const ResetRequestSchema = z.strictObject({ email: EmailAddressSchema });
export const ResetPasswordSchema = z.strictObject({ token: AccountTokenSchema, password: NewPasswordSchema });
export const RefreshSchema = z.strictObject({});
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
export const UpgradeSchema = z.strictObject({ expectedRevision: revision, expectedEconomyVersion: VersionIdSchema });
export const CraftSchema = z.strictObject({
  playerDefId: z.string().regex(/^p[0-9]{2,4}$/),
  expectedRevision: revision,
  expectedEconomyVersion: VersionIdSchema,
});
export const MatchTicketSchema = z.strictObject({
  mode: z.enum(['friend', 'ranked', 'growth']),
  lineupId: z.uuid(),
  expectedRevision: revision,
  protocol: z.literal(ACCOUNT_PROTOCOL_VERSION),
  roomCode: RoomCodeSchema.optional(),
});
export const QueueSchema = QueueCommandSchema;
export const HTTP_CONTRACTS = [
  {
    method: 'get',
    path: '/api/v1/me/matches',
    operationId: 'matchHistory',
    query: MatchHistoryQuerySchema,
    response: MatchHistorySchema,
  },
  { method: 'get', path: '/api/v1/matches/{id}/result', operationId: 'matchResult', response: MatchResultSchema },
  { method: 'get', path: '/api/v1/matches/{id}/ledger', operationId: 'matchLedger', response: MatchLedgerSchema },
  { method: 'get', path: '/api/v1/me/active-match', operationId: 'activeMatch', response: ActiveMatchSchema },
  {
    method: 'post',
    path: '/api/v1/matches/{id}/reentry',
    operationId: 'reenterMatch',
    body: ReentryCommandSchema,
    response: MatchTicketResultSchema,
  },
  { method: 'get', path: '/api/v1/config/manifest', operationId: 'publicManifest', response: PublicManifestSchema },
  { method: 'get', path: '/api/v1/announcements', operationId: 'announcements', response: LobbyContentSchema },
  { method: 'get', path: '/api/v1/me/lobby', operationId: 'lobbyAccount', response: LobbyAccountSchema },
  {
    method: 'get',
    path: '/api/v1/me/cards/{id}/upgrade-quote',
    operationId: 'upgradeQuote',
    response: UpgradeQuoteSchema,
  },
  {
    method: 'get',
    path: '/api/v1/me/cards/craft-quote',
    operationId: 'craftQuote',
    query: CraftQuoteQuerySchema,
    response: CraftQuoteSchema,
  },
  {
    method: 'get',
    path: '/api/v1/me/ledger',
    operationId: 'ledger',
    query: LedgerQuerySchema,
    response: LedgerPageSchema,
  },
  {
    method: 'get',
    path: '/api/v1/me/lineups',
    operationId: 'lineups',
    query: LineupPageQuerySchema,
    response: LineupPageSchema,
  },
  { method: 'get', path: '/api/v1/me/lineups/{id}', operationId: 'lineup', response: SavedLineupSchema },
  { method: 'get', path: '/api/v1/me/profile', operationId: 'profile', response: UserProfileSchema },
  {
    method: 'get',
    path: '/api/v1/me/local-import',
    operationId: 'localImportStatus',
    response: LocalImportStatusSchema,
  },
  {
    method: 'post',
    path: '/api/v1/me/local-import',
    operationId: 'importLocalPreferences',
    body: LocalImportCommandSchema,
    response: LocalImportReceiptSchema,
  },
  {
    method: 'get',
    path: '/api/v1/me/cards',
    operationId: 'ownedCards',
    query: CardPageQuerySchema,
    response: CardPageSchema,
  },
  { method: 'get', path: '/api/v1/me/wallet', operationId: 'wallet', response: WalletListSchema },
  { method: 'get', path: '/api/v1/auth/options', operationId: 'authOptions', response: AuthOptionsSchema },
  { method: 'get', path: '/api/v1/me/identities', operationId: 'identityStatus', response: IdentityStatusSchema },
  { method: 'get', path: '/api/v1/auth/csrf', operationId: 'csrf' },
  { method: 'post', path: '/api/v1/auth/refresh', operationId: 'refresh', body: RefreshSchema },
  { method: 'post', path: '/api/v1/me/reauthenticate', operationId: 'reauthenticate', body: ReauthenticateSchema },
  {
    method: 'post',
    path: '/api/v1/me/identities/link',
    operationId: 'linkIdentity',
    body: LinkIdentitySchema,
    successStatuses: [200, 202],
  },
  {
    method: 'post',
    path: '/api/v1/me/identities/confirm',
    operationId: 'confirmIdentity',
    body: ConfirmIdentitySchema,
  },
  { method: 'delete', path: '/api/v1/me', operationId: 'deleteAccount', body: DeleteAccountSchema, successStatus: 202 },
  { method: 'get', path: '/api/v1/me/deletion-policy', operationId: 'deletionPolicy' },
  { method: 'post', path: '/api/v1/auth/deletion/status', operationId: 'deletionStatus', body: DeletionRecoverySchema },
  { method: 'post', path: '/api/v1/auth/deletion/cancel', operationId: 'cancelDeletion', body: DeletionRecoverySchema },
  { method: 'post', path: '/api/v1/auth/wechat/exchange', operationId: 'wechatExchange', body: WechatLoginSchema },
  {
    method: 'post',
    path: '/api/v1/auth/logout',
    operationId: 'logout',
    body: LogoutSchema,
    response: LogoutResultSchema,
  },
  { method: 'get', path: '/api/v1/me', operationId: 'currentUser', response: CurrentUserSchema },
  {
    method: 'get',
    path: '/api/v1/me/sessions',
    operationId: 'sessions',
    query: SessionListQuerySchema,
    response: SessionListSchema,
  },
  {
    method: 'delete',
    path: '/api/v1/me/sessions/{id}',
    operationId: 'revokeSession',
    response: RevokeSessionResultSchema,
  },
  { method: 'post', path: '/api/v1/auth/register', operationId: 'register', body: RegisterSchema, successStatus: 202 },
  { method: 'post', path: '/api/v1/auth/login', operationId: 'login', body: LoginSchema },
  { method: 'post', path: '/api/v1/auth/email/verify', operationId: 'verifyEmail', body: VerifyEmailSchema },
  {
    method: 'post',
    path: '/api/v1/auth/email/verification-request',
    operationId: 'requestEmailVerification',
    body: ResetRequestSchema,
    successStatus: 202,
  },
  {
    method: 'post',
    path: '/api/v1/auth/password/reset-request',
    operationId: 'requestPasswordReset',
    body: ResetRequestSchema,
    successStatus: 202,
  },
  { method: 'post', path: '/api/v1/auth/password/reset', operationId: 'resetPassword', body: ResetPasswordSchema },
  {
    method: 'patch',
    path: '/api/v1/me/profile',
    operationId: 'updateProfile',
    body: ProfileSchema,
    response: UserProfileSchema,
  },
  {
    method: 'put',
    path: '/api/v1/me/lineups/{id}',
    operationId: 'saveLineup',
    body: LineupSchema,
    response: SavedLineupSchema,
  },
  {
    method: 'post',
    path: '/api/v1/me/cards/{id}/upgrade',
    operationId: 'upgradeCard',
    body: UpgradeSchema,
    response: AssetOperationSchema,
  },
  {
    method: 'post',
    path: '/api/v1/me/cards/craft',
    operationId: 'craftCard',
    body: CraftSchema,
    response: AssetOperationSchema,
  },
  {
    method: 'post',
    path: '/api/v1/matches/tickets',
    operationId: 'matchTicket',
    body: MatchTicketSchema,
    response: MatchTicketResultSchema,
  },
  { method: 'get', path: '/api/v1/matchmaking/options', operationId: 'queueOptions', response: QueueOptionsSchema },
  {
    method: 'get',
    path: '/api/v1/matchmaking/entries/current',
    operationId: 'currentQueue',
    response: QueueStatusSchema,
  },
  { method: 'get', path: '/api/v1/matchmaking/entries/{id}', operationId: 'queueEntry', response: QueueStatusSchema },
  {
    method: 'post',
    path: '/api/v1/matchmaking/entries',
    operationId: 'enterQueue',
    body: QueueSchema,
    response: QueueStatusSchema,
  },
  {
    method: 'delete',
    path: '/api/v1/matchmaking/entries/{id}',
    operationId: 'cancelQueue',
    response: QueueStatusSchema,
  },
  {
    method: 'post',
    path: '/api/v1/matchmaking/entries/{id}/ticket',
    operationId: 'queueTicket',
    body: ReentryCommandSchema,
    response: MatchTicketResultSchema,
  },
  { method: 'get', path: '/api/v1/me/rating', operationId: 'ownRating', response: OwnRatingsSchema },
  {
    method: 'get',
    path: '/api/v1/ratings/leaderboard',
    operationId: 'ratingLeaderboard',
    query: LeaderboardQuerySchema,
    response: LeaderboardSchema,
  },
] as const;

/** Boundary validation only; authentication/ownership/idempotency belong to the service. */
export function decodeBody<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { ok: true; value: T } | { ok: false; code: 'INVALID_REQUEST' } {
  const parsed = schema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: 'INVALID_REQUEST' };
}
