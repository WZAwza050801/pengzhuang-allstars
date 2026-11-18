import { Router, type RequestHandler } from 'express';
import type { ApiModule } from './modules';
import type { WebSessions } from './web-sessions';
import type { Principal } from '../accounts/access-tokens';
import type { MatchResults } from '../matches/results';
import { ApiError, asyncRoute, requireAccountTarget } from './http';

export function matchResultModules(results: MatchResults, web: WebSessions): ApiModule[] {
  const boundary: RequestHandler = (req, res, next) => {
    requireAccountTarget(req, (res.locals.principal as Principal).userId, true);
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
  return [
    {
      area: 'me',
      createRouter() {
        const router = Router();
        router.options('/matches', web.boundary);
        router.get(
          '/matches',
          web.boundary,
          web.requireAccess,
          boundary,
          asyncRoute(async (req, res) => {
            res.json({
              ok: true,
              data: await results.history(res.locals.principal as Principal, req.query),
              requestId: res.locals.requestId,
            });
          }),
        );
        return router;
      },
    },
    {
      area: 'matches',
      createRouter() {
        const router = Router();
        router.options('/:id/result', web.boundary);
        router.options('/:id/ledger', web.boundary);
        router.get(
          '/:id/result',
          web.boundary,
          web.requireAccess,
          boundary,
          asyncRoute(async (req, res) => {
            if (Object.keys(req.query).length || typeof req.params.id !== 'string')
              throw new ApiError('INVALID_REQUEST', 400);
            res.json({
              ok: true,
              data: await results.detail(res.locals.principal as Principal, req.params.id),
              requestId: res.locals.requestId,
            });
          }),
        );
        router.get(
          '/:id/ledger',
          web.boundary,
          web.requireAccess,
          boundary,
          asyncRoute(async (req, res) => {
            if (Object.keys(req.query).length || typeof req.params.id !== 'string')
              throw new ApiError('INVALID_REQUEST', 400);
            res.json({
              ok: true,
              data: await results.ledger(res.locals.principal as Principal, req.params.id),
              requestId: res.locals.requestId,
            });
          }),
        );
        return router;
      },
    },
  ];
}
