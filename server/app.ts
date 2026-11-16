import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DEFAULT_DATA } from '../shared/data';
import { MAX_CLIENT_MESSAGE_BYTES, PROTOCOL_VERSION, ROOM_NAME } from '../shared/protocol';
import { MatchRoom } from './rooms/MatchRoom';

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

export function createGameServer() {
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'collision-allstars',
      protocol: PROTOCOL_VERSION,
      dataVersion: DEFAULT_DATA.version,
      uptimeSec: Math.round(process.uptime()),
    });
  });
  app.get('/api/join-info', (req, res) => {
    res.json({ urls: lanPlayUrls(req.socket.localPort ?? 0) });
  });

  // The built client, served next to the game server: one address for both the page and the websocket.
  const dir = clientDir();
  if (dir) {
    app.use(express.static(dir, {
      index: 'index.html',
      maxAge: '1h',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }));
    // A single-page app: unknown paths that are not API calls fall back to the entry document.
    app.get(/^\/(?!healthz|api\/).*/, (_req, res) => {
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  // Colyseus takes over the http server's 'request' listeners, so the express app must be attached first.
  const httpServer = http.createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer, maxPayload: MAX_CLIENT_MESSAGE_BYTES }),
    gracefullyShutdown: false,
    greet: false,
  });
  gameServer.define(ROOM_NAME, MatchRoom);
  return { app, httpServer, gameServer };
}
