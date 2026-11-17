import { createHash, createHmac } from 'node:crypto';
import { AccountRepository, DuplicateIdentityError } from '../../packages/persistence/src/accounts';
import { Database, type SqlExecutor } from '../../packages/persistence/src/database';
import { EmailAuthRepository } from '../../packages/persistence/src/email-auth';
import { WechatRepository } from '../../packages/persistence/src/wechat';
import type { DeviceKind } from '../../packages/contracts/src/accounts';
import { ApiError } from '../api/http';
import type { Sessions } from './sessions';
import { WechatProvider } from './wechat-provider';

export class WechatAccounts {
  private readonly codeKey: Buffer;
  constructor(
    private readonly db: Database,
    private readonly provider: WechatProvider,
    signingKey: string,
  ) {
    this.codeKey = createHmac('sha256', signingKey).update('wechat-code-replay-v1').digest();
  }
  async login(code: string, source: string, session: { service: Sessions; csrf: string; deviceKind: DeviceKind }) {
    return this.usingCode(code, source, async (tx, identity) => {
      const accounts = new AccountRepository(tx);
      let user = await accounts.findUserByIdentity(identity);
      if (!user) {
        user = await accounts.createUser();
        await accounts.linkIdentity({ userId: user.id, ...identity });
      }
      if (user.status !== 'active') throw new ApiError('UNAUTHENTICATED', 401);
      const credentials = await session.service.issue(tx, user.id, session.csrf, session.deviceKind);
      return { userId: user.id, result: { userId: user.id, credentials } };
    }, true);
  }
  async usingCode<T>(code: string, source: string, work: (tx: SqlExecutor, identity: { provider: string; providerAppId: string; providerSubject: string }) => Promise<{ userId: string; result: T }>, retryIdentityRace = false): Promise<T> {
    const appId = this.provider.appId;
    const rateKey = createHash('sha256').update(`wechat-login:${appId}:${source}`).digest('hex');
    if (!(await new EmailAuthRepository(this.db).rateLimit(rateKey, 900, 50)))
      throw new ApiError('RATE_LIMITED', 429, true);
    const codeHash = createHmac('sha256', this.codeKey).update(`${appId}\0${code}`).digest('hex');
    const attempts = new WechatRepository(this.db);
    if (!(await attempts.claim(appId, codeHash))) throw new ApiError('CONFLICT', 409);
    try {
      const { openId } = await this.provider.exchange(code);
      // Retry only the local identity race. Never exchange the one-time upstream code twice.
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.db.transaction(async (tx) => {
            const identity = { provider: 'wechat', providerAppId: appId, providerSubject: openId };
            const result = await work(tx, identity);
            if (!(await new WechatRepository(tx).succeed(appId, codeHash, result.userId)))
              throw new ApiError('UNAUTHENTICATED', 401);
            return result.result;
          });
        } catch (error) {
          if (!retryIdentityRace || !(error instanceof DuplicateIdentityError) || attempt >= 1) throw error;
        }
      }
    } catch (error) {
      // If the database is unavailable, pending remains consumed and cannot be replayed.
      await attempts.fail(appId, codeHash).catch(() => undefined);
      throw error;
    }
  }
}
