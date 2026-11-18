import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { ApiModule } from './modules';
import type { Principal } from '../accounts/access-tokens';
import type { MatchTickets, AccountRooms } from '../matches/tickets';
import type { WebSessions } from './web-sessions';
import type { RoomAdmission } from '../matches/admission';
import { ApiError, asyncRoute, requireAccountTarget } from './http';

export function matchRecoveryModules(
  tickets: MatchTickets,
  web: WebSessions,
  rooms: AccountRooms,
  admission: RoomAdmission,
): ApiModule[] {
  const boundary: RequestHandler = (req, res, next) => {
    requireAccountTarget(req, (res.locals.principal as Principal).userId, true);
    if (Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
  return [
    {
      area: 'me',
      createRouter() {
        const result = Router();
        result.options('/active-match', web.boundary);
        result.get(
          '/active-match',
          web.boundary,
          web.requireAccess,
          boundary,
          asyncRoute(async (_req, res) => {
            res.json({
              ok: true,
              data: await tickets.recovery.read(res.locals.principal as Principal, rooms),
              requestId: res.locals.requestId,
            });
          }),
        );
        return result;
      },
    },
    {
      area: 'matches',
      createRouter() {
        const result = Router();
        result.options('/:id/reentry', web.boundary);
        result.post(
          '/:id/reentry',
          web.boundary,
          web.requireAccess,
          boundary,
          asyncRoute(async (req, res) => {
            const id = z.uuid().safeParse(req.params.id);
            if (!id.success) throw new ApiError('INVALID_REQUEST', 400);
            if (!admission.allow(req.socket.remoteAddress ?? 'unknown', 'connect'))
              throw new ApiError('RATE_LIMITED', 429, true);
            res.json({
              ok: true,
              data: await tickets.reenter(res.locals.principal as Principal, id.data, req.body, rooms),
              requestId: res.locals.requestId,
            });
          }),
        );
        return result;
      },
    },
  ];
}
