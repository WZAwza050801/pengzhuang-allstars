import { AssetCatalogSchema, type AssetCatalog } from '../../contracts/src/assets';
export type AssetEntry = AssetCatalog['assets'][number];
export interface ByteCache {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
}
export function assetAbort() {
  const error = new Error('Asset scene cancelled');
  error.name = 'AbortError';
  return error;
}
const cancelled = (signal: AbortSignal) => {
  if (signal.aborted) throw assetAbort();
};
export class MemoryByteCache implements ByteCache {
  private readonly values = new Map<string, Uint8Array>();
  private used = 0;
  constructor(readonly limit: number) {
    if (!Number.isFinite(limit) || limit < 0) throw new Error('Invalid cache budget');
  }
  get bytes() {
    return this.used;
  }
  async get(key: string) {
    const value = this.values.get(key);
    if (!value) return null;
    this.values.delete(key);
    this.values.set(key, value);
    return value.slice();
  }
  async put(key: string, bytes: Uint8Array) {
    this.drop(key);
    if (bytes.length > this.limit) return;
    this.values.set(key, bytes.slice());
    this.used += bytes.length;
    while (this.used > this.limit) this.drop(this.values.keys().next().value!);
  }
  private drop(key: string) {
    const old = this.values.get(key);
    if (old) this.used -= old.length;
    this.values.delete(key);
  }
  async remove(key: string) {
    this.drop(key);
  }
}
interface Flight {
  controller: AbortController;
  promise: Promise<Uint8Array>;
  waiters: number;
  settled: boolean;
}
export interface AssetOptions {
  fetchBytes: (url: string, signal: AbortSignal, maxBytes: number) => Promise<Uint8Array>;
  digest: (bytes: Uint8Array) => Promise<string>;
  persistent?: ByteCache;
  remoteBase?: string;
  memoryBytes?: number;
  maxAssetBytes?: number;
}
export class AssetManager {
  private readonly byId = new Map<string, AssetEntry>();
  private readonly aliases = new Map<string, string>();
  private readonly byPath = new Map<string, AssetEntry>();
  private readonly memory: MemoryByteCache;
  private readonly flights = new Map<string, Flight>();
  private corrupt = 0;
  private storageFailures = 0;
  private hits = 0;
  private requests = 0;
  private activeTransfers = 0;
  private readonly transferQueue: { start: () => void; abort: () => void }[] = [];
  constructor(
    readonly catalog: AssetCatalog,
    private readonly options: AssetOptions,
  ) {
    AssetCatalogSchema.parse(catalog);
    this.memory = new MemoryByteCache(options.memoryBytes ?? 8 * 1024 * 1024);
    for (const a of catalog.assets) {
      this.byId.set(a.id, a);
      if (a.path) this.byPath.set(a.path, a);
    }
    for (const a of catalog.aliases) this.aliases.set(a.id, a.target);
    if (options.remoteBase) {
      const url = new URL(options.remoteBase);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !url.pathname.endsWith('/')
      )
        throw new Error('Invalid asset CDN base');
    }
  }
  resolve(idOrPath: string, quality: 'low' | 'high' = 'high'): AssetEntry {
    const asset = this.byId.get(this.aliases.get(idOrPath) ?? idOrPath) ?? this.byPath.get(idOrPath);
    if (!asset || !asset.path) throw new Error('Unknown file asset');
    if (quality === 'low') {
      const variant = this.aliases.get(`low.${asset.id}`);
      if (variant) return this.byId.get(variant)!;
    }
    return asset;
  }
  scene() {
    return new AssetScene(this);
  }
  stats() {
    return {
      memoryBytes: this.memory.bytes,
      memoryLimit: this.memory.limit,
      inFlight: this.flights.size,
      waiters: [...this.flights.values()].reduce((sum, f) => sum + f.waiters, 0),
      corruptCache: this.corrupt,
      persistentFailures: this.storageFailures,
      cacheHits: this.hits,
      networkRequests: this.requests,
      activeTransfers: this.activeTransfers,
      queuedTransfers: this.transferQueue.length,
    };
  }
  private async valid(bytes: Uint8Array, asset: AssetEntry) {
    return bytes.length === asset.bytes && (await this.options.digest(bytes)) === asset.sha256;
  }
  private async transfer(url: string, signal: AbortSignal, maxBytes: number) {
    await new Promise<void>((resolve, reject) => {
      const token = {
        start: () => {
          signal.removeEventListener('abort', token.abort);
          this.activeTransfers++;
          resolve();
        },
        abort: () => {
          const index = this.transferQueue.indexOf(token);
          if (index >= 0) this.transferQueue.splice(index, 1);
          signal.removeEventListener('abort', token.abort);
          reject(assetAbort());
        },
      };
      if (this.activeTransfers < 4) token.start();
      else {
        this.transferQueue.push(token);
        signal.addEventListener('abort', token.abort, { once: true });
        if (signal.aborted) token.abort();
      }
    });
    try {
      cancelled(signal);
      this.requests++;
      return await this.options.fetchBytes(url, signal, maxBytes);
    } finally {
      this.activeTransfers--;
      this.transferQueue.shift()?.start();
    }
  }
  private async read(asset: AssetEntry, signal: AbortSignal) {
    cancelled(signal);
    const key = asset.sha256,
      hot = await this.memory.get(key);
    cancelled(signal);
    if (hot) {
      this.hits++;
      return hot;
    }
    if (asset.bytes > (this.options.maxAssetBytes ?? 16 * 1024 * 1024))
      throw new Error('Asset exceeds transfer budget');
    if (this.options.persistent) {
      let cached: Uint8Array | null = null;
      try {
        cached = await this.options.persistent.get(key);
      } catch {
        this.storageFailures++;
      }
      cancelled(signal);
      if (cached) {
        if (await this.valid(cached, asset)) {
          cancelled(signal);
          this.hits++;
          await this.memory.put(key, cached);
          return cached;
        }
        this.corrupt++;
        try {
          await this.options.persistent.remove(key);
        } catch {
          this.storageFailures++;
        }
      }
    }
    const local = asset.path!,
      paths = [
        ...(this.options.remoteBase ? [new URL(local.slice(1), this.options.remoteBase).href] : []),
        local,
        local,
      ];
    for (const url of paths) {
      cancelled(signal);
      try {
        const bytes = await this.transfer(url, signal, asset.bytes);
        cancelled(signal);
        if (!(await this.valid(bytes, asset))) continue;
        cancelled(signal);
        await this.memory.put(key, bytes);
        if (this.options.persistent) {
          try {
            await this.options.persistent.put(key, bytes);
          } catch {
            this.storageFailures++;
          }
        }
        cancelled(signal);
        return bytes;
      } catch {
        cancelled(signal);
      }
    }
    throw new Error('Verified asset unavailable');
  }
  async load(idOrPath: string, signal: AbortSignal, quality: 'low' | 'high' = 'high') {
    cancelled(signal);
    const asset = this.resolve(idOrPath, quality),
      key = asset.sha256;
    let flight = this.flights.get(key);
    if (!flight || flight.controller.signal.aborted) {
      const current: Flight = {
        controller: new AbortController(),
        promise: Promise.resolve(new Uint8Array()),
        waiters: 0,
        settled: false,
      };
      current.promise = this.read(asset, current.controller.signal).finally(() => {
        current.settled = true;
        if (this.flights.get(key) === current) this.flights.delete(key);
      });
      this.flights.set(key, current);
      flight = current;
    }
    const current = flight;
    current.waiters++;
    return new Promise<Uint8Array>((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return false;
        done = true;
        signal.removeEventListener('abort', abort);
        current.waiters--;
        if (!current.waiters && !current.settled) current.controller.abort();
        return true;
      };
      const abort = () => {
        if (finish()) reject(assetAbort());
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      current.promise.then(
        (bytes) => {
          if (finish()) resolve(bytes.slice());
        },
        (error) => {
          if (finish()) reject(error);
        },
      );
    });
  }
}
export class AssetScene {
  private readonly controller = new AbortController();
  constructor(readonly manager: AssetManager) {}
  get signal() {
    return this.controller.signal;
  }
  load(idOrPath: string, signal?: AbortSignal, quality: 'low' | 'high' = 'high') {
    return this.manager.load(idOrPath, signal ? AbortSignal.any([this.signal, signal]) : this.signal, quality);
  }
  async preload(ids: readonly string[], quality: 'low' | 'high' = 'high') {
    const queue = [...new Set(ids)],
      loaded = new Map<string, Uint8Array>(),
      failed: string[] = [];
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (;;) {
          const id = queue.shift();
          if (!id) return;
          try {
            loaded.set(id, await this.load(id, undefined, quality));
          } catch {
            cancelled(this.signal);
            failed.push(id);
          }
        }
      }),
    );
    return { loaded, failed };
  }
  dispose() {
    this.controller.abort();
  }
}
