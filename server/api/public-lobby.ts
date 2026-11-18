import { Router } from 'express';
import { activeAnnouncements, publicManifest, LOBBY_CONTENT } from '../../config/lobby';
import type { LobbyContent } from '../../packages/contracts/src/lobby';
import type { ApiModule } from './modules';
import { ApiError, asyncRoute } from './http';

export function publicLobbyModules(maintenance = false, readContent: () => LobbyContent = () => LOBBY_CONTENT): ApiModule[] {
  return [
    { area: 'config', createRouter({ resolveData }) { const router = Router(); router.get('/manifest', asyncRoute(async (req, res) => {
      if (Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true, data: publicManifest(resolveData(), maintenance), requestId: res.locals.requestId });
    })); return router; } },
    { area: 'announcements', createRouter({ clock }) { const router = Router(); router.get('/', asyncRoute(async (req, res) => {
      if (Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true, data: activeAnnouncements(readContent(), new Date(clock.wallMs())), requestId: res.locals.requestId });
    })); return router; } },
  ];
}
