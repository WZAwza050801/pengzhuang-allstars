import { createHmac, randomBytes } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { RuntimeConfig } from '../../config/runtime';
import { RefreshSchema } from '../../packages/contracts/src/http';
import { LogoutSchema, type DeviceKind } from '../../packages/contracts/src/accounts';
import { UUID } from '../accounts/access-tokens';
import { ACCESS_SECONDS } from '../accounts/access-tokens';
import { equalSecret, REFRESH_SECONDS, type SessionCredentials, type Sessions } from '../accounts/sessions';
import { ApiError, asyncRoute } from './http';
import type { ApiModule } from './modules';

const writes = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class WebSessions {
  readonly names: { access: string; refresh: string; csrf: string };
  private readonly csrfKey: Buffer;
  constructor(
    readonly sessions: Sessions,
    private readonly config: Pick<RuntimeConfig, 'cookieSecure' | 'allowedOrigins'>,
    secret: string,
  ) {
    const prefix = config.cookieSecure ? '__Host-pz_' : 'pz_';
    this.names = { access: `${prefix}access`, refresh: `${prefix}refresh`, csrf: `${prefix}csrf` };
    this.csrfKey = createHmac('sha256', secret).update('csrf-signing-v1').digest();
  }
  cookie(req: Request, name: string): string | undefined {
    const values = (req.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${name}=`));
    if (values.length > 1) throw new ApiError('FORBIDDEN', 403);
    return values[0]?.slice(name.length + 1);
  }
  private csrfSignature(nonce: string): string {
    return createHmac('sha256', this.csrfKey).update(nonce).digest('base64url');
  }
  private validCsrf(value: string | undefined): value is string {
    if (!value || !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(value)) return false;
    return equalSecret(value.slice(44), this.csrfSignature(value.slice(0, 43)));
  }
  csrf(req: Request): string {
    const origin = req.get('Origin');
    const cookie = this.cookie(req, this.names.csrf);
    const header = req.get('X-CSRF-Token');
    if (
      !origin ||
      !this.config.allowedOrigins.includes(origin) ||
      !this.validCsrf(cookie) ||
      !header ||
      !equalSecret(cookie, header)
    )
      throw new ApiError('FORBIDDEN', 403);
    return cookie;
  }
  readonly boundary: RequestHandler = (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.vary('Origin');
      const origin = req.get('Origin');
      if (origin && !this.config.allowedOrigins.includes(origin)) throw new ApiError('FORBIDDEN', 403);
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      if (req.method === 'OPTIONS') {
        const method = req.get('Access-Control-Request-Method');
        const headers = (req.get('Access-Control-Request-Headers') ?? '')
          .toLowerCase()
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
        if (
          !origin ||
          !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method ?? '') ||
          headers.some((v) => !['content-type', 'x-csrf-token', 'authorization', 'idempotency-key', 'x-account-id'].includes(v))
        )
          throw new ApiError('FORBIDDEN', 403);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, Authorization, Idempotency-Key, X-Account-Id');
        res.status(204).end();
        return;
      }
      if (writes.has(req.method)) this.csrf(req);
      next();
    } catch (error) {
      next(error);
    }
  };
  setCredentials(res: Response, credentials: SessionCredentials): void {
    const common = { secure: this.config.cookieSecure, sameSite: 'lax' as const, path: '/', httpOnly: true };
    const remaining = Math.max(0, credentials.expiresAt.getTime() - Date.now());
    res.cookie(this.names.access, credentials.accessToken, {
      ...common,
      maxAge: Math.min(ACCESS_SECONDS * 1000, remaining),
    });
    res.cookie(this.names.refresh, credentials.refreshToken, { ...common, maxAge: remaining });
  }
  clearCredentials(res: Response): void {
    const options = { secure: this.config.cookieSecure, sameSite: 'lax' as const, path: '/', httpOnly: true };
    res.clearCookie(this.names.access, options);
    res.clearCookie(this.names.refresh, options);
  }
  deviceKind(req: Request): DeviceKind {
    const agent = req.get('User-Agent') ?? '';
    if (/iPad|Tablet/i.test(agent)) return 'tablet';
    if (/Android|iPhone|iPod|Mobile/i.test(agent)) return 'mobile';
    if (/Windows|Macintosh|X11|Linux/i.test(agent)) return 'desktop';
    return 'unknown';
  }
  readonly requireAccess: RequestHandler = asyncRoute(async (req, res, next) => {
    const cookie = this.cookie(req, this.names.access);
    const authorization = req.get('Authorization');
    if (authorization && (cookie || !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)))
      throw new ApiError('UNAUTHENTICATED', 401);
    const token = authorization?.slice(7) ?? cookie;
    if (!token) throw new ApiError('UNAUTHENTICATED', 401);
    const csrf = cookie && writes.has(req.method) ? this.csrf(req) : undefined;
    res.locals.principal = await this.sessions.authenticate(token, csrf);
    next();
  });
  module(): ApiModule {
    return {
      area: 'auth',
      createRouter: () => {
        const router = Router();
        router.use(this.boundary);
        router.get('/csrf', (req, res) => {
          let csrf = this.cookie(req, this.names.csrf);
          if (!this.validCsrf(csrf)) {
            const nonce = randomBytes(32).toString('base64url');
            csrf = `${nonce}.${this.csrfSignature(nonce)}`;
          }
          res.cookie(this.names.csrf, csrf, {
            secure: this.config.cookieSecure,
            sameSite: 'lax',
            path: '/',
            httpOnly: false,
            maxAge: REFRESH_SECONDS * 1000,
          });
          res.json({ ok: true, data: { csrfToken: csrf }, requestId: res.locals.requestId });
        });
        router.post(
          '/refresh',
          asyncRoute(async (req, res) => {
            if (!RefreshSchema.safeParse(req.body).success) throw new ApiError('INVALID_REQUEST', 400);
            const token = this.cookie(req, this.names.refresh);
            if (!token) throw new ApiError('UNAUTHENTICATED', 401);
            const credentials = await this.sessions.refresh(token, this.csrf(req));
            this.setCredentials(res, credentials);
            res.json({ ok: true, data: { refreshed: true }, requestId: res.locals.requestId });
          }),
        );
        router.post('/logout', asyncRoute(async (req, res) => {
          const input = LogoutSchema.safeParse(req.body);
          const operationId = req.get('Idempotency-Key');
          if (!input.success || !operationId || !UUID.test(operationId) || Object.keys(req.query).length)
            throw new ApiError('INVALID_REQUEST', 400);
          const token = this.cookie(req, this.names.refresh);
          const sessionId = await this.sessions.logout(token, this.csrf(req), operationId, input.data.allSessions);
          // A retry may carry cookies from a later login in another tab.
          if (!sessionId || token?.split('.')[0] === sessionId) this.clearCredentials(res);
          res.json({ ok: true, data: { loggedOut: true }, requestId: res.locals.requestId });
        }));
        return router;
      },
    };
  }
}
