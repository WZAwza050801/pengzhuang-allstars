import { Router } from 'express';
import { ReauthenticateSchema, LinkIdentitySchema, ConfirmIdentitySchema, DeleteAccountSchema, DeletionRecoverySchema } from '../../packages/contracts/src/lifecycle';
import type { AccountLifecycle } from '../accounts/lifecycle';
import type { Principal } from '../accounts/access-tokens';
import type { WebSessions } from './web-sessions';
import type { ApiModule } from './modules';
import { ApiError, asyncRoute } from './http';

export function lifecycleModules(lifecycle: AccountLifecycle, web: WebSessions): ApiModule[] {
  return [{ area: 'me', createRouter() {
    const router = Router(); router.use(web.boundary, web.requireAccess);
    router.get('/deletion-policy', (_req, res) => res.json({ ok: true, data: lifecycle.policy, requestId: res.locals.requestId }));
    router.get('/identities', asyncRoute(async (req, res) => {
      if (Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      res.json({ ok: true, data: await lifecycle.identityStatus(res.locals.principal as Principal), requestId: res.locals.requestId });
    }));
    router.post('/reauthenticate', asyncRoute(async (req, res) => {
      const input = ReauthenticateSchema.safeParse(req.body);
      if (!input.success || Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      const data = await lifecycle.reauthenticate(res.locals.principal as Principal, input.data, req.socket.remoteAddress ?? 'unknown', res.locals.requestId);
      res.json({ ok: true, data, requestId: res.locals.requestId });
    }));
    router.post('/identities/link', asyncRoute(async (req, res) => {
      const input = LinkIdentitySchema.safeParse(req.body);
      if (!input.success || Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      const principal = res.locals.principal as Principal; const source = req.socket.remoteAddress ?? 'unknown';
      const data = input.data.provider === 'email'
        ? await lifecycle.requestEmailLink(principal, input.data, source, res.locals.requestId)
        : await lifecycle.linkWechat(principal, input.data.code, source, res.locals.requestId);
      res.status(input.data.provider === 'email' ? 202 : 200).json({ ok: true, data, requestId: res.locals.requestId });
    }));
    router.post('/identities/confirm', asyncRoute(async (req, res) => {
      const input = ConfirmIdentitySchema.safeParse(req.body);
      if (!input.success || Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      const data = await lifecycle.confirmEmailLink(res.locals.principal as Principal, input.data.token, req.socket.remoteAddress ?? 'unknown', res.locals.requestId);
      res.json({ ok: true, data, requestId: res.locals.requestId });
    }));
    router.delete('/', asyncRoute(async (req, res) => {
      if (!DeleteAccountSchema.safeParse(req.body).success || Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      const data = await lifecycle.requestDeletion(res.locals.principal as Principal, res.locals.requestId);
      web.clearCredentials(res); res.status(202).json({ ok: true, data, requestId: res.locals.requestId });
    }));
    return router;
  } }, { area: 'auth', createRouter() {
    const router = Router(); router.use(web.boundary);
    for (const action of ['status', 'cancel'] as const) router.post(`/deletion/${action}`, asyncRoute(async (req, res) => {
      const input = DeletionRecoverySchema.safeParse(req.body);
      if (!input.success || Object.keys(req.query).length) throw new ApiError('INVALID_REQUEST', 400);
      const source = req.socket.remoteAddress ?? 'unknown';
      const data = action === 'status' ? await lifecycle.deletionStatus(input.data, source) : await lifecycle.cancelDeletion(input.data, source, res.locals.requestId);
      res.json({ ok: true, data, requestId: res.locals.requestId });
    }));
    return router;
  } }];
}
