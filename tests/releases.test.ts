import { expect, test } from 'vitest';
import { z } from 'zod';
import { VersionedRegistry, makeConfigPackage, diffConfiguration } from '../config/versioned';
import { createBundledGameConfiguration } from '../config/game';
import { DEFAULT_DATA } from '../shared/data';
import { createMatch, beginTurn, resolveShot } from '../shared/match';
import { fallbackShot } from '../shared/ai';
import { canonicalJson } from '../packages/game-core/src/snapshot';
import archive from '../config/physics-archive/phys-4.json';
import { MODE_POLICY, rulesForMode } from '../config/modes';
import modeArchive from '../config/mode-archive/modes-1.json';
import { Client, type Room } from 'colyseus.js';
import { createGameServer } from '../server/app';
import {
  PROTOCOL_VERSION,
  ROOM_NAME,
  type RoomSnapshot,
  type MatchStartMsg,
  type ShotPacketMsg,
} from '../shared/protocol';

test('canary assignment is stable, bounded, opt-in and rollback clears it without changing old snapshots', () => {
  const registry = new VersionedRegistry(z.strictObject({ value: z.number() }));
  registry.register(makeConfigPackage('old', { value: 1 }));
  registry.register(makeConfigPackage('candidate', { value: 2 }));
  registry.activate('old');
  const old = registry.get();
  for (const percent of [-1, 101, NaN, 0.5]) expect(() => registry.rollout('candidate', percent)).toThrow();
  registry.rollout('candidate', 25);
  const assignment = Array.from({ length: 1000 }, (_, i) => registry.forNewSession(`server-match-${i}`).value);
  expect(assignment).toEqual(Array.from({ length: 1000 }, (_, i) => registry.forNewSession(`server-match-${i}`).value));
  expect(assignment.filter((v) => v === 2).length).toBeGreaterThan(180);
  expect(assignment.filter((v) => v === 2).length).toBeLessThan(320);
  expect(registry.get()).toBe(old);
  expect(() => registry.disable('old')).toThrow();
  registry.activate('old');
  expect(Array.from({ length: 100 }, (_, i) => registry.forNewSession(String(i)).value)).toEqual(Array(100).fill(1));
  registry.disable('candidate');
  expect(() => registry.rollout('candidate', 100)).toThrow();
  expect(() => registry.activate('candidate')).toThrow();
  expect(registry.get('candidate').value).toBe(2);
  expect(old.value).toBe(1);
});

test('configuration diff records precise added/removed/changed paths without mutating either package', () => {
  const before = { physics: { vmax: 9 }, skills: ['one'] };
  const after = { physics: { vmax: 10 }, enabled: true };
  expect(diffConfiguration(before, after)).toEqual([
    { path: '/enabled', before: undefined, after: true },
    { path: '/physics/vmax', before: 9, after: 10 },
    { path: '/skills', before: ['one'], after: undefined },
  ]);
  expect(before.physics.vmax).toBe(9);
});

test('baseline physics and mode archives are loaded, hash verified and cannot be silently replaced', () => {
  const config = createBundledGameConfiguration();
  expect(config.resolveData().physics).toEqual(archive.payload);
  expect(modeArchive).toEqual(MODE_POLICY);
  expect(rulesForMode(DEFAULT_DATA, 'friend', modeArchive.version).fixedLevel).toBe(5);
  expect(() => rulesForMode(DEFAULT_DATA, 'friend', 'modes-unavailable')).toThrow('archive');
  const changed = structuredClone(archive);
  changed.payload.shot.vmax *= 1.1;
  expect(() => config.registry.register(changed)).toThrow('hash');
  expect(() => config.registry.register(makeConfigPackage(archive.version, changed.payload))).toThrow('conflict');
});

test('new session canary and rollback retain the exact old physics replay and data snapshot', () => {
  const config = createBundledGameConfiguration();
  const oldData = config.resolveData();
  const lineup = DEFAULT_DATA.rules.defaultLineup;
  const state = createMatch(oldData, [lineup, lineup], { seed: 42 });
  beginTurn(state, oldData);
  const input = fallbackShot(state, oldData)!;
  const before = resolveShot(structuredClone(state), oldData, input);
  const candidate = { ...DEFAULT_DATA.physics, version: 'phys-canary' };
  config.registry.register(makeConfigPackage(candidate.version, candidate));
  config.registry.rollout(candidate.version, 100);
  expect(config.resolveData(undefined, 'server-generated-cohort').physics.version).toBe(candidate.version);
  expect(config.resolveData(oldData.version)).toBe(oldData);
  config.registry.activate(DEFAULT_DATA.physics.version);
  config.registry.disable(candidate.version);
  expect(config.resolveData(undefined, 'server-generated-cohort')).toBe(oldData);
  expect(canonicalJson(resolveShot(structuredClone(state), config.resolveData(oldData.version), input))).toBe(
    canonicalJson(before),
  );
  expect(config.resolveData(oldData.version).physics).toBe(oldData.physics);
});

test('real new rooms use the server canary while a playing room and rollback keep the original version', async () => {
  const configuration = createBundledGameConfiguration();
  const server = createGameServer({ resolveData: configuration.resolveData });
  const clients: Room[] = [];
  const read = <T>(room: Room, type: string) => new Promise<T>((resolve) => room.onMessage(type, resolve));
  try {
    await server.gameServer.listen(0);
    const addr = server.httpServer.address();
    if (!addr || typeof addr === 'string') throw new Error('No port');
    const sdk = new Client(`ws://127.0.0.1:${addr.port}`),
      opts = { protocol: PROTOCOL_VERSION, nickname: 'rollout-test' };
    const a = await sdk.create(ROOM_NAME, opts);
    clients.push(a);
    const old = await read<RoomSnapshot>(a, 'room');
    const b = await sdk.joinById(old.code, opts);
    clients.push(b);
    await read<RoomSnapshot>(b, 'room');
    const started = read<MatchStartMsg>(a, 'match_start');
    a.send('ready', { ready: true });
    b.send('ready', { ready: true });
    const match = await started;
    const candidate = { ...DEFAULT_DATA.physics, version: 'phys-room-canary' };
    configuration.registry.register(makeConfigPackage(candidate.version, candidate));
    configuration.registry.rollout(candidate.version, 100);
    const next = await sdk.create(ROOM_NAME, opts);
    clients.push(next);
    expect((await read<RoomSnapshot>(next, 'room')).configVersion).toContain(candidate.version);
    const packet = read<ShotPacketMsg>(a, 'shot_packet');
    const piece = match.state.pieces.find((p) => p.side === match.state.turn && !p.out && !p.frozen)!;
    clients[match.state.turn].send('shot', {
      matchId: match.matchId,
      configVersion: match.configVersion,
      turnId: 0,
      clientShotId: 'old-after-canary',
      input: { pieceId: piece.id, dirX: 1, dirY: 0, power: 0.06, curve: 0 },
    });
    expect((await packet).state.dataVersion).toBe(old.configVersion);
    configuration.registry.activate(DEFAULT_DATA.physics.version);
    configuration.registry.disable(candidate.version);
    const restored = await sdk.create(ROOM_NAME, opts);
    clients.push(restored);
    expect((await read<RoomSnapshot>(restored, 'room')).configVersion).toBe(old.configVersion);
  } finally {
    await Promise.all(clients.filter((room) => room.connection?.isOpen).map((room) => room.leave(true)));
    await server.close();
  }
}, 15000);
