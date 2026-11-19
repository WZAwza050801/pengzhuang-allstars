import { Router } from 'express';
import { SeasonHistoryQuerySchema } from '../../packages/contracts/src/seasons';
import type { SeasonService } from '../matches/seasons';
import type { ApiModule } from './modules';
import { ApiError, asyncRoute } from './http';

export function seasonsModule(seasons: SeasonService): ApiModule[] {
  return [
    {
      area: 'seasons',
      createRouter() {
        const router = Router();
        router.get(
          '/',
          asyncRoute(async (_req, res) => {
            res.json({ ok: true, data: await seasons.list(), requestId: res.locals.requestId });
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
          '/history',
          asyncRoute(async (req, res) => {
            const input = SeasonHistoryQuerySchema.safeParse(req.query);
            if (!input.success) throw new ApiError('INVALID_REQUEST', 400);
            res.json({ ok: true, data: await seasons.history(input.data), requestId: res.locals.requestId });
          }),
        );
        return router;
      },
    },
  ];
}