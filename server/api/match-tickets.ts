import { Router } from 'express';
import type { MatchTickets, AccountRooms } from '../matches/tickets';
import type { WebSessions } from './web-sessions';
import type { Principal } from '../accounts/access-tokens';
import type { ApiModule } from './modules';
import { ApiError, asyncRoute, requireAccountTarget } from './http';
import type { RoomAdmission } from '../matches/admission';

export function matchTicketsModule(
  tickets: MatchTickets,
  web: WebSessions,
  rooms: AccountRooms,
  admission: RoomAdmission,
): ApiModule {
  return {
    area: 'matches',
    createRouter() {
      const router = Router();
      router.use(web.boundary, web.requireAccess);
      router.post(
        '/tickets',
        asyncRoute(async (req, res) => {
          const principal = res.locals.principal as Principal;
          requireAccountTarget(req, principal.userId);
          if (Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
          if (
            !admission.allow(
              req.socket.remoteAddress ?? 'unknown',
              req.body?.roomCode === undefined ? 'create' : 'connect',
            )
          )
            throw new ApiError('RATE_LIMITED', 429, true);
          res.json({
            ok: true,
            data: await tickets.issue(principal, req.body, rooms),
            requestId: res.locals.requestId,
          });
        }),
      );
      return router;
    },
  };
}
