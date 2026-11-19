import { Router } from 'express';
import type { MatchmakingInsights } from '../matches/insights';
import type { WebSessions } from './web-sessions';
import type { ApiModule } from './modules';
import { asyncRoute, requireAccountTarget } from './http';
import type { Principal } from '../accounts/access-tokens';

export function insightsModule(insights: MatchmakingInsights, web: WebSessions): ApiModule {
  return {
    area: 'me',
    createRouter() {
      const router = Router();
      router.use(web.boundary, web.requireAccess);
      router.use((req, res, next) => {
        requireAccountTarget(req, (res.locals.principal as Principal).userId);
        next();
      });
      router.get(
        '/matchmaking-insights',
        asyncRoute(async (_req, res) => {
          res.json({ ok: true, data: await insights.analyze((res.locals.principal as Principal).userId), requestId: res.locals.requestId });
        }),
      );
      return router;
    },
  };
}