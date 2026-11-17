import { Router } from 'express';
import {
  LoginSchema,
  RegisterSchema,
  ResetPasswordSchema,
  ResetRequestSchema,
  VerifyEmailSchema,
} from '../../packages/contracts/src/http';
import type { ApiModule } from './modules';
import { ApiError, asyncRoute } from './http';
import type { EmailAccounts } from '../accounts/email-accounts';

export function emailAuthModule(accounts: EmailAccounts, allowedOrigins: readonly string[]): ApiModule {
  return {
    area: 'auth',
    createRouter() {
      const router = Router();
      router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        const origin = req.get('Origin');
        if (origin && !allowedOrigins.includes(origin)) return next(new ApiError('FORBIDDEN', 403));
        next();
      });
      router.post(
        '/register',
        asyncRoute(async (req, res) => {
          const input = RegisterSchema.safeParse(req.body);
          if (!input.success) throw new ApiError('INVALID_REQUEST', 400);
          res.status(202).json({
            ok: true,
            data: await accounts.register(input.data, req.socket.remoteAddress ?? 'unknown'),
            requestId: res.locals.requestId,
          });
        }),
      );
      router.post(
        '/login',
        asyncRoute(async (req, res) => {
          const input = LoginSchema.safeParse(req.body);
          if (!input.success) throw new ApiError('INVALID_REQUEST', 400);
          res.json({
            ok: true,
            data: await accounts.login(input.data, req.socket.remoteAddress ?? 'unknown'),
            requestId: res.locals.requestId,
          });
        }),
      );
      router.post(
        '/email/verify',
        asyncRoute(async (req, res) => {
          const input = VerifyEmailSchema.safeParse(req.body);
          if (!input.success) throw new ApiError('INVALID_REQUEST', 400);
          res.json({
            ok: true,
            data: await accounts.verifyEmail(input.data.token, req.socket.remoteAddress ?? 'unknown'),
            requestId: res.locals.requestId,
          });
        }),
      );
      router.post(
        '/email/verification-request',
        asyncRoute(async (req, res) => {
          const input = ResetRequestSchema.safeParse(req.body);
          if (!input.success) throw new ApiError('INVALID_REQUEST', 400);
          res
            .status(202)
            .json({
              ok: true,
              data: await accounts.requestVerification(input.data.email, req.socket.remoteAddress ?? 'unknown'),
              requestId: res.locals.requestId,
            });
        }),
      );
      router.post(
        '/password/reset-request',
        asyncRoute(async (req, res) => {
          const input = ResetRequestSchema.safeParse(req.body);
          if (!input.success) throw new ApiError('INVALID_REQUEST', 400);
          res.status(202).json({
            ok: true,
            data: await accounts.requestReset(input.data.email, req.socket.remoteAddress ?? 'unknown'),
            requestId: res.locals.requestId,
          });
        }),
      );
      router.post(
        '/password/reset',
        asyncRoute(async (req, res) => {
          const input = ResetPasswordSchema.safeParse(req.body);
          if (!input.success) throw new ApiError('INVALID_REQUEST', 400);
          res.json({
            ok: true,
            data: await accounts.resetPassword(
              input.data.token,
              input.data.password,
              req.socket.remoteAddress ?? 'unknown',
            ),
            requestId: res.locals.requestId,
          });
        }),
      );
      return router;
    },
  };
}
