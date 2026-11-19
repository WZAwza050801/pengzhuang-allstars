import { Router } from 'express';
import { z } from 'zod';
import { UpgradeSchema, CraftSchema } from '../../packages/contracts/src/http';
import { LedgerQuerySchema, CraftQuoteQuerySchema } from '../../packages/contracts/src/economy-operations';
import type { Assets } from '../accounts/assets';
import type { Principal } from '../accounts/access-tokens';
import type { WebSessions } from './web-sessions';
import type { ApiModule } from './modules';
import { ApiError, asyncRoute, requireAccountTarget } from './http';

export function assetModule(assets: Assets, web: WebSessions): ApiModule {
  return { area: 'me', createRouter() {
    const router = Router(); router.use(web.boundary, web.requireAccess);
    router.use((req, res, next) => { requireAccountTarget(req, (res.locals.principal as Principal).userId); next(); });
    router.get('/cards/:id/upgrade-quote', asyncRoute(async (req, res) => {
      const id = z.uuid().safeParse(req.params.id);
      if (!id.success || Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      res.json({ ok: true, data: await assets.upgradeQuote(res.locals.principal as Principal, id.data), requestId: res.locals.requestId });
    }));
    router.get('/cards/craft-quote', asyncRoute(async (req, res) => {
      const input = CraftQuoteQuerySchema.safeParse(req.query);
      if (!input.success) throw new ApiError('INVALID_REQUEST', 400);
      res.json({ ok: true, data: await assets.craftQuote(res.locals.principal as Principal, input.data.playerDefId), requestId: res.locals.requestId });
    }));
    router.get('/ledger', asyncRoute(async (req, res) => {
      const input = LedgerQuerySchema.safeParse(req.query);
      if (!input.success) throw new ApiError('INVALID_REQUEST', 400);
      res.json({ ok: true, data: await assets.ledger(res.locals.principal as Principal, input.data), requestId: res.locals.requestId });
    }));
    router.post('/cards/:id/upgrade', asyncRoute(async (req, res) => {
      const id = z.uuid().safeParse(req.params.id); const operation = z.uuid().safeParse(req.get('Idempotency-Key')); const input = UpgradeSchema.safeParse(req.body);
      if (!id.success || !operation.success || !input.success || Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      res.json({ ok: true, data: await assets.upgrade(res.locals.principal as Principal, id.data, operation.data, input.data), requestId: res.locals.requestId });
    }));
    router.post('/cards/craft', asyncRoute(async (req, res) => {
      const operation = z.uuid().safeParse(req.get('Idempotency-Key')); const input = CraftSchema.safeParse(req.body);
      if (!operation.success || !input.success || Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      res.json({ ok: true, data: await assets.craft(res.locals.principal as Principal, operation.data, input.data), requestId: res.locals.requestId });
    }));
    return router;
  } };
}
