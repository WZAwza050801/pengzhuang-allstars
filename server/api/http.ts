import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express';
import type { API_ERROR_CODES } from '../../packages/contracts/src/http';

type ErrorCode = (typeof API_ERROR_CODES)[number];
const messages: Record<ErrorCode, string> = {
  INVALID_REQUEST: 'Invalid request', UNAUTHENTICATED: 'Authentication required', FORBIDDEN: 'Access denied',
  NOT_FOUND: 'Resource not found', CONFLICT: 'Conflicting request', INSUFFICIENT_FUNDS: 'Insufficient funds',
  ACCOUNT_CHANGED: 'Account changed',
  RATE_LIMITED: 'Too many requests', UNAVAILABLE: 'Service unavailable', INTERNAL_ERROR: 'Internal server error',
};
export class ApiError extends Error {
  constructor(readonly code: ErrorCode, readonly status: number, readonly retryable = false) { super(messages[code]); }
}
/** A UI identity hint never chooses the authorized user; it only rejects a stale request after account switching. */
export function requireAccountTarget(req: Request, userId: string, required = false) {
  const expected = req.get('X-Account-Id');
  if ((required || expected !== undefined) && expected !== userId) throw new ApiError('ACCOUNT_CHANGED', 409);
}
export const requestId: RequestHandler = (_req, res, next) => {
  // Generate at the trust boundary instead of accepting arbitrary client header text as a log identifier.
  res.locals.requestId = randomUUID();
  res.setHeader('X-Request-Id', res.locals.requestId);
  next();
};
export function asyncRoute(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { Promise.resolve().then(() => fn(req, res, next)).catch(next); };
}
export function sendApiError(res: Response, error: ApiError) {
  return res.status(error.status).json({ ok: false, error: { code: error.code, message: error.message, retryable: error.retryable }, requestId: res.locals.requestId });
}
export interface ErrorEvent { requestId: string; method: string; code: ErrorCode; status: number }
export function errorMiddleware(report?: (event: ErrorEvent) => void): ErrorRequestHandler {
  return (error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    const kind = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
    const apiError = error instanceof ApiError ? error : kind === 'entity.too.large'
      ? new ApiError('INVALID_REQUEST', 413) : kind === 'entity.parse.failed'
      ? new ApiError('INVALID_REQUEST', 400) : new ApiError('INTERNAL_ERROR', 500);
    try { report?.({ requestId: res.locals.requestId, method: req.method, code: apiError.code, status: apiError.status }); }
    catch { /* A telemetry failure must not leave the request hanging. */ }
    sendApiError(res, apiError);
  };
}
