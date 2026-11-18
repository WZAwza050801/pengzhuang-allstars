import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DEFAULT_DATA } from '../shared/data';
import { MAX_CLIENT_MESSAGE_BYTES, PROTOCOL_VERSION, ROOM_NAME, ACCOUNT_ROOM_NAME } from '../shared/protocol';
import { MatchRoom, type MatchSimulator } from './rooms/MatchRoom';
import { createServices, systemClock, type ServiceDependencies } from './services';
import { catalogModule, type ApiModule } from './api/modules';
import { publicLobbyModules } from './api/public-lobby';
import type { LobbyContent } from '../packages/contracts/src/lobby';
import { ApiError, asyncRoute, errorMiddleware, requestId, sendApiError, type ErrorEvent } from './api/http';
import { AdmissionServer, RoomAdmission, type AdmissionLimits } from './matches/admission';
import { createAccountRooms } from './matches/rooms';
import type { MatchTickets } from './matches/tickets';
import type { WebSessions } from './api/web-sessions';
import { matchTicketsModule } from './api/match-tickets';
import { matchRecoveryModules } from './api/match-recovery';

/**
 * Where the built client lives. `dist/client` is produced by `npm run build` and served from the same process as
 * the game server, so one command and one address are enough to play on the LAN.
 */
function clientDir(): string | null {
  const candidates = [
    process.env.CLIENT_DIR,
    path.resolve(process.cwd(), 'dist', 'client'),
    path.resolve(import.meta.dirname, '..', 'dist', 'client'),
  ].filter((p): p is string => typeof p === 'string' && p !== '');
  for (const dir of candidates) if (existsSync(path.join(dir, 'index.html'))) return dir;
  return null;
}

/** Prefer a home-network address. VPN addresses stay available, but come after. */
function lanPlayUrls(port: number): { url: string; kind: 'lan' | 'vpn' }[] {
  const found: { url: string; kind: 'lan' | 'vpn' }[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.internal || net.family !== 'IPv4') continue;
      const ip = net.address;
      const lan = ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
      if (ip.startsWith('169.254.')) continue;
      found.push({ url: `http://${ip}:${port}`, kind: lan ? 'lan' : 'vpn' });
    }
  }
  found.sort((a, b) => (a.kind === b.kind ? a.url.localeCompare(b.url) : a.kind === 'lan' ? -1 : 1));
  return found;
}

export interface GameServerOptions extends Partial<ServiceDependencies> {
  simulateShot?: MatchSimulator;
  accountRooms?: { tickets: MatchTickets; web: WebSessions };
  admissionLimits?: Partial<AdmissionLimits>;
  lobbyMaintenance?: boolean;
  readLobbyContent?: () => LobbyContent;
  modules?: readonly ApiModule[];
  clientDirectory?: string | null;
  ready?: () => Promise<void>;
  onError?: (event: ErrorEvent) => void;
  closeResources?: readonly (() => Promise<void>)[];
}

export function createGameServer(options: GameServerOptions = {}) {
  const deps: ServiceDependencies = {
    repository: options.repository ?? null, clock: options.clock ?? systemClock,
    resolveData: options.resolveData ?? (() => DEFAULT_DATA), roomStore: options.roomStore ?? null,
    outcomeSink: options.outcomeSink ?? null,
  };
  const services = createServices(deps);
  const admission = new RoomAdmission(() => deps.clock.nowMs(), options.admissionLimits);
  const accounts = options.accountRooms ? createAccountRooms(options.accountRooms.tickets, deps.clock, { simulateShot: options.simulateShot }) : null;
  let closing: Promise<void> | null = null;
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.get('/healthz', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'collision-allstars',
      protocol: PROTOCOL_VERSION,
      dataVersion: deps.resolveData().version,
      uptimeSec: Math.round(process.uptime()),
    });
  });
  app.get('/readyz', asyncRoute(async (_req, res) => {
    if (closing) throw new ApiError('UNAVAILABLE', 503, true);
    try {
      if (options.ready) await options.ready();
      else if (deps.repository) await deps.repository.query('SELECT 1');
    } catch { throw new ApiError('UNAVAILABLE', 503, true); }
    res.json({ status: 'ready', requestId: res.locals.requestId });
  }));
  app.use('/api/v1', express.json({ limit: '32kb', strict: true }));
  for (const module of [catalogModule, ...publicLobbyModules(options.lobbyMaintenance, options.readLobbyContent, !!accounts), ...(options.modules ?? []), ...(accounts && options.accountRooms ? [matchTicketsModule(options.accountRooms.tickets, options.accountRooms.web, accounts.directory, admission, options.lobbyMaintenance), ...matchRecoveryModules(options.accountRooms.tickets, options.accountRooms.web, accounts.directory, admission)] : [])]) {
    app.use(`/api/v1/${module.area}`, module.createRouter({ ...deps, services }));
  }
  app.get('/api/join-info', (req, res) => {
    res.json({ urls: lanPlayUrls(req.socket.localPort ?? 0) });
  });

  // The built client, served next to the game server: one address for both the page and the websocket.
  app.use('/api', (_req, res) => { sendApiError(res, new ApiError('NOT_FOUND', 404)); });
  const dir = options.clientDirectory === undefined ? clientDir() : options.clientDirectory;
  if (dir) {
    app.use(express.static(dir, {
      index: 'index.html',
      maxAge: '1h',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }));
    // A single-page app: unknown paths that are not API calls fall back to the entry document.
    app.get(/^\/(?!healthz(?:\/|$)|readyz(?:\/|$)|api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  app.use(errorMiddleware(options.onError));

  // Colyseus takes over the http server's 'request' listeners, so the express app must be attached first.
  const httpServer = http.createServer(app);
  const gameServer = new AdmissionServer({
    transport: new WebSocketTransport({ server: httpServer, maxPayload: MAX_CLIENT_MESSAGE_BYTES,
      verifyClient(info, done) {
        try {
          const query = new URL(info.req.url ?? '/', 'http://localhost').searchParams;
          if (query.has('_authToken') || query.has('access_token') || query.has('ticket')) { done(false, 403); return; }
        } catch { done(false, 400); return; }
        done(admission.allow(info.req.socket.remoteAddress ?? 'unknown', 'connect'), 429);
      } }),
    gracefullyShutdown: false,
    greet: false,
  });
  gameServer.admission = admission;
  class RuntimeRoom extends MatchRoom {
    protected override simulateShot(...args: Parameters<MatchSimulator>) { return options.simulateShot ? options.simulateShot(...args) : super.simulateShot(...args); }
    protected override resolveGameData(version?: string, serverCohort?: string) {
      return options.resolveData ? deps.resolveData(version, serverCohort) : super.resolveGameData(version, serverCohort);
    }
    protected override resolveStore() { return options.roomStore === undefined ? super.resolveStore() : deps.roomStore; }
    protected override resolveClock() { return deps.clock; }
    protected override authenticate(options: unknown) { return services.accounts.authenticateGuest(options); }
  }
  gameServer.define(ROOM_NAME, RuntimeRoom);
  if (accounts) gameServer.define(ACCOUNT_ROOM_NAME, accounts.roomClass);
  function close(): Promise<void> {
    return closing ??= (async () => {
      const failures: unknown[] = [];
      const transportClosed = httpServer.listening ? new Promise<void>((resolve) => httpServer.once('close', resolve)) : Promise.resolve();
      try { await gameServer.gracefullyShutdown(false); } catch (error) { failures.push(error); }
      if (httpServer.listening) httpServer.close();
      httpServer.closeIdleConnections();
      await transportClosed;
      for (const cleanup of [...(options.closeResources ?? [])].reverse()) {
        try { await cleanup(); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new Error('Server shutdown failed');
    })();
  }
  return { app, httpServer, gameServer, services, close };
}
