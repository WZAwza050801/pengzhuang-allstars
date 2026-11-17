import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import type { AssetCatalog } from '../packages/contracts/src/assets';
import { AssetManager, MemoryByteCache } from '../packages/platform/src/assets';
const bytes = new TextEncoder().encode('verified image bytes');
const digest = (value: Uint8Array) => Promise.resolve(createHash('sha256').update(value).digest('hex'));
test('a scene loading many distinct files never exceeds four parallel transfers', async () => {
  const catalog = await fixture(),
    data = new Map<string, Uint8Array>();
  catalog.aliases = [];
  catalog.assets = await Promise.all(
    Array.from({ length: 8 }, async (_, i) => {
      const value = new TextEncoder().encode(`file ${i}`),
        path = `/assets/file-${i}.png`;
      data.set(path, value);
      return { ...catalog.assets[0], id: `file-${i}`, path, sha256: await digest(value), bytes: value.length };
    }),
  );
  let active = 0,
    peak = 0;
  const manager = new AssetManager(catalog, {
      digest,
      fetchBytes: async (url) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return data.get(url)!;
      },
    }),
    scene = manager.scene();
  await Promise.all(catalog.assets.map((a) => scene.load(a.id)));
  expect(peak).toBe(4);
  expect(manager.stats().activeTransfers).toBe(0);
  scene.dispose();
});
async function fixture() {
  const sha256 = await digest(bytes);
  return {
    schemaVersion: 1,
    version: 'assets-test',
    minProtocol: 1,
    maxProtocol: 1,
    assets: [
      {
        id: 'face',
        kind: 'image',
        path: '/assets/face.png',
        bytes: bytes.length,
        sha256,
        width: 8,
        height: 8,
        anchors: {},
        category: 'test',
        priority: 'match',
        source: { kind: 'rebuilt', evidence: 'test fixture' },
        rights: 'unverified',
        releaseAllowed: false,
        rightsEvidence: null,
        geometryVersion: null,
      },
    ],
    aliases: [{ id: 'player.face', target: 'face', usage: 'portrait' }],
  } satisfies AssetCatalog;
}
test('two scenes share one fetch; cancelling one does not cancel the remaining owner', async () => {
  let resolve!: (value: Uint8Array) => void,
    calls = 0;
  const manager = new AssetManager(await fixture(), {
    digest,
    fetchBytes: async (_url, signal) => {
      calls++;
      return new Promise((done, reject) => {
        resolve = done;
        signal.addEventListener('abort', () => reject(new Error('transport aborted')));
      });
    },
  });
  const a = manager.scene(),
    b = manager.scene(),
    first = a.load('face').catch((e) => e.name),
    second = b.load('player.face');
  await new Promise((r) => setTimeout(r, 0));
  a.dispose();
  resolve(bytes);
  expect(await first).toBe('AbortError');
  expect(await second).toEqual(bytes);
  expect(calls).toBe(1);
  b.dispose();
  expect(manager.stats().inFlight).toBe(0);
});
test('corrupt cache is evicted/refetched, old hashes are isolated, storage failure still permits a valid response', async () => {
  const catalog = await fixture(),
    cache = new MemoryByteCache(64);
  await cache.put(catalog.assets[0].sha256, new Uint8Array([1]));
  let calls = 0;
  const manager = new AssetManager(catalog, {
      digest,
      persistent: cache,
      fetchBytes: async () => {
        calls++;
        return bytes;
      },
    }),
    scene = manager.scene();
  expect(await scene.load('face')).toEqual(bytes);
  expect(calls).toBe(1);
  expect(manager.stats().corruptCache).toBe(1);
  const changed = structuredClone(catalog);
  const next = new TextEncoder().encode('version two');
  changed.assets[0].sha256 = await digest(next);
  changed.assets[0].bytes = next.length;
  const updated = new AssetManager(changed, { digest, persistent: cache, fetchBytes: async () => next });
  expect(await updated.scene().load('face')).toEqual(next);
  const unavailable = {
    get: async () => {
      throw new Error('blocked');
    },
    put: async () => {
      throw new Error('quota');
    },
    remove: async () => {
      throw new Error('blocked');
    },
  };
  expect(
    await new AssetManager(catalog, { digest, persistent: unavailable, fetchBytes: async () => bytes })
      .scene()
      .load('face'),
  ).toEqual(bytes);
});
test('remote corruption falls back locally, byte caches are bounded, all-owner cancellation rejects late responses', async () => {
  const urls: string[] = [],
    catalog = await fixture();
  const manager = new AssetManager(catalog, {
    digest,
    remoteBase: 'https://assets.example.test/game/',
    memoryBytes: 8,
    fetchBytes: async (url) => {
      urls.push(url);
      return url.startsWith('https:') ? new Uint8Array([0]) : bytes;
    },
  });
  expect(await manager.scene().load('face')).toEqual(bytes);
  expect(urls).toEqual(['https://assets.example.test/game/assets/face.png', '/assets/face.png']);
  expect(manager.stats().memoryBytes).toBeLessThanOrEqual(8);
  const cache = new MemoryByteCache(6);
  await cache.put('a', new Uint8Array(4));
  await cache.put('b', new Uint8Array(4));
  expect(await cache.get('a')).toBeNull();
  expect(await cache.get('b')).toHaveLength(4);
  let finish!: (b: Uint8Array) => void;
  const slow = new AssetManager(catalog, {
      digest,
      fetchBytes: async () =>
        new Promise((r) => {
          finish = r;
        }),
    }),
    scene = slow.scene();
  const pending = scene.load('face').catch((e) => e.name);
  await new Promise((r) => setTimeout(r, 0));
  scene.dispose();
  finish(bytes);
  expect(await pending).toBe('AbortError');
  await new Promise((r) => setTimeout(r, 0));
  expect(slow.stats().memoryBytes).toBe(0);
});
