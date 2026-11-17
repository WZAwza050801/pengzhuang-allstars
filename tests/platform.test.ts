import { afterEach, expect, test, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { createHostBridge, createWebPlatform, type AudioService, type HostedView } from '@pengzhuang/platform';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const audio = (): AudioService => ({
  unlock: vi.fn(async () => undefined),
  play: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  dispose: vi.fn(),
});
const view = (): HostedView => ({ resize: vi.fn(), suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn() });
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return `http://127.0.0.1:${address.port}`;
}
function browser(origin: string) {
  const cache = new Map<string, string>();
  return {
    document: {},
    location: { origin, href: `${origin}/` },
    fetch: globalThis.fetch,
    WebSocket: globalThis.WebSocket,
    localStorage: {
      getItem: (k: string) => cache.get(k) ?? null,
      setItem: (k: string, v: string) => {
        cache.set(k, v);
      },
      removeItem: (k: string) => {
        cache.delete(k);
      },
    },
  } as unknown as Window & typeof globalThis;
}
test('late asynchronous mount is disposed after cancellation, never retained', async () => {
  const late = view();
  let resolve!: (value: HostedView) => void;
  const bridge = createHostBridge(
    () =>
      new Promise<HostedView>((done) => {
        resolve = done;
      }),
  );
  const pending = bridge.mount({}, {});
  await bridge.dispose();
  resolve(late);
  await pending;
  expect(late.dispose).toHaveBeenCalledTimes(1);
  await bridge.dispose();
  await expect(bridge.mount({}, {})).rejects.toThrow('disposed');
});
test('host bridge disposes replaced views and propagates suspend/resume', async () => {
  const a = view(),
    b = view();
  let next = a;
  const bridge = createHostBridge(() => next);
  await bridge.mount({}, {});
  bridge.suspend();
  await bridge.resume();
  expect(a.suspend).toHaveBeenCalledOnce();
  expect(a.resume).toHaveBeenCalledOnce();
  next = b;
  await bridge.mount({}, {});
  expect(a.dispose).toHaveBeenCalledOnce();
  await bridge.dispose();
  expect(b.dispose).toHaveBeenCalledOnce();
});
test('Web network uses real HTTP, bounds responses, rejects origin and cancels timeout', async () => {
  const origin = await listen(
    createServer((req, res) => {
      if (req.url === '/slow') {
        setTimeout(() => {
          res.end('{}');
        }, 100);
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(req.url === '/large' ? 'x'.repeat(1048577) : req.url === '/bad' ? 'not-json' : '{"ok":true}');
    }),
  );
  const platform = createWebPlatform({ window: browser(origin), audio: audio() });
  cleanup.push(() => platform.dispose());
  expect(await platform.network.request('/ok')).toEqual({ status: 200, body: { ok: true } });
  await expect(platform.network.request('http://example.org')).rejects.toMatchObject({ code: 'origin-not-allowed' });
  await expect(platform.network.request('/bad')).rejects.toMatchObject({ code: 'invalid-json' });
  await expect(platform.network.request('/large')).rejects.toMatchObject({ code: 'response-too-large' });
  await expect(platform.network.request('/slow', { timeoutMs: 10 })).rejects.toMatchObject({ code: 'timeout' });
  const abort = new AbortController();
  abort.abort();
  await expect(platform.network.request('/slow', { signal: abort.signal })).rejects.toMatchObject({
    code: 'cancelled',
  });
});
test('WebSocket adapter sends bounded text/binary and owns disposal', async () => {
  const server = createServer();
  const ws = new WebSocketServer({ server });
  const origin = await listen(server);
  cleanup.push(async () => {
    for (const client of ws.clients) client.terminate();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
  });
  ws.on('connection', (socket) => socket.on('message', (data, binary) => socket.send(data, { binary })));
  const platform = createWebPlatform({ window: browser(origin), audio: audio() });
  cleanup.push(() => platform.dispose());
  let opened!: () => void;
  let receive!: (data: string | ArrayBuffer) => void;
  const ready = new Promise<void>((done) => {
    opened = done;
  });
  const message = new Promise<string | ArrayBuffer>((done) => {
    receive = done;
  });
  const client = platform.network.socket(`${origin}/socket`, {
    open: () => opened(),
    message: (v) => receive(v),
    error: (code) => {
      throw new Error(code);
    },
    close: () => undefined,
  });
  await ready;
  client.send('hello');
  expect(await message).toBe('hello');
  const binary = new Promise<string | ArrayBuffer>((done) => {
    receive = done;
  });
  client.send(new Uint8Array([1, 2, 3]).buffer);
  const data = await binary;
  expect(data).toBeInstanceOf(ArrayBuffer);
  expect([...new Uint8Array(data as ArrayBuffer)]).toEqual([1, 2, 3]);
  expect(() => client.send('x'.repeat(2049))).toThrow('message-too-large');
  platform.dispose();
  expect(() => client.send('hello')).toThrow('disposed');
});
test('storage and provider availability are explicit, disposal is idempotent', async () => {
  const sound = audio();
  const platform = createWebPlatform({ window: browser('http://localhost'), audio: sound });
  await platform.storage.write('theme', 'green');
  expect(await platform.storage.read('theme')).toBe('green');
  await platform.storage.remove('theme');
  expect(await platform.storage.read('theme')).toBeNull();
  expect(platform.credentials).toBeNull();
  platform.dispose();
  platform.dispose();
  expect(sound.dispose).toHaveBeenCalledOnce();
  await expect(platform.storage.read('theme')).rejects.toMatchObject({ code: 'disposed' });
});
