import { expect, test } from 'vitest';
import { z } from 'zod';
import { Client, type Room } from 'colyseus.js';
import { canonicalJson, freezeSnapshot } from '@pengzhuang/game-core';
import { ResourceManifestSchema } from '@pengzhuang/contracts';
import { VersionedRegistry, makeConfigPackage } from '../config/versioned';
import { createBundledGameConfiguration } from '../config/game';
import { DEFAULT_DATA } from '../shared/data';
import { ROOM_NAME, PROTOCOL_VERSION, type RoomSnapshot } from '../shared/protocol';
import { MatchRoom } from '../server/rooms/MatchRoom';
import { createGameServer } from '../server/app';

test('canonical finite JSON and immutable snapshots reject aliasing and unsafe values', () => {
  expect(canonicalJson({ b: 1, a: [2] })).toBe(canonicalJson({ a: [2], b: 1 }));
  const original = { rows: [{ value: 1 }] };
  const frozen = freezeSnapshot(original);
  original.rows[0].value = 2;
  expect(frozen.rows[0].value).toBe(1);
  expect(() => {
    frozen.rows[0].value = 3;
  }).toThrow();
  expect(freezeSnapshot(frozen)).toBe(frozen);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const value of [cyclic, NaN, Infinity, new Date(), undefined]) expect(() => canonicalJson(value)).toThrow();
  const array = [1];
  Object.defineProperty(array, '0', {
    get() {
      throw new Error('getter executed');
    },
  });
  expect(() => canonicalJson(array)).toThrow('accessors');
});
test('configuration packages enforce hash, schema, compatibility and immutable versions', () => {
  const schema = z.strictObject({ goals: z.number().int().positive() });
  const registry = new VersionedRegistry(schema);
  const pack = makeConfigPackage('one', { goals: 3 });
  registry.register(pack);
  registry.activate('one');
  const old = registry.get();
  pack.payload.goals = 9;
  expect(old.goals).toBe(3);
  expect(() => registry.register(pack)).toThrow('hash');
  expect(() => registry.register(makeConfigPackage('one', { goals: 4 }))).toThrow('conflict');
  expect(() => registry.register(makeConfigPackage('bad', { goals: -1 }))).toThrow();
  expect(() => registry.register({ ...makeConfigPackage('bad', { goals: 3 }), schemaVersion: 2 })).toThrow();
  expect(() => registry.register(makeConfigPackage('future', { goals: 3 }, 2, 2))).toThrow('incompatible');
  registry.register(makeConfigPackage('two', { goals: 4 }));
  registry.activate('two');
  expect(registry.get().goals).toBe(4);
  expect(registry.get('one')).toBe(old);
  registry.activate('one');
  expect(registry.get()).toBe(old);
  expect(() => registry.get('missing')).toThrow('unavailable');
});
test('resource manifests require stable ids, hashes and safe paths', () => {
  const asset = { id: 'field-1', path: '/assets/fields/a.webp', bytes: 12, sha256: 'a'.repeat(64) };
  expect(ResourceManifestSchema.safeParse({ schemaVersion: 1, version: 'assets-1', assets: [asset] }).success).toBe(
    true,
  );
  for (const assets of [
    [asset, asset],
    [{ ...asset, path: '/assets/../secret' }],
    [{ ...asset, sha256: 'wrong' }],
    [{ ...asset, bytes: -1 }],
  ])
    expect(ResourceManifestSchema.safeParse({ schemaVersion: 1, version: 'assets-1', assets }).success).toBe(false);
});
test('real rooms keep old configuration while newly created rooms take the activated version', async () => {
  const config = createBundledGameConfiguration();
  const restore = MatchRoom.useDataProvider(config.resolveData);
  const { gameServer, httpServer } = createGameServer();
  const clients: Room[] = [];
  try {
    await gameServer.listen(0);
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    const client = new Client(`ws://127.0.0.1:${address.port}`);
    const read = (room: Room) => new Promise<RoomSnapshot>((resolve) => room.onMessage('room', resolve));
    const first = await client.create(ROOM_NAME, { protocol: PROTOCOL_VERSION, nickname: 'one' });
    clients.push(first);
    const before = await read(first);
    const next = { ...DEFAULT_DATA.physics, version: 'phys-next' };
    config.registry.register(makeConfigPackage(next.version, next));
    config.registry.activate(next.version);
    const second = await client.create(ROOM_NAME, { protocol: PROTOCOL_VERSION, nickname: 'two' });
    clients.push(second);
    expect((await read(second)).configVersion).not.toBe(before.configVersion);
    const again = read(first);
    first.send('ready', { ready: true });
    expect((await again).configVersion).toBe(before.configVersion);
    expect(config.resolveData(before.configVersion).physics.version).toBe(DEFAULT_DATA.physics.version);
    expect(() => config.resolveData('field-old/missing/players')).toThrow();
  } finally {
    await Promise.all(clients.map((room) => room.leave(true)));
    await gameServer.gracefullyShutdown(false);
    restore();
  }
}, 15000);
