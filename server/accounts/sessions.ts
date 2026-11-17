import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Database, type SqlExecutor } from '../../packages/persistence/src/database';
import { SessionRepository } from '../../packages/persistence/src/sessions';
import { ApiError } from '../api/http';
import { AccessTokens, UUID } from './access-tokens';

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
  ) {
    this.access = new AccessTokens(secret, issuer);
    this.refreshKey = createHmac('sha256', secret).update('refresh-derivation-v1').digest();
  }
  private refreshToken(id: string, family: string, generation: number): string {
    const secret = createHmac('sha256', this.refreshKey).update(`${id}:${family}:${generation}`).digest('base64url');
    return `${id}.${generation}.${secret}`;
  }
  async issue(tx: SqlExecutor, userId: string, csrf: string): Promise<SessionCredentials> {
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
