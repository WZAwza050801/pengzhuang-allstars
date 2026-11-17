import { Router } from 'express';
import { z } from 'zod';
import { SessionListQuerySchema } from '../../packages/contracts/src/accounts';
import type { Principal } from '../accounts/access-tokens';
import { ApiError, asyncRoute } from './http';
import type { ApiModule } from './modules';
import type { WebSessions } from './web-sessions';

export function currentUserModule(web: WebSessions): ApiModule {
  return {
    area: 'me',
    createRouter() {
      const router = Router();
      router.use(web.boundary, web.requireAccess);
      router.get(
        '/',
        asyncRoute(async (req, res) => {
          if (Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
          const data = await web.sessions.current(res.locals.principal as Principal);
          res.json({ ok: true, data, requestId: res.locals.requestId });
        }),
      );
      router.get(
        '/sessions',
        asyncRoute(async (req, res) => {
          const input = SessionListQuerySchema.safeParse(req.query);
          if (!input.success) throw new ApiError('INVALID_REQUEST', 400);
          const data = await web.sessions.list(res.locals.principal as Principal, input.data);
          res.json({ ok: true, data, requestId: res.locals.requestId });
        }),
      );
      router.delete(
        '/sessions/:id',
        asyncRoute(async (req, res) => {
          const input = z.uuid().safeParse(req.params.id);
          if (
            !input.success ||
            Object.keys(req.query).length ||
            (req.body !== undefined && (!req.body || Array.isArray(req.body) || Object.keys(req.body).length))
          )
            throw new ApiError('INVALID_REQUEST', 400);
          const principal = res.locals.principal as Principal;
          const data = await web.sessions.revoke(principal, input.data);
          if (input.data === principal.sessionId) web.clearCredentials(res);
          res.json({ ok: true, data, requestId: res.locals.requestId });
        }),
      );
      return router;
    },
  };
}
