import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { Client, type Room } from 'colyseus.js';
import { createGameServer } from '../server/app';
import { MatchRoom } from '../server/rooms/MatchRoom';
import { createRoomStore } from '../server/roomStore';
import { DEFAULT_DATA } from '../shared/data';
import {
  PROTOCOL_VERSION,
  ROOM_NAME,
  S2C,
  type RoomSnapshot,
  type MatchStartMsg,
  type ResumeMsg,
  type UpdateMsg,
} from '../shared/protocol';
import { rulesForMode, verifyModeRules } from '../config/modes';
import { ModeOutcomeSchema } from '../packages/contracts/src/modes';
import { OnlineHost } from '../client/src/onlineHost';

async function until<T>(read: () => T | undefined | null | false): Promise<T> {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const result = read();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out awaiting mode state');
}
function watch(room: Room) {
  const messages: { type: string; body: unknown }[] = [];
  room.onMessage('*', (type, body) => messages.push({ type: String(type), body }));
  room.onError(() => undefined);
  return { room, read: <T>(type: string) => messages.filter((m) => m.type === type).at(-1)?.body as T | undefined };
}

test('friend rooms broadcast identical frozen rules, normalize levels, persist them and never grant guest rewards', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'allstars-mode-'));
  const store = createRoomStore(dir),
    server = createGameServer({ roomStore: store });
  const opened: Room[] = [];
  try {
    await server.gameServer.listen(0);
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    const sdk = new Client(`ws://127.0.0.1:${address.port}`);
    const opts = { protocol: PROTOCOL_VERSION, nickname: 'friend', mode: 'friend' };
    for (const mode of ['ranked', 'growth', 'unknown'])
      await expect(sdk.create(ROOM_NAME, { ...opts, mode })).rejects.toThrow('bad-message');
    const a = watch(await sdk.create(ROOM_NAME, opts));
    opened.push(a.room);
    const first = await until(() => a.read<RoomSnapshot>(S2C.room));
    expect(verifyModeRules(DEFAULT_DATA, first.rules)).toEqual(rulesForMode(DEFAULT_DATA, 'friend'));
    const b = watch(await sdk.joinById(first.code, { ...opts, nickname: 'other', mode: 'practice' }));
    opened.push(b.room);
    const second = await until(() => b.read<RoomSnapshot>(S2C.room));
    expect(second.rules).toEqual(first.rules);
    const lineup = DEFAULT_DATA.rules.defaultLineup;
    for (const peer of [a, b]) peer.room.send('set_lineup', { lineup, levels: [1, 2, 3, 4, 10] });
    await until(() => a.read<RoomSnapshot>(S2C.room)?.seats.every((s) => s?.levels.every((l) => l === 5)));
    for (const peer of [a, b]) peer.room.send('ready', { ready: true });
    const startA = await until(() => a.read<MatchStartMsg>(S2C.matchStart));
    const startB = await until(() => b.read<MatchStartMsg>(S2C.matchStart));
    expect(startA.rules).toEqual(startB.rules);
    expect(startA.state.pieces.map((p) => p.level)).toEqual(Array(10).fill(5));
    expect(store.loadAll(DEFAULT_DATA.version)[0].modeRules).toEqual(first.rules);
    b.room.send('surrender', {});
    const result = await until(() => a.read<UpdateMsg>(S2C.update));
    expect(ModeOutcomeSchema.parse(result.outcome)).toMatchObject({
      mode: 'friend',
      verdict: 'untrusted',
      winner: 0,
      ratingScope: null,
      rewardScope: null,
    });
  } finally {
    await Promise.all(opened.filter((r) => r.connection?.isOpen).map((r) => r.leave(true)));
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);

test('restoring a room keeps the mode and levels and rejects altered stored rules', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'allstars-mode-restore-'));
  const store = createRoomStore(dir);
  let server = createGameServer({ roomStore: store });
  const opened: Room[] = [];
  try {
    await server.gameServer.listen(0);
    let address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    let sdk = new Client(`ws://127.0.0.1:${address.port}`);
    const opts = { protocol: PROTOCOL_VERSION, nickname: 'restored', mode: 'friend' };
    const a = watch(await sdk.create(ROOM_NAME, opts));
    opened.push(a.room);
    const snap = await until(() => a.read<RoomSnapshot>(S2C.room));
    const b = watch(await sdk.joinById(snap.code, opts));
    opened.push(b.room);
    a.room.send('ready', { ready: true });
    b.room.send('ready', { ready: true });
    await until(() => a.read<MatchStartMsg>(S2C.matchStart));
    const record = structuredClone(store.loadAll(DEFAULT_DATA.version)[0]);
    await Promise.all(opened.filter((r) => r.connection?.isOpen).map((r) => r.leave(false)));
    await server.close();
    server = createGameServer({ roomStore: store });
    await server.gameServer.listen(0);
    address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    sdk = new Client(`ws://127.0.0.1:${address.port}`);
    const bad = structuredClone(record);
    bad.modeRules!.fixedLevel = 10;
    await expect(MatchRoom.restore(bad)).rejects.toThrow();
    const changedLevels = structuredClone(record);
    changedLevels.seats[0].levels[0] = 10;
    await expect(MatchRoom.restore(changedLevels)).rejects.toThrow();
    await MatchRoom.restore(record);
    const rejoined = watch(await sdk.joinById(record.code, { ...opts, seatToken: snap.seatToken }));
    opened.push(rejoined.room);
    const resume = await until(() => rejoined.read<ResumeMsg>(S2C.resume));
    expect(resume.rules).toEqual(snap.rules);
    expect(resume.state.pieces.map((p) => p.level)).toEqual(Array(10).fill(5));
  } finally {
    await Promise.all(opened.filter((r) => r.connection?.isOpen).map((r) => r.leave(true)));
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);

test('the real OnlineHost receives the same mode DTO and replays its initial snapshot to a late lobby listener', async () => {
  const server = createGameServer();
  let host: OnlineHost | null = null;
  let guest: OnlineHost | null = null;
  try {
    await server.gameServer.listen(0);
    const addr = server.httpServer.address();
    if (!addr || typeof addr === 'string') throw new Error('No port');
    host = new OnlineHost({ serverUrl: `ws://127.0.0.1:${addr.port}`, nickname: 'host-test' });
    await host.connect();
    await until(() => host?.rules);
    let snap: RoomSnapshot | undefined;
    host.onRoomSnapshot((value) => {
      snap = value;
    });
    expect(snap!.rules).toEqual(rulesForMode(DEFAULT_DATA, 'friend'));
    expect(host.rules).toEqual(snap!.rules);
    guest = new OnlineHost({ serverUrl: `ws://127.0.0.1:${addr.port}`, nickname: 'guest-test', code: host.code });
    await guest.connect();
    await until(() => guest?.rules);
    expect(guest.rules).toEqual(host.rules);
    expect(guest.mySides).toEqual([1]);
    expect(guest.viewSide).toBe(1);
  } finally {
    guest?.dispose();
    host?.dispose();
    await server.close();
  }
}, 15000);
