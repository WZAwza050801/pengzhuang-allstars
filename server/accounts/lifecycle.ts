import { createHash } from 'node:crypto';
import { AccountRepository, DuplicateIdentityError } from '../../packages/persistence/src/accounts';
import { Database, type SqlExecutor } from '../../packages/persistence/src/database';
import { EmailAuthRepository } from '../../packages/persistence/src/email-auth';
import { LifecycleRepository, type BanReason } from '../../packages/persistence/src/lifecycle';
import { SessionRepository } from '../../packages/persistence/src/sessions';
import { ApiError } from '../api/http';
import type { Principal } from './access-tokens';
import type { Passwords } from './passwords';
import type { EmailAccounts } from './email-accounts';
import type { WechatAccounts } from './wechat-accounts';

export interface DeletionPolicy { enabled: boolean; graceHours: number; version: string }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export class AccountLifecycle {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | null = null;
  constructor(private readonly db: Database, private readonly passwords: Passwords, readonly policy: DeletionPolicy,
    private readonly email: EmailAccounts | null, private readonly wechat: WechatAccounts | null) {}
  private async rate(action: string, source: string, owner: string) {
    const repo = new EmailAuthRepository(this.db);
    const a = await repo.rateLimit(digest(`lifecycle:${action}:ip:${source}`), 900, 50);
    const b = await repo.rateLimit(digest(`lifecycle:${action}:owner:${owner}`), 900, 10);
    if (!a || !b) throw new ApiError('RATE_LIMITED', 429, true);
  }
  private async active(tx: SqlExecutor, principal: Principal, recent = false) {
    const state = await new SessionRepository(tx).lock(principal.sessionId);
    if (!state || state.user_id !== principal.userId || state.status !== 'active' || state.revoked_at || !state.unexpired) throw new ApiError('UNAUTHENTICATED', 401);
    const repo = new LifecycleRepository(tx);
    if (recent && !await repo.recent(principal.sessionId)) throw new ApiError('FORBIDDEN', 403);
    return repo;
  }
  async reauthenticate(principal: Principal, proof: { method: 'password'; password: string } | { method: 'wechat'; code: string }, source: string, requestId?: string) {
    await this.rate('reauth', source, principal.userId);
    const work = async (tx: SqlExecutor) => {
      const repo = await this.active(tx, principal);
      const until = await repo.authenticate(principal.sessionId);
      await repo.audit(principal.userId, 'reauthenticated', { actorId: principal.userId, provider: proof.method === 'password' ? 'email' : 'wechat', requestId });
      return { authenticatedUntil: until.toISOString() };
    };
    if (proof.method === 'password') return this.db.transaction(async (tx) => {
      const repo = await this.active(tx, principal);
      if (!await this.passwords.matches(proof.password, await repo.password(principal.userId))) throw new ApiError('UNAUTHENTICATED', 401);
      return work(tx);
    });
    if (!this.wechat) throw new ApiError('UNAVAILABLE', 503);
    return this.wechat.usingCode(proof.code, source, async (tx, identity) => {
      const owner = await new AccountRepository(tx).findUserByIdentity(identity);
      if (owner?.id !== principal.userId) throw new ApiError('UNAUTHENTICATED', 401);
      return { userId: principal.userId, result: await work(tx) };
    });
  }
  async linkWechat(principal: Principal, code: string, source: string, requestId?: string) {
    if (!this.wechat) throw new ApiError('UNAVAILABLE', 503);
    await this.rate('link', source, principal.userId);
    // Check before consuming the one-time external credential, then again after exchange.
    await this.db.transaction((tx) => this.active(tx, principal, true));
    return this.wechat.usingCode(code, source, async (tx, identity) => {
      const repo = await this.active(tx, principal, true);
      const accounts = new AccountRepository(tx);
      const owner = await accounts.findUserByIdentity(identity);
      if (owner && owner.id !== principal.userId) throw new ApiError('CONFLICT', 409);
      if (!owner) {
        try { await accounts.linkIdentity({ userId: principal.userId, ...identity }); }
        catch (error) { if (error instanceof DuplicateIdentityError) throw new ApiError('CONFLICT', 409); throw error; }
        await repo.audit(principal.userId, 'identity_linked', { actorId: principal.userId, provider: 'wechat', requestId });
      }
      return { userId: principal.userId, result: { linked: true } };
    });
  }
  async requestEmailLink(principal: Principal, input: { email: string; password: string }, source: string, requestId?: string) {
    if (!this.email) throw new ApiError('UNAVAILABLE', 503);
    const email = input.email.trim().toLowerCase();
    await this.rate('link-email', source, email);
    await this.db.transaction((tx) => this.active(tx, principal, true));
    const passwordHash = await this.passwords.hash(input.password);
    await this.db.transaction(async (tx) => {
      const repo = await this.active(tx, principal, true);
      if (await repo.hasEmail(principal.userId)) throw new ApiError('CONFLICT', 409);
      await new EmailAuthRepository(tx).invalidateTokens(principal.userId, 'identity-link');
      const tokenHash = await this.email!.queueToken(tx, principal.userId, email, 'identity-link');
      await repo.createLink(principal.userId, principal.sessionId, email, passwordHash, tokenHash);
      await repo.audit(principal.userId, 'link_requested', { actorId: principal.userId, provider: 'email', requestId });
    });
    return { accepted: true };
  }
  async confirmEmailLink(principal: Principal, token: string, source: string, requestId?: string) {
    await this.rate('confirm-link', source, principal.userId);
    await this.db.transaction(async (tx) => {
      const repo = await this.active(tx, principal, true);
      const tokenHash = digest(token);
      const link = await repo.linkRequest(tokenHash, principal.userId, principal.sessionId);
      if (!link) throw new ApiError('INVALID_REQUEST', 400);
      try {
        await new AccountRepository(tx).linkIdentity({ userId: principal.userId, provider: 'email', providerAppId: 'primary', providerSubject: link.email });
      } catch (error) { if (error instanceof DuplicateIdentityError) throw new ApiError('CONFLICT', 409); throw error; }
      await new AccountRepository(tx).setPasswordCredential({ userId: principal.userId, passwordHash: link.password_hash });
      await new EmailAuthRepository(tx).verifyEmail(principal.userId);
      await repo.consumeLink(tokenHash);
      await repo.audit(principal.userId, 'identity_linked', { actorId: principal.userId, provider: 'email', requestId });
    });
    return { linked: true };
  }
  async requestDeletion(principal: Principal, requestId?: string) {
    if (!this.policy.enabled) throw new ApiError('UNAVAILABLE', 503);
    return this.db.transaction(async (tx) => {
      const repo = await this.active(tx, principal, true);
      const row = await repo.requestDeletion(principal.userId, this.policy.graceHours, this.policy.version);
      await repo.audit(principal.userId, 'deletion_requested', { actorId: principal.userId, requestId });
      return { requested: true, executeAt: row.execute_at.toISOString(), policyVersion: this.policy.version };
    });
  }
  identityStatus(principal: Principal) {
    return this.db.transaction(async (tx) => (await this.active(tx, principal)).identities(principal.userId));
  }
  private async recovery<T>(proof: { method: 'password'; email: string; password: string } | { method: 'wechat'; code: string }, source: string, work: (tx: SqlExecutor, repo: LifecycleRepository, userId: string) => Promise<T>): Promise<T> {
    await this.rate('recovery', source, proof.method === 'password' ? proof.email.toLowerCase() : source);
    const run = async (tx: SqlExecutor, userId: string) => {
      const repo = new LifecycleRepository(tx);
      const user = await repo.lockUser(userId);
      if (!user || !['active', 'deleting'].includes(user.status)) throw new ApiError('UNAUTHENTICATED', 401);
      return work(tx, repo, userId);
    };
    if (proof.method === 'password') return this.db.transaction(async (tx) => {
      const repo = new LifecycleRepository(tx);
      const userId = await repo.passwordOwner(proof.email.toLowerCase());
      if (userId) await repo.lockUser(userId);
      const valid = await this.passwords.matches(proof.password, userId ? await repo.password(userId) : null);
      if (!userId || !valid) throw new ApiError('UNAUTHENTICATED', 401);
      return run(tx, userId);
    });
    if (!this.wechat) throw new ApiError('UNAVAILABLE', 503);
    return this.wechat.usingCode(proof.code, source, async (tx, identity) => {
      const user = await new AccountRepository(tx).findUserByIdentity(identity);
      if (!user) throw new ApiError('UNAUTHENTICATED', 401);
      return { userId: user.id, result: await run(tx, user.id) };
    });
  }
  deletionStatus(proof: Parameters<AccountLifecycle['recovery']>[0], source: string) {
    return this.recovery(proof, source, async (_tx, repo, userId) => {
      const row = await repo.deletion(userId);
      return { status: row?.status ?? 'none', executeAt: row?.execute_at.toISOString() ?? null, policyVersion: row?.policy_version ?? null };
    });
  }
  cancelDeletion(proof: Parameters<AccountLifecycle['recovery']>[0], source: string, requestId?: string) {
    return this.recovery(proof, source, async (_tx, repo, userId) => {
      if (await repo.blocked(userId)) throw new ApiError('FORBIDDEN', 403);
      const row = await repo.deletion(userId);
      if (row?.status === 'cancelled') return { cancelled: true };
      if (!row || !await repo.cancelDeletion(userId, row.id)) throw new ApiError('CONFLICT', 409);
      await repo.audit(userId, 'deletion_cancelled', { actorId: userId, requestId });
      return { cancelled: true };
    });
  }
  /** Internal moderation port; no player-facing ban route. ADM must authorize its caller. */
  async ban(userId: string, reason: BanReason, expiresAt: Date | null = null, actorId?: string, requestId?: string) {
    await this.db.transaction(async (tx) => {
      const repo = new LifecycleRepository(tx); const user = await repo.lockUser(userId);
      if (!user || user.status === 'deleted') throw new ApiError('NOT_FOUND', 404);
      await repo.ban(userId, reason, expiresAt);
      await repo.audit(userId, 'banned', { actorId, reason, requestId });
    });
  }
  async unban(userId: string, actorId?: string, requestId?: string) {
    await this.db.transaction(async (tx) => {
      const repo = new LifecycleRepository(tx); const user = await repo.lockUser(userId);
      if (!user || user.status === 'deleted') throw new ApiError('NOT_FOUND', 404);
      if (await repo.unban(userId)) await repo.audit(userId, 'unbanned', { actorId, requestId });
    });
  }
  sweep(): Promise<void> { return this.running ??= this.runSweep().finally(() => { this.running = null; }); }
  private async runSweep() {
    const source = new LifecycleRepository(this.db);
    await source.purgeLinks();
    const failures: unknown[] = [];
    for (const due of this.policy.enabled ? await source.dueDeletions() : []) try { await this.db.transaction(async (tx) => {
      const repo = new LifecycleRepository(tx); const user = await repo.lockUser(due.user_id, true);
      if (user?.status !== 'deleting') return;
      const row = await repo.deletion(user.id);
      if (row && await repo.erase(user.id, row.id)) await repo.audit(user.id, 'deletion_completed');
    }); } catch (error) { failures.push(error); }
    for (const due of await source.dueBans()) try { await this.db.transaction(async (tx) => {
      const repo = new LifecycleRepository(tx); const user = await repo.lockUser(due.user_id, true);
      if (user && user.status !== 'deleted' && await repo.unban(user.id, true)) await repo.audit(user.id, 'ban_expired');
    }); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Account lifecycle jobs failed');
  }
  start() {
    this.timer ??= setInterval(() => { void this.sweep().catch(() => console.error(JSON.stringify({ event: 'account_lifecycle_worker_failed' }))); }, 1000);
    this.timer.unref();
  }
  async close() { if (this.timer) clearInterval(this.timer); this.timer = undefined; await this.running; }
}
