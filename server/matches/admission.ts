import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server, matchMaker, ErrorCode } from 'colyseus';
import { MAX_CLIENT_MESSAGE_BYTES, isNetErrorCode } from '../../shared/protocol';

export interface AdmissionLimits {
  windowMs: number;
  perIp: number;
  global: number;
  createsPerIp: number;
  createsGlobal: number;
  maxKeys: number;
}
const defaults: AdmissionLimits = {
  windowMs: 60_000,
  perIp: 240,
  global: 1200,
  createsPerIp: 60,
  createsGlobal: 120,
  maxKeys: 10_000,
};
/** Shared by every room and both transports in one runtime. Socket addresses only; forwarding headers are untrusted. */
export class RoomAdmission {
  private start = -Infinity;
  private requests = 0;
  private creates = 0;
  private keys = new Map<string, { requests: number; creates: number }>();
  readonly limits: AdmissionLimits;
  constructor(
    private readonly now: () => number,
    limits: Partial<AdmissionLimits> = {},
  ) {
    this.limits = { ...defaults, ...limits };
  }
  allow(ip: string, action: 'create' | 'connect'): boolean {
    const now = this.now();
    if (now - this.start >= this.limits.windowMs) {
      this.start = now;
      this.requests = 0;
      this.creates = 0;
      this.keys.clear();
    }
    let key = this.keys.get(ip);
    if (!key) {
      if (this.keys.size >= this.limits.maxKeys) return false;
      key = { requests: 0, creates: 0 };
      this.keys.set(ip, key);
    }
    key.requests++;
    this.requests++;
    if (key.requests > this.limits.perIp || this.requests > this.limits.global) return false;
    if (action === 'create') {
      key.creates++;
      this.creates++;
      return key.creates <= this.limits.createsPerIp && this.creates <= this.limits.createsGlobal;
    }
    return true;
  }
}

/** Colyseus 0.16's default HTTP parser is unbounded. Keep its controller, bound input before calling it. */
export class AdmissionServer extends Server {
  admission!: RoomAdmission;
  protected override async handleMatchMakeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const headers = {
      ...matchMaker.controller.DEFAULT_CORS_HEADERS,
      ...matchMaker.controller.getCorsHeaders.call(undefined, req),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    };
    const reply = (status: number, error: string) => {
      if (res.writableEnded) return;
      res.writeHead(status, headers);
      res.end(JSON.stringify({ code: ErrorCode.APPLICATION_ERROR, error }));
    };
    if (matchMaker.state === matchMaker.MatchMakerState.SHUTTING_DOWN) {
      reply(503, 'unavailable');
      return;
    }
    const parts: string[] = req.url?.match(matchMaker.controller.allowedRoomNameChars) ?? [];
    const index = parts.indexOf(matchMaker.controller.matchmakeRoute);
    const method = parts[index + 1] ?? '';
    const action = method === 'create' || method === 'joinOrCreate' ? 'create' : 'connect';
    if (!this.admission.allow(req.socket.remoteAddress ?? 'unknown', action)) {
      reply(429, 'rate-limited');
      return;
    }
    if (req.method === 'OPTIONS') {
      await super.handleMatchMakeRequest(req, res);
      return;
    }
    if (req.method !== 'POST' || index < 0 || req.url?.includes('?')) {
      reply(400, 'bad-message');
      return;
    }
    if (Number(req.headers['content-length'] ?? 0) > MAX_CLIENT_MESSAGE_BYTES) {
      reply(413, 'bad-message');
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.setTimeout(5000, () => req.destroy());
    try {
      const body = await new Promise<string>((resolve, reject) => {
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_CLIENT_MESSAGE_BYTES) {
            reply(413, 'bad-message');
            reject(new Error('oversized'));
            return;
          }
          chunks.push(chunk);
        });
        req.once('end', () => resolve(Buffer.concat(chunks).toString()));
        req.once('aborted', () => reject(new Error('aborted')));
        req.once('error', reject);
      });
      const options: unknown = JSON.parse(body);
      req.setTimeout(0);
      const result = await matchMaker.controller.invokeMethod(method, parts[index + 2] ?? '', options, {
        headers: req.headers,
        ip: req.socket.remoteAddress ?? 'unknown',
        req,
      });
      if (!res.writableEnded) {
        res.writeHead(200, headers);
        res.end(JSON.stringify(result));
      }
    } catch (error) {
      // Room errors contain fixed protocol strings; never serialize arbitrary dependency errors/options/tokens.
      const message = error instanceof Error ? error.message : '';
      const safe = isNetErrorCode(message) ? message : 'unavailable';
      reply(400, safe);
    }
  }
}
