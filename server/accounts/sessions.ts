import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Database, type SqlExecutor } from '../../packages/persistence/src/database';
import { SessionRepository } from '../../packages/persistence/src/sessions';
import { ApiError } from '../api/http';
import { AccessTokens, UUID } from './access-tokens';
import type { Principal } from './access-tokens';
import type { InitializeAccount } from './player-data';
import { DeviceKindSchema, SessionCursorSchema, type DeviceKind } from '../../packages/contracts/src/accounts';
import { UserDataRepository } from '../../packages/persistence/src/user-data';

export const REFRESH_SECONDS = 30 * 24 * 60 * 60;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function equalSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
export interface SessionCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export class Sessions {
  readonly access: AccessTokens;
  private readonly refreshKey: Buffer;
  constructor(
    private readonly db: Database,
    secret: string,
    issuer: string,
    private readonly initialize?: InitializeAccount,
  ) {
    this.access = new AccessTokens(secret, issuer);
    this.refreshKey = createHmac('sha256', secret).update('refresh-derivation-v1').digest();
  }
  private refreshToken(id: string, family: string, generation: number): string {
    const secret = createHmac('sha256', this.refreshKey).update(`${id}:${family}:${generation}`).digest('base64url');
    return `${id}.${generation}.${secret}`;
  }
  async issue(
    tx: SqlExecutor,
    userId: string,
    csrf: string,
    deviceKind: DeviceKind = 'unknown',
  ): Promise<SessionCredentials> {
    const id = randomUUID();
    const familyId = randomUUID();
    const refreshToken = this.refreshToken(id, familyId, 0);
    const expiresAt = await new SessionRepository(tx).create({
      id,
      userId,
      familyId,
      refreshHash: hash(refreshToken),
      csrfHash: hash(csrf),
      durationSeconds: REFRESH_SECONDS,
      deviceKind,
    });
    if (!expiresAt) throw new ApiError('UNAUTHENTICATED', 401);
    return { accessToken: await this.access.issue(userId, id, expiresAt), refreshToken, expiresAt };
  }
  async authenticate(token: string, csrf?: string) {
    const principal = await this.access.verify(token);
    const state = await new SessionRepository(this.db).active(principal.sessionId, principal.userId);
    if (!state) throw new ApiError('UNAUTHENTICATED', 401);
    if (csrf !== undefined && !equalSecret(state.csrf_token_hash, hash(csrf))) throw new ApiError('FORBIDDEN', 403);
    return principal;
  }

  private active<T>(principal: Principal, work: (tx: SqlExecutor, repo: SessionRepository) => Promise<T>) {
    return this.db.transaction(async (tx) => {
      const repo = new SessionRepository(tx);
      const state = await repo.lock(principal.sessionId);
      if (
        !state ||
        state.user_id !== principal.userId ||
        state.revoked_at ||
        !state.unexpired ||
        state.status !== 'active'
      )
        throw new ApiError('UNAUTHENTICATED', 401);
      return work(tx, repo);
    });
  }
  current(principal: Principal) {
    return this.active(principal, async (tx) => {
      await this.initialize?.(tx, principal.userId);
      const profile = await new UserDataRepository(tx).getProfile(principal.userId);
      return {
        ...principal,
        profile: profile
          ? {
              nickname: profile.nickname,
              avatarAssetId: profile.avatarAssetId,
              level: profile.level,
              exp: profile.exp,
              version: profile.version,
            }
          : null,
      };
    });
  }
  list(principal: Principal, input: { cursor?: string; limit?: string }) {
    let cursor: { createdAt: string; id: string } | undefined;
    if (input.cursor) {
      try {
        cursor = SessionCursorSchema.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')));
      } catch {
        throw new ApiError('INVALID_REQUEST', 400);
      }
    }
    const limit = Number(input.limit ?? 20);
    return this.active(principal, async (_tx, repo) => {
      const rows = await repo.listOwned(principal.userId, limit, cursor);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        sessions: page.map((row) => ({
          id: row.id,
          deviceKind: DeviceKindSchema.safeParse(row.device_label).data ?? 'unknown',
          isCurrent: row.id === principal.sessionId,
          createdAt: row.created_at.toISOString(),
          expiresAt: row.expires_at.toISOString(),
        })),
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(JSON.stringify({ createdAt: last.cursor_time, id: last.id })).toString('base64url')
            : null,
      };
    });
  }
  revoke(principal: Principal, sessionId: string) {
    return this.active(principal, async (_tx, repo) => {
      if (!(await repo.revokeOwned(principal.userId, sessionId))) throw new ApiError('NOT_FOUND', 404);
      return { revoked: true as const };
    });
  }
  private async confirmedLogout(repo: SessionRepository, csrf: string, operationId: string, allSessions: boolean) {
    const prior = await repo.logoutAction(operationId);
    if (!prior) return null;
    if (!equalSecret(prior.csrf_token_hash, hash(csrf))) throw new ApiError('FORBIDDEN', 403);
    if (prior.all_sessions !== allSessions) throw new ApiError('CONFLICT', 409);
    return prior.session_id;
  }
  async logout(
    token: string | undefined,
    csrf: string,
    operationId: string,
    allSessions: boolean,
  ): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      const repo = new SessionRepository(tx);
      const confirmed = await this.confirmedLogout(repo, csrf, operationId, allSessions);
      if (confirmed) return confirmed;
      if (!token) {
        if (allSessions) throw new ApiError('UNAUTHENTICATED', 401);
        return null;
      }
      const id = token.split('.')[0];
      if (token.length > 150 || !UUID.test(id ?? '')) throw new ApiError('UNAUTHENTICATED', 401);
      const state = await repo.lock(id);
      if (!state) throw new ApiError('UNAUTHENTICATED', 401);
      const afterLock = await this.confirmedLogout(repo, csrf, operationId, allSessions);
      if (afterLock) return afterLock;
      if (!equalSecret(state.csrf_token_hash ?? '', hash(csrf))) throw new ApiError('FORBIDDEN', 403);
      const current = equalSecret(state.refresh_token_hash, hash(token));
      const recent = current ? null : await repo.recentlyConsumed(id, hash(token));
      if (!current && recent === null) throw new ApiError('UNAUTHENTICATED', 401);
      if (
        allSessions &&
        (state.revoked_at || !state.unexpired || state.status !== 'active' || (!current && recent !== true))
      )
        throw new ApiError('UNAUTHENTICATED', 401);
      if (allSessions) await repo.revokeAll(state.user_id);
      else await repo.revokeOwned(state.user_id, state.id);
      await repo.recordLogout(id, operationId, allSessions);
      return id;
    });
  }
  async refresh(token: string, csrf: string): Promise<SessionCredentials> {
    if (token.length > 150) throw new ApiError('UNAUTHENTICATED', 401);
    const [id, generation, secret, extra] = token.split('.');
    if (
      !UUID.test(id ?? '') ||
      !/^(0|[1-9][0-9]{0,8})$/.test(generation ?? '') ||
      !/^[A-Za-z0-9_-]{43}$/.test(secret ?? '') ||
      extra !== undefined
    )
      throw new ApiError('UNAUTHENTICATED', 401);
    const result = await this.db.transaction(async (tx) => {
      const repo = new SessionRepository(tx);
      const state = await repo.lock(id);
      if (!state || state.revoked_at || !state.unexpired || state.status !== 'active') return null;
      if (!equalSecret(state.csrf_token_hash ?? '', hash(csrf))) throw new ApiError('FORBIDDEN', 403);
      const presented = hash(token);
      if (equalSecret(presented, state.refresh_token_hash)) {
        if (state.refresh_generation >= 999_999_999) return null;
        const next = this.refreshToken(state.id, state.family_id, state.refresh_generation + 1);
        await repo.rotate(state, hash(next));
        return { state, refreshToken: next };
      }
      const recent = await repo.recentlyConsumed(state.id, presented);
      if (recent === true)
        return { state, refreshToken: this.refreshToken(state.id, state.family_id, state.refresh_generation) };
      if (recent === false) await repo.revokeFamily(state.family_id);
      return null;
    });
    // A replay revocation must commit before reporting 401.
    if (!result) throw new ApiError('UNAUTHENTICATED', 401);
    return {
      accessToken: await this.access.issue(result.state.user_id, result.state.id, result.state.expires_at),
      refreshToken: result.refreshToken,
      expiresAt: result.state.expires_at,
    };
  }
}
