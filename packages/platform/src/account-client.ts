import { z } from 'zod';
import {
  ApiErrorSchema,
  RegisterSchema,
  LoginSchema,
  VerifyEmailSchema,
  ResetRequestSchema,
  ResetPasswordSchema,
  LineupSchema,
  UpgradeSchema,
} from '../../contracts/src/http';
import {
  AuthOptionsSchema,
  AccountAcceptedSchema,
  SignedInSchema,
  EmailVerifiedSchema,
  PasswordResetSchema,
} from '../../contracts/src/accounts';
import {
  ReauthenticateSchema,
  LinkIdentitySchema,
  ConfirmIdentitySchema,
  DeletionRecoverySchema,
  ReauthenticatedSchema,
  IdentityLinkedSchema,
  IdentityStatusSchema,
  DeletionPolicySchema,
  DeletionRequestedSchema,
  DeletionStatusSchema,
  DeletionCancelledSchema,
  DeleteAccountSchema,
} from '../../contracts/src/lifecycle';
import {
  CurrentUserSchema,
  LogoutResultSchema,
  SessionListSchema,
  RevokeSessionResultSchema,
  type SessionList,
} from '../../contracts/src/accounts';
import type { AccountPort, AccountResponse, LogoutIntent } from '../../client-model/src/account';
import type { HttpRequest, NetworkAdapter } from './types';
import { CardPageSchema, WalletListSchema } from '../../contracts/src/player-data';
import { LineupPageSchema, SavedLineupSchema } from '../../contracts/src/lineups';
import { UpgradeQuoteSchema, AssetOperationSchema } from '../../contracts/src/economy-operations';
import type { UpgradeIntent } from '../../client-model/src/upgrade-intent';
import { PublicManifestSchema, LobbyContentSchema, LobbyAccountSchema } from '../../contracts/src/lobby';
import { MatchTicketSchema } from '../../contracts/src/http';
import { MatchTicketResultSchema } from '../../contracts/src/match-tickets';
import { ActiveMatchSchema, ReentryCommandSchema } from '../../contracts/src/match-recovery';
import { MatchResultSchema, MatchHistorySchema, MatchHistoryQuerySchema } from '../../contracts/src/match-results';
import {
  LocalImportCommandSchema,
  LocalImportReceiptSchema,
  LocalImportStatusSchema,
} from '../../contracts/src/local-import';

const networkFailure = { ok: false as const, error: { code: 'NETWORK_ERROR' as const, retryable: true } };
const invalid = { ok: false as const, error: { code: 'INVALID_RESPONSE' as const, retryable: false } };
const refreshed = z.strictObject({ refreshed: z.literal(true) });
const csrfSchema = z.strictObject({ csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/) });

/** Uses the platform's bounded same-origin HTTP adapter; credentials stay in browser cookies. */
export class WebAccountClient implements AccountPort {
  private csrf: string | null = null;
  private csrfFlight: { epoch: number; promise: Promise<AccountResponse<z.infer<typeof csrfSchema>>> } | null = null;
  private csrfEpoch = 0;
  private currentGeneration = 0;
  private sessionId: string | null = null;
  private refreshFlight: Promise<AccountResponse<z.infer<typeof refreshed>>> | null = null;
  private refreshGeneration = 0;
  private lastRefresh: AccountResponse<z.infer<typeof refreshed>> | null = null;
  constructor(private readonly network: Pick<NetworkAdapter, 'request'>) {}
  private async call<T>(path: string, schema: z.ZodType<T>, options: HttpRequest = {}): Promise<AccountResponse<T>> {
    try {
      const response = await this.network.request(`/api/v1${path}`, options);
      if (response.status >= 200 && response.status < 300) {
        const result = z
          .strictObject({ ok: z.literal(true), data: schema, requestId: z.string().min(1).max(128) })
          .safeParse(response.body);
        return result.success ? { ok: true, data: result.data.data } : invalid;
      }
      const error = ApiErrorSchema.safeParse(response.body);
      return error.success
        ? { ok: false, error: { code: error.data.error.code, retryable: error.data.error.retryable } }
        : invalid;
    } catch {
      return networkFailure;
    }
  }
  private ensureCsrf(): Promise<AccountResponse<z.infer<typeof csrfSchema>>> {
    if (this.csrf) return Promise.resolve({ ok: true, data: { csrfToken: this.csrf } });
    if (this.csrfFlight?.epoch === this.csrfEpoch) return this.csrfFlight.promise;
    const epoch = this.csrfEpoch;
    const promise = this.call('/auth/csrf', csrfSchema)
      .then((result) => {
        if (result.ok && epoch === this.csrfEpoch) this.csrf = result.data.csrfToken;
        return result;
      })
      .finally(() => {
        if (this.csrfFlight?.promise === promise) this.csrfFlight = null;
      });
    this.csrfFlight = { epoch, promise };
    return promise;
  }
  private async write<T>(path: string, schema: z.ZodType<T>, options: HttpRequest): Promise<AccountResponse<T>> {
    const epoch = this.csrfEpoch;
    const csrf = await this.ensureCsrf();
    if (!csrf.ok) return csrf;
    const result = await this.call(path, schema, {
      ...options,
      headers: { ...options.headers, 'X-CSRF-Token': csrf.data.csrfToken },
    });
    if (!result.ok && result.error.code === 'FORBIDDEN' && epoch === this.csrfEpoch) {
      this.csrf = null;
      this.csrfEpoch++;
    }
    return result;
  }
  private refresh() {
    if (this.refreshFlight) return this.refreshFlight;
    this.refreshFlight = this.write('/auth/refresh', refreshed, { method: 'POST', body: {} })
      .then((result) => {
        this.lastRefresh = result;
        this.refreshGeneration++;
        return result;
      })
      .finally(() => {
        this.refreshFlight = null;
      });
    return this.refreshFlight;
  }
  private async protected<T>(request: () => Promise<AccountResponse<T>>): Promise<AccountResponse<T>> {
    const generation = this.refreshGeneration;
    const result = await request();
    if (result.ok || result.error.code !== 'UNAUTHENTICATED') return result;
    if (generation === this.refreshGeneration) {
      const refresh = await this.refresh();
      if (!refresh.ok) return refresh;
    }
    if (this.lastRefresh && !this.lastRefresh.ok) return this.lastRefresh;
    return request();
  }
  async current() {
    const generation = ++this.currentGeneration;
    const result = await this.protected(() => this.call('/me', CurrentUserSchema));
    if (result.ok && generation === this.currentGeneration && this.sessionId !== result.data.sessionId) {
      this.sessionId = result.data.sessionId;
      this.csrf = null;
      this.csrfEpoch++;
    }
    return result;
  }
  private readAccount<T>(userId: string, path: string, schema: z.ZodType<T>) {
    if (!z.uuid().safeParse(userId).success) return Promise.resolve(invalid);
    return this.protected(() => this.call(path, schema, { headers: { 'X-Account-Id': userId } }));
  }
  inventoryCards(userId: string, cursor?: string) {
    if (cursor && !z.uuid().safeParse(cursor).success) return Promise.resolve(invalid);
    return this.readAccount(
      userId,
      `/me/cards?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      CardPageSchema,
    );
  }
  inventoryLineups(userId: string, cursor?: string) {
    if (cursor && !z.uuid().safeParse(cursor).success) return Promise.resolve(invalid);
    return this.readAccount(
      userId,
      `/me/lineups?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      LineupPageSchema,
    );
  }
  async roomTicket(userId: string, body: unknown) {
    const input = MatchTicketSchema.safeParse(body);
    if (!z.uuid().safeParse(userId).success || !input.success)
      return { ok: false as const, error: { code: 'INVALID_REQUEST' as const, retryable: false } };
    return this.protected(() =>
      this.write('/matches/tickets', MatchTicketResultSchema, {
        method: 'POST',
        body: input.data,
        headers: { 'X-Account-Id': userId },
      }),
    );
  }
  activeMatch(userId: string) {
    return this.readAccount(userId, '/me/active-match', ActiveMatchSchema).then((result) =>
      result.ok && result.data.userId !== userId ? invalid : result,
    );
  }
  matchHistory(userId: string, query: unknown = {}) {
    const input = MatchHistoryQuerySchema.safeParse(query);
    if (!input.success) return Promise.resolve(invalid);
    const suffix = new URLSearchParams(input.data).toString();
    return this.readAccount(userId, `/me/matches${suffix ? `?${suffix}` : ''}`, MatchHistorySchema).then((result) =>
      result.ok && (result.data.userId !== userId || result.data.matches.some((match) => match.userId !== userId))
        ? invalid
        : result,
    );
  }
  matchResult(userId: string, matchId: string) {
    if (!z.uuid().safeParse(matchId).success) return Promise.resolve(invalid);
    const id = matchId.toLowerCase();
    return this.readAccount(userId, `/matches/${id}/result`, MatchResultSchema).then((result) =>
      result.ok && (result.data.userId !== userId || result.data.matchId !== id) ? invalid : result,
    );
  }
  reenterMatch(userId: string, matchId: string, body: unknown) {
    const input = ReentryCommandSchema.safeParse(body);
    if (!z.uuid().safeParse(userId).success || !z.uuid().safeParse(matchId).success || !input.success)
      return Promise.resolve(invalid);
    return this.protected(() =>
      this.write(`/matches/${matchId}/reentry`, MatchTicketResultSchema, {
        method: 'POST',
        body: input.data,
        headers: { 'X-Account-Id': userId },
      }),
    );
  }
  inventoryLineup(userId: string, id: string) {
    if (!z.uuid().safeParse(id).success) return Promise.resolve(invalid);
    return this.readAccount(userId, `/me/lineups/${id}`, SavedLineupSchema);
  }
  inventoryWallets(userId: string) {
    return this.readAccount(userId, '/me/wallet', WalletListSchema);
  }
  async saveOwnedLineup(userId: string, id: string, body: unknown) {
    const input = LineupSchema.safeParse(body);
    if (!z.uuid().safeParse(userId).success || !z.uuid().safeParse(id).success || !input.success)
      return { ok: false as const, error: { code: 'INVALID_REQUEST' as const, retryable: false } };
    return this.protected(() =>
      this.write(`/me/lineups/${id}`, SavedLineupSchema, {
        method: 'PUT',
        body: input.data,
        headers: { 'X-Account-Id': userId },
      }),
    );
  }
  async ownedUpgradeQuote(userId: string, id: string) {
    if (!z.uuid().safeParse(id).success) return invalid;
    const result = await this.readAccount(userId, `/me/cards/${id}/upgrade-quote`, UpgradeQuoteSchema);
    return result.ok && result.data.ownedCardId !== id ? invalid : result;
  }
  upgradeOwnedCard(intent: UpgradeIntent) {
    const body = UpgradeSchema.safeParse(intent.command);
    if (
      ![intent.userId, intent.ownedCardId, intent.operationId].every((value) => z.uuid().safeParse(value).success) ||
      !body.success
    )
      return Promise.resolve(invalid);
    return this.protected(() =>
      this.write(`/me/cards/${intent.ownedCardId}/upgrade`, AssetOperationSchema, {
        method: 'POST',
        body: body.data,
        headers: { 'X-Account-Id': intent.userId, 'Idempotency-Key': intent.operationId },
      }),
    );
  }
  manifest() {
    return this.call('/config/manifest', PublicManifestSchema);
  }
  announcements() {
    return this.call('/announcements', LobbyContentSchema);
  }
  lobby(userId: string) {
    if (!z.uuid().safeParse(userId).success) return Promise.resolve(invalid);
    return this.protected(async () => {
      const result = await this.call('/me/lobby', LobbyAccountSchema, { headers: { 'X-Account-Id': userId } });
      return result.ok && result.data.userId !== userId ? invalid : result;
    });
  }
  localImportStatus(userId: string) {
    return this.readAccount(userId, '/me/local-import', LocalImportStatusSchema);
  }
  importLocalPreferences(body: unknown, userId: string) {
    const input = LocalImportCommandSchema.safeParse(body);
    if (!input.success || !z.uuid().safeParse(userId).success) return Promise.resolve(invalid);
    return this.protected(() =>
      this.write('/me/local-import', LocalImportReceiptSchema, {
        method: 'POST',
        body: input.data,
        headers: { 'X-Account-Id': userId },
      }),
    );
  }
  list(cursor?: string): Promise<AccountResponse<SessionList>> {
    return this.protected(() =>
      this.call(`/me/sessions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, SessionListSchema),
    );
  }
  revoke(sessionId: string) {
    if (!z.uuid().safeParse(sessionId).success) return Promise.resolve(invalid);
    return this.protected(() =>
      this.write(`/me/sessions/${sessionId}`, RevokeSessionResultSchema, { method: 'DELETE' }),
    );
  }
  logout(intent: LogoutIntent) {
    return this.write('/auth/logout', LogoutResultSchema, {
      method: 'POST',
      body: { allSessions: intent.allSessions },
      headers: { 'Idempotency-Key': intent.operationId },
    });
  }
  options() {
    return this.call('/auth/options', AuthOptionsSchema);
  }
  private submit<I, O>(
    path: string,
    input: z.ZodType<I>,
    output: z.ZodType<O>,
    body: unknown,
    protectedRequest = false,
    method: HttpRequest['method'] = 'POST',
  ): Promise<AccountResponse<O>> {
    const parsed = input.safeParse(body);
    if (!parsed.success) return Promise.resolve({ ok: false, error: { code: 'INVALID_REQUEST', retryable: false } });
    const run = () => this.write(path, output, { method, body: parsed.data });
    return protectedRequest ? this.protected(run) : run();
  }
  register(body: unknown) {
    return this.submit('/auth/register', RegisterSchema, AccountAcceptedSchema, body);
  }
  login(body: unknown) {
    return this.submit('/auth/login', LoginSchema, SignedInSchema, body);
  }
  verify(body: unknown) {
    return this.submit('/auth/email/verify', VerifyEmailSchema, EmailVerifiedSchema, body);
  }
  verificationRequest(body: unknown) {
    return this.submit('/auth/email/verification-request', ResetRequestSchema, AccountAcceptedSchema, body);
  }
  resetRequest(body: unknown) {
    return this.submit('/auth/password/reset-request', ResetRequestSchema, AccountAcceptedSchema, body);
  }
  resetPassword(body: unknown) {
    return this.submit('/auth/password/reset', ResetPasswordSchema, PasswordResetSchema, body);
  }
  reauthenticate(body: unknown) {
    return this.submit('/me/reauthenticate', ReauthenticateSchema, ReauthenticatedSchema, body);
  }
  linkEmail(body: unknown) {
    return this.submit('/me/identities/link', LinkIdentitySchema, AccountAcceptedSchema, body, true);
  }
  confirmLink(token: string) {
    return this.submit('/me/identities/confirm', ConfirmIdentitySchema, IdentityLinkedSchema, { token }, true);
  }
  deletionPolicy() {
    return this.protected(() => this.call('/me/deletion-policy', DeletionPolicySchema));
  }
  identities() {
    return this.protected(() => this.call('/me/identities', IdentityStatusSchema));
  }
  deleteAccount() {
    return this.submit('/me', DeleteAccountSchema, DeletionRequestedSchema, { confirm: 'DELETE' }, true, 'DELETE');
  }
  deletionStatus(body: unknown) {
    return this.submit('/auth/deletion/status', DeletionRecoverySchema, DeletionStatusSchema, body);
  }
  cancelDeletion(body: unknown) {
    return this.submit('/auth/deletion/cancel', DeletionRecoverySchema, DeletionCancelledSchema, body);
  }
}
