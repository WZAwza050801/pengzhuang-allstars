import { Router } from 'express';
import { WechatLoginSchema } from '../../packages/contracts/src/accounts';
import type { WechatAccounts } from '../accounts/wechat-accounts';
import type { ApiModule } from './modules';
import type { WebSessions } from './web-sessions';
import { ApiError, asyncRoute } from './http';

/** Cookie delivery adapter. WX native credential delivery is a separate platform adapter. */
export function wechatAuthModule(accounts: WechatAccounts, web: WebSessions): ApiModule {
  return {
    area: 'auth',
    createRouter() {
      const router = Router();
      router.use(web.boundary);
      router.post(
        '/wechat/exchange',
        asyncRoute(async (req, res) => {
          const input = WechatLoginSchema.safeParse(req.body);
          if (!input.success || Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
          const result = await accounts.login(input.data.code, req.socket.remoteAddress ?? 'unknown', {
            service: web.sessions,
            csrf: web.csrf(req),
            deviceKind: web.deviceKind(req),
          });
          web.setCredentials(res, result.credentials);
          res.json({ ok: true, data: { userId: result.userId }, requestId: res.locals.requestId });
        }),
      );
      return router;
    },
  };
}
