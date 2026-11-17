import { Router } from 'express';
import { z } from 'zod';
import { LineupSchema } from '../../packages/contracts/src/http';
import { LineupPageQuerySchema } from '../../packages/contracts/src/lineups';
import type { Lineups } from '../accounts/lineups';
import type { Principal } from '../accounts/access-tokens';
import type { WebSessions } from './web-sessions';
import type { ApiModule } from './modules';
import { ApiError, asyncRoute } from './http';

export function lineupModule(lineups: Lineups, web: WebSessions): ApiModule {
  return { area: 'me', createRouter() {
    const router = Router(); router.use(web.boundary, web.requireAccess);
    router.get('/lineups', asyncRoute(async (req, res) => {
      const input = LineupPageQuerySchema.safeParse(req.query);
      if (!input.success) throw new ApiError('INVALID_REQUEST', 400);
      res.json({ ok: true, data: await lineups.list(res.locals.principal as Principal, input.data), requestId: res.locals.requestId });
    }));
    router.get('/lineups/:id', asyncRoute(async (req, res) => {
      const id = z.uuid().safeParse(req.params.id);
      if (!id.success || Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      res.json({ ok: true, data: await lineups.get(res.locals.principal as Principal, id.data), requestId: res.locals.requestId });
    }));
    router.put('/lineups/:id', asyncRoute(async (req, res) => {
      const id = z.uuid().safeParse(req.params.id); const input = LineupSchema.safeParse(req.body);
      if (!id.success || !input.success || Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      res.json({ ok: true, data: await lineups.save(res.locals.principal as Principal, id.data, input.data), requestId: res.locals.requestId });
    }));
    return router;
  } };
}
