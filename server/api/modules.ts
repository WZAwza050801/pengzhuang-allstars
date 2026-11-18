import { Router } from 'express';
import type { ServiceDependencies, Services } from '../services';
export interface ModuleContext extends ServiceDependencies { services: Services }
/** Modules receive explicit ports. Business authorization stays inside the owning account/asset/match service. */
export interface ApiModule {
  area: 'auth' | 'me' | 'matches' | 'matchmaking' | 'catalog' | 'config' | 'announcements' | 'ratings';
  createRouter(context: ModuleContext): Router;
}
export const catalogModule: ApiModule = {
  area: 'catalog',
  createRouter({ services }) {
    const router = Router();
    router.get('/', (_req, res) => res.json({ ok: true, data: services.assets.catalog(), requestId: res.locals.requestId }));
    return router;
  },
};
