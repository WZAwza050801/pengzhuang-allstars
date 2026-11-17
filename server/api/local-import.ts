import { Router } from 'express';
import { LocalImportCommandSchema } from '../../packages/contracts/src/local-import';
import type { LocalImports } from '../accounts/local-import';
import type { Principal } from '../accounts/access-tokens';
import type { WebSessions } from './web-sessions';
import type { ApiModule } from './modules';
import { ApiError, asyncRoute } from './http';

export function localImportModule(imports: LocalImports, web: WebSessions): ApiModule {
  return { area: 'me', createRouter() {
    const router = Router(); router.use(web.boundary, web.requireAccess);
    router.get('/local-import', asyncRoute(async (req, res) => {
      if (Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      if (req.get('X-Account-Id') !== (res.locals.principal as Principal).userId) throw new ApiError('CONFLICT', 409);
      res.json({ ok: true, data: await imports.get(res.locals.principal as Principal), requestId: res.locals.requestId });
    }));
    router.post('/local-import', asyncRoute(async (req, res) => {
      const input = LocalImportCommandSchema.safeParse(req.body);
      if (!input.success || Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      if (req.get('X-Account-Id') !== (res.locals.principal as Principal).userId) throw new ApiError('CONFLICT', 409);
      res.json({ ok: true, data: await imports.import(res.locals.principal as Principal, input.data), requestId: res.locals.requestId });
    }));
    return router;
  } };
}
