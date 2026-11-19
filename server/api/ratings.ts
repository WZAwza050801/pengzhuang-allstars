import { Router } from 'express';
import { LeaderboardQuerySchema } from '../../packages/contracts/src/ratings';
import type { Ratings } from '../matches/ratings';
import type { WebSessions } from './web-sessions';
import type { ApiModule } from './modules';
import { ApiError, asyncRoute, requireAccountTarget } from './http';
import type { Principal } from '../accounts/access-tokens';

export function ratingsModule(ratings: Ratings, web: WebSessions): ApiModule[] {
  return [
    {
      area: 'me',
      createRouter() {
        const router = Router();
        router.use(web.boundary, web.requireAccess);
        router.use((req, res, next) => {
          requireAccountTarget(req, (res.locals.principal as Principal).userId);
          next();
        });
        router.get(
          '/rating',
          asyncRoute(async (_req, res) => {
            res.json({ ok: true, data: await ratings.own((res.locals.principal as Principal).userId), requestId: res.locals.requestId });
          }),
        );
        return router;
      },
    },
    {
      area: 'ratings',
      createRouter() {
        const router = Router();
        router.get(
          '/leaderboard',
          asyncRoute(async (req, res) => {
            const input = LeaderboardQuerySchema.safeParse(req.query);
            if (!input.success) throw new ApiError('INVALID_REQUEST', 400);
            res.json({ ok: true, data: await ratings.leaderboard(input.data), requestId: res.locals.requestId });
          }),
        );
        return router;
      },
    },
  ];
}