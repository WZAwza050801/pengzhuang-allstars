import { Router } from 'express';
import { z } from 'zod';
import type { ApiModule } from './modules';
import type { Principal } from '../accounts/access-tokens';
import type { MatchmakingQueue } from '../matches/matchmaking';
import type { MatchmakingCoordinator } from '../matches/matchmaking-coordinator';
import type { MatchTickets, AccountRooms } from '../matches/tickets';
import type { RoomAdmission } from '../matches/admission';
import type { WebSessions } from './web-sessions';
import { ReentryCommandSchema } from '../../packages/contracts/src/match-recovery';
import { ACCOUNT_PROTOCOL_VERSION } from '../../shared/protocol';
import { ApiError, asyncRoute, requireAccountTarget } from './http';

export function matchmakingModule(
  queue: MatchmakingQueue,
  coordinator: MatchmakingCoordinator,
  tickets: MatchTickets,
  web: WebSessions,
  rooms: AccountRooms,
  admission: RoomAdmission,
  maintenance = false,
): ApiModule {
  return {
    area: 'matchmaking',
    createRouter() {
      const router = Router();
      const noQuery = (req: { query: object }) => {
        if (Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      };
      const id = (raw: unknown) => {
        const value = z.uuid().safeParse(raw);
        if (!value.success) throw new ApiError('INVALID_REQUEST', 400);
        return value.data;
      };
      router.get(
        '/options',
        web.boundary,
        asyncRoute(async (req, res) => {
          noQuery(req);
          res.json({ ok: true, data: queue.capabilities(), requestId: res.locals.requestId });
        }),
      );
      router.use(web.boundary, web.requireAccess, (req, res, next) => {
        noQuery(req);
        requireAccountTarget(req, (res.locals.principal as Principal).userId, true);
        next();
      });
      router.get(
        '/entries/current',
        asyncRoute(async (_req, res) => {
          res.json({
            ok: true,
            data: await queue.current(res.locals.principal as Principal),
            requestId: res.locals.requestId,
          });
        }),
      );
      router.get(
        '/entries/:id',
        asyncRoute(async (req, res) => {
          res.json({
            ok: true,
            data: await queue.get(res.locals.principal as Principal, id(req.params.id)),
            requestId: res.locals.requestId,
          });
        }),
      );
      router.post(
        '/entries',
        asyncRoute(async (req, res) => {
          if (maintenance) throw new ApiError('UNAVAILABLE', 503, true);
          if (!admission.allow(req.socket.remoteAddress ?? 'unknown', 'create'))
            throw new ApiError('RATE_LIMITED', 429, true);
          const data = await queue.enqueue(res.locals.principal as Principal, req.body);
          void coordinator
            .pump()
            .catch(() => console.error(JSON.stringify({ event: 'matchmaking', code: 'pump-unavailable' })));
          res.json({ ok: true, data, requestId: res.locals.requestId });
        }),
      );
      router.delete(
        '/entries/:id',
        asyncRoute(async (req, res) => {
          if (!z.strictObject({}).safeParse(req.body ?? {}).success) throw new ApiError('INVALID_REQUEST', 400);
          res.json({
            ok: true,
            data: await queue.cancel(res.locals.principal as Principal, id(req.params.id)),
            requestId: res.locals.requestId,
          });
        }),
      );
      router.post(
        '/entries/:id/ticket',
        asyncRoute(async (req, res) => {
          if (!ReentryCommandSchema.safeParse(req.body).success) throw new ApiError('INVALID_REQUEST', 400);
          const principal = res.locals.principal as Principal,
            status = await queue.get(principal, id(req.params.id)),
            entry = status.entry;
          if (!entry || entry.state !== 'matched') throw new ApiError('NOT_FOUND', 404);
          if (!entry.assignment || entry.assignment.state !== 'ready') throw new ApiError('UNAVAILABLE', 503, true);
          const target = rooms.find(entry.assignment.roomCode);
          if (!target || (maintenance && target.recovery(principal.userId)?.phase !== 'playing'))
            throw new ApiError('UNAVAILABLE', 503, true);
          if (!admission.allow(req.socket.remoteAddress ?? 'unknown', 'connect'))
            throw new ApiError('RATE_LIMITED', 429, true);
          res.json({
            ok: true,
            data: await tickets.issue(
              principal,
              {
                protocol: ACCOUNT_PROTOCOL_VERSION,
                mode: entry.mode,
                roomCode: entry.assignment.roomCode,
                lineupId: entry.lineupId,
                expectedRevision: entry.lineupRevision,
              },
              rooms,
            ),
            requestId: res.locals.requestId,
          });
        }),
      );
      return router;
    },
  };
}
