import { Router } from 'express';
import { ProfileSchema } from '../../packages/contracts/src/http';
import { CardPageQuerySchema } from '../../packages/contracts/src/player-data';
import type { PlayerData } from '../accounts/player-data';
import type { Principal } from '../accounts/access-tokens';
import type { WebSessions } from './web-sessions';
import type { ApiModule } from './modules';
import { ApiError, asyncRoute } from './http';

export function playerDataModule(players: PlayerData, web: WebSessions): ApiModule {
  return { area: 'me', createRouter() {
    const router = Router(); router.use(web.boundary, web.requireAccess);
    for (const area of ['profile', 'wallet'] as const) router.get(`/${area}`, asyncRoute(async (req, res) => {
      if (Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      const principal = res.locals.principal as Principal;
      const data = area === 'profile' ? await players.profile(principal) : await players.wallets(principal);
      res.json({ ok: true, data, requestId: res.locals.requestId });
    }));
    router.get('/cards', asyncRoute(async (req, res) => {
      const input = CardPageQuerySchema.safeParse(req.query);
      if (!input.success) throw new ApiError('INVALID_REQUEST', 400);
      res.json({ ok: true, data: await players.cards(res.locals.principal as Principal, input.data), requestId: res.locals.requestId });
    }));
    router.patch('/profile', asyncRoute(async (req, res) => {
      const input = ProfileSchema.safeParse(req.body);
      if (!input.success || Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      res.json({ ok: true, data: await players.updateProfile(res.locals.principal as Principal, input.data), requestId: res.locals.requestId });
    }));
    return router;
  } };
}
