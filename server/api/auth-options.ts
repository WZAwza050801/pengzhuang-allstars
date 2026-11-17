import { Router } from 'express';
import type { ApiModule } from './modules';
import type { WebSessions } from './web-sessions';

/** Public capabilities only; cookie presence is a restore hint, never authorization. */
export function authOptionsModule(emailEnabled: boolean, wechatMiniProgram: boolean, web: WebSessions | null): ApiModule {
  return { area: 'auth', createRouter() {
    const router = Router();
    router.get('/options', ...(web ? [web.boundary] : []), (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      const sessionPresent = !!web && !!(web.cookie(req, web.names.access) || web.cookie(req, web.names.refresh));
      res.json({ ok: true, data: { emailEnabled, wechatMiniProgram, sessionPresent }, requestId: res.locals.requestId });
    });
    return router;
  } };
}
