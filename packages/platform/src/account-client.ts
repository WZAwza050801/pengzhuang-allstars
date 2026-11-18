import { z } from 'zod';
import {
  ApiErrorSchema,
  RegisterSchema,
  LoginSchema,
  VerifyEmailSchema,
  ResetRequestSchema,
  ResetPasswordSchema,
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
import { PublicManifestSchema, LobbyContentSchema, LobbyAccountSchema } from '../../contracts/src/lobby';
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
  private csrfFlight: Promise<AccountResponse<z.infer<typeof csrfSchema>>> | null = null;
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
    if (this.csrfFlight) return this.csrfFlight;
    this.csrfFlight = this.call('/auth/csrf', csrfSchema)
      .then((result) => {
        if (result.ok) this.csrf = result.data.csrfToken;
        return result;
      })
      .finally(() => {
        this.csrfFlight = null;
      });
    return this.csrfFlight;
  }
  private async write<T>(path: string, schema: z.ZodType<T>, options: HttpRequest): Promise<AccountResponse<T>> {
    const csrf = await this.ensureCsrf();
    if (!csrf.ok) return csrf;
    return this.call(path, schema, {
      ...options,
      headers: { ...options.headers, 'X-CSRF-Token': csrf.data.csrfToken },
    });
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
  current() {
    return this.protected(() => this.call('/me', CurrentUserSchema));
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
    if (!z.uuid().safeParse(userId).success) return Promise.resolve(invalid);
    return this.protected(() =>
      this.call('/me/local-import', LocalImportStatusSchema, { headers: { 'X-Account-Id': userId } }),
    );
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
