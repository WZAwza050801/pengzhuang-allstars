import type {
  AudioService,
  CredentialService,
  HttpRequest,
  LifecycleState,
  PlatformServices,
  SocketHandlers,
  Viewport,
} from './types';

export class PlatformError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PlatformError';
  }
}
type BrowserWindow = Window & typeof globalThis;
export function createWebPlatform(options: {
  window?: BrowserWindow;
  audio: AudioService;
  credentials?: CredentialService;
  allowedOrigins?: readonly string[];
}): PlatformServices {
  const win = options.window ?? window;
  const doc = win.document;
  const cleanups = new Set<() => void>();
  const requests = new Set<AbortController>();
  const origins = new Set(options.allowedOrigins ?? [win.location.origin]);
  let disposed = false;
  const alive = () => {
    if (disposed) throw new PlatformError('disposed');
  };
  const own = (cleanup: () => void) => {
    cleanups.add(cleanup);
    return () => {
      if (cleanups.delete(cleanup)) cleanup();
    };
  };
  function destination(value: string, socket = false) {
    const url = new URL(value, win.location.href);
    if (socket) {
      if (url.protocol === 'https:') url.protocol = 'wss:';
      if (url.protocol === 'http:') url.protocol = 'ws:';
    }
    const origin = url.origin.replace(/^ws/, 'http');
    if (
      !(socket ? ['ws:', 'wss:'] : ['http:', 'https:']).includes(url.protocol) ||
      url.username ||
      url.password ||
      !origins.has(origin)
    )
      throw new PlatformError('origin-not-allowed');
    return url.href;
  }
  function readViewport(): Viewport {
    alive();
    const probe = doc.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    (doc.body ?? doc.documentElement).appendChild(probe);
    const css = win.getComputedStyle(probe);
    const number = (v: string) => Number.parseFloat(v) || 0;
    const safeArea = {
      top: number(css.paddingTop),
      right: number(css.paddingRight),
      bottom: number(css.paddingBottom),
      left: number(css.paddingLeft),
    };
    probe.remove();
    return {
      width: win.innerWidth,
      height: win.visualViewport?.height ?? win.innerHeight,
      pixelRatio: win.devicePixelRatio || 1,
      safeArea,
      input: win.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine',
    };
  }
  const storage = async <T>(run: () => T): Promise<T> => {
    alive();
    try {
      return run();
    } catch {
      throw new PlatformError('storage-unavailable');
    }
  };
  return {
    kind: 'web',
    credentials: options.credentials ?? null,
    audio: options.audio,
    storage: {
      read: (key) => storage(() => win.localStorage.getItem(key)),
      write: (key, value) => storage(() => win.localStorage.setItem(key, value)),
      remove: (key) => storage(() => win.localStorage.removeItem(key)),
    },
    lifecycle: {
      onChange(fn) {
        alive();
        let pageHidden = false;
        let previous: LifecycleState | null = null;
        const emit = () => {
          const state = pageHidden || doc.hidden ? 'background' : 'active';
          if (state !== previous) {
            previous = state;
            fn(state);
          }
        };
        const hide = () => {
          pageHidden = true;
          emit();
        };
        const show = () => {
          pageHidden = false;
          emit();
        };
        doc.addEventListener('visibilitychange', emit);
        win.addEventListener('pagehide', hide);
        win.addEventListener('pageshow', show);
        const unsubscribe = own(() => {
          doc.removeEventListener('visibilitychange', emit);
          win.removeEventListener('pagehide', hide);
          win.removeEventListener('pageshow', show);
        });
        try {
          emit();
        } catch (error) {
          unsubscribe();
          throw error;
        }
        return unsubscribe;
      },
    },
    viewport: {
      read: readViewport,
      subscribe(fn) {
        alive();
        const listener = () => fn(readViewport());
        win.addEventListener('resize', listener);
        win.visualViewport?.addEventListener('resize', listener);
        return own(() => {
          win.removeEventListener('resize', listener);
          win.visualViewport?.removeEventListener('resize', listener);
        });
      },
    },
    network: {
      async request(value: string, settings: HttpRequest = {}) {
        alive();
        const url = destination(value);
        const abort = new AbortController();
        requests.add(abort);
        let timedOut = false;
        const timer = setTimeout(
          () => {
            timedOut = true;
            abort.abort();
          },
          Math.max(1, Math.min(settings.timeoutMs ?? 10000, 60000)),
        );
        const cancel = () => abort.abort();
        settings.signal?.addEventListener('abort', cancel, { once: true });
        if (settings.signal?.aborted) abort.abort();
        try {
          const response = await win.fetch(url, {
            method: settings.method ?? 'GET',
            signal: abort.signal,
            credentials: 'same-origin',
            headers: {
              ...settings.headers,
              ...(settings.body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            body: settings.body === undefined ? undefined : JSON.stringify(settings.body),
          });
          const chunks: Uint8Array[] = [];
          let length = 0;
          const reader = response.body?.getReader();
          if (reader) {
            try {
              for (;;) {
                const next = await reader.read();
                if (next.done) break;
                length += next.value.byteLength;
                if (length > 1048576) {
                  abort.abort();
                  throw new PlatformError('response-too-large');
                }
                chunks.push(next.value);
              }
            } finally {
              reader.releaseLock();
            }
          }
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          const text = new TextDecoder().decode(bytes);
          let body: unknown = null;
          if (text) {
            try {
              body = JSON.parse(text);
            } catch {
              throw new PlatformError('invalid-json');
            }
          }
          return { status: response.status, body };
        } catch (error) {
          if (error instanceof PlatformError) throw error;
          throw new PlatformError(timedOut ? 'timeout' : abort.signal.aborted ? 'cancelled' : 'network-failed');
        } finally {
          clearTimeout(timer);
          settings.signal?.removeEventListener('abort', cancel);
          requests.delete(abort);
        }
      },
      socket(value: string, handlers: SocketHandlers) {
        alive();
        const socket = new win.WebSocket(destination(value, true));
        socket.binaryType = 'arraybuffer';
        const opened = () => handlers.open();
        const error = () => handlers.error('socket-error');
        const closed = (event: CloseEvent) => handlers.close(event.code);
        const received = (event: MessageEvent) => {
          const data: unknown = event.data;
          if (typeof data !== 'string' && !(data instanceof ArrayBuffer)) {
            handlers.error('invalid-frame');
            return;
          }
          const size = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
          if (size > 2097152) {
            handlers.error('frame-too-large');
            socket.close(1009);
            return;
          }
          handlers.message(data);
        };
        socket.addEventListener('open', opened);
        socket.addEventListener('message', received);
        socket.addEventListener('error', error);
        socket.addEventListener('close', closed);
        const dispose = own(() => {
          socket.removeEventListener('open', opened);
          socket.removeEventListener('message', received);
          socket.removeEventListener('error', error);
          socket.removeEventListener('close', closed);
          socket.close();
        });
        return {
          send(data) {
            alive();
            if (socket.readyState !== win.WebSocket.OPEN) throw new PlatformError('socket-not-open');
            if ((typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength) > 2048)
              throw new PlatformError('message-too-large');
            socket.send(data);
          },
          dispose,
        };
      },
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        for (const cancel of [...cleanups]) cancel();
        cleanups.clear();
        for (const request of requests) request.abort();
        requests.clear();
        options.audio.dispose();
      }
    },
  };
}
