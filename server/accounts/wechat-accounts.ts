import { createHash, createHmac } from 'node:crypto';
import { AccountRepository, DuplicateIdentityError } from '../../packages/persistence/src/accounts';
import { Database } from '../../packages/persistence/src/database';
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
            const accounts = new AccountRepository(tx);
            const identity = { provider: 'wechat', providerAppId: appId, providerSubject: openId };
            let user = await accounts.findUserByIdentity(identity);
            if (!user) {
              user = await accounts.createUser();
              await accounts.linkIdentity({ userId: user.id, ...identity });
            }
            if (user.status !== 'active') throw new ApiError('UNAUTHENTICATED', 401);
            const credentials = await session.service.issue(tx, user.id, session.csrf, session.deviceKind);
            if (!(await new WechatRepository(tx).succeed(appId, codeHash, user.id)))
              throw new ApiError('UNAUTHENTICATED', 401);
            return { userId: user.id, credentials };
          });
        } catch (error) {
          if (!(error instanceof DuplicateIdentityError) || attempt >= 1) throw error;
        }
      }
    } catch (error) {
      // If the database is unavailable, pending remains consumed and cannot be replayed.
      await attempts.fail(appId, codeHash).catch(() => undefined);
      throw error;
    }
  }
}
