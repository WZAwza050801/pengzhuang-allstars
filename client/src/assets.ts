import { AssetCatalogSchema } from '../../packages/contracts/src/assets';
import { AssetManager, assetAbort, type ByteCache } from '../../packages/platform/src/assets';
export { AssetManager } from '../../packages/platform/src/assets';
export const ASSET_CACHE_NAME = 'pz-verified-assets-v1';
/** Only this named cache is touched. Writes are serialized so concurrent scenes obey the byte budget. */
export class BrowserByteCache implements ByteCache {
  private serial: Promise<unknown> = Promise.resolve();
  constructor(readonly limit = 32 * 1024 * 1024) {}
  private run<T>(fn: () => Promise<T>) {
    const next = this.serial.then(fn);
    this.serial = next.catch(() => undefined);
    return next;
  }
  private key(hash: string) {
    return new URL(`/__asset_bytes/${hash}`, location.origin).href;
  }
  get(hash: string) {
    return this.run(async () => {
      const cache = await caches.open(ASSET_CACHE_NAME),
        key = this.key(hash),
        value = await cache.match(key);
      if (!value) return null;
      return new Uint8Array(await value.arrayBuffer());
    });
  }
  put(hash: string, bytes: Uint8Array) {
    return this.run(async () => {
      const cache = await caches.open(ASSET_CACHE_NAME),
        key = this.key(hash);
      await cache.delete(key);
      if (bytes.length > this.limit) return;
      await cache.put(
        key,
        new Response(new Uint8Array(bytes).buffer, { headers: { 'x-pz-bytes': String(bytes.length) } }),
      );
      const keys = await cache.keys(),
        sizes = [];
      let total = 0;
      for (const request of keys) {
        const response = await cache.match(request),
          size = Number(response?.headers.get('x-pz-bytes'));
        if (!Number.isSafeInteger(size) || size <= 0) {
          await cache.delete(request);
          continue;
        }
        sizes.push({ request, size });
        total += size;
      }
      for (const item of sizes) {
        if (total <= this.limit) break;
        await cache.delete(item.request);
        total -= item.size;
      }
    });
  }
  remove(hash: string) {
    return this.run(async () => {
      await (await caches.open(ASSET_CACHE_NAME)).delete(this.key(hash));
    });
  }
}
export async function fetchAssetBytes(url: string, signal: AbortSignal, maxBytes: number) {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok || Number(response.headers.get('content-length')) > maxBytes)
    throw new Error('Asset transfer unavailable');
  const reader = response.body?.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error('Asset transfer too large');
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export async function assetDigest(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
let shared: Promise<AssetManager> | null = null;
export function webAssetManager() {
  if (!shared)
    shared = (async () => {
      const bytes = await fetchAssetBytes('/assets/catalog.json', new AbortController().signal, 1024 * 1024);
      const catalog = AssetCatalogSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
      return new AssetManager(catalog, {
        fetchBytes: fetchAssetBytes,
        digest: assetDigest,
        persistent: new BrowserByteCache(),
      });
    })().catch((error) => {
      shared = null;
      throw error;
    });
  return shared;
}
interface ImageRecord {
  source: string;
  controller: AbortController;
  promise: Promise<void>;
  url: string | null;
  bytes: number;
  active: boolean;
  variant: string | null;
}
export class WebAssetScene {
  private readonly images = new Map<HTMLImageElement, ImageRecord>();
  private disposed = false;
  private bytes = 0;
  private failures = 0;
  private manager: AssetManager | null = null;
  private readonly ready: Promise<ReturnType<AssetManager['scene']>>;
  constructor(
    manager: Promise<AssetManager> = webAssetManager(),
    readonly limit = 64 * 1024 * 1024,
  ) {
    this.ready = manager.then((value) => {
      this.manager = value;
      const scene = value.scene();
      if (this.disposed) scene.dispose();
      return scene;
    });
    void this.ready.catch(() => undefined);
  }
  bind(source: string, image: HTMLImageElement = new Image(), quality: 'low' | 'high' = 'high') {
    if (this.disposed) throw assetAbort();
    this.release(image);
    if (this.images.size >= 64) throw new Error('Image scene count exceeded');
    const record: ImageRecord = {
      source,
      controller: new AbortController(),
      promise: Promise.resolve(),
      url: null,
      bytes: 0,
      active: true,
      variant: null,
    };
    this.images.set(image, record);
    record.promise = (async () => {
      const scene = await this.ready;
      if (!record.active || this.disposed) throw assetAbort();
      const entry = scene.manager.resolve(source, quality);
      record.variant = entry.path;
      if (entry.kind !== 'image' || !entry.width || !entry.height || this.images.size > 64)
        throw new Error('Image scene budget exceeded');
      const bytes = await scene.load(source, record.controller.signal, quality);
      if (!record.active || this.disposed) throw assetAbort();
      const cost = entry.width * entry.height * 4;
      if (this.bytes + cost > this.limit) throw new Error('Decoded image budget exceeded');
      this.bytes += cost;
      record.bytes = cost;
      record.url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer]));
      image.src = record.url;
      await image.decode();
      if (!record.active || this.disposed) throw assetAbort();
      if (image.naturalWidth !== entry.width || image.naturalHeight !== entry.height)
        throw new Error('Decoded dimensions differ');
    })()
      .catch((error) => {
        if (record.active) {
          this.failures++;
          image.removeAttribute('src');
          this.bytes -= record.bytes;
          record.bytes = 0;
        }
        throw error;
      })
      .finally(() => {
        if (record.url) {
          URL.revokeObjectURL(record.url);
          record.url = null;
        }
      });
    void record.promise.catch(() => undefined);
    return image;
  }
  wait(image: HTMLImageElement) {
    return this.images.get(image)?.promise ?? Promise.reject(new Error('Image not owned by scene'));
  }
  async data(id: string): Promise<unknown> {
    const scene = await this.ready;
    if (this.disposed) throw assetAbort();
    if (scene.manager.resolve(id).kind !== 'data') throw new Error('Expected JSON data asset');
    const bytes = await scene.load(id);
    if (this.disposed) throw assetAbort();
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  source(image: HTMLImageElement) {
    return this.images.get(image)?.source ?? '';
  }
  release(image: HTMLImageElement) {
    const record = this.images.get(image);
    if (!record) return;
    record.active = false;
    record.controller.abort();
    if (record.url) URL.revokeObjectURL(record.url);
    record.url = null;
    this.bytes -= record.bytes;
    record.bytes = 0;
    image.removeAttribute('src');
    this.images.delete(image);
  }
  stats() {
    return {
      images: this.images.size,
      decodedBytes: this.bytes,
      decodedLimit: this.limit,
      failures: this.failures,
      disposed: this.disposed,
      lowVariants: [...this.images.values()].filter((r) => r.variant?.includes('/low/')).length,
      cache: this.manager?.stats() ?? null,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const image of this.images.keys()) this.release(image);
    void this.ready.then((scene) => scene.dispose()).catch(() => undefined);
  }
}
