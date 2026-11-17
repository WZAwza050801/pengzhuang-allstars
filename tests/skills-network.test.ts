import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { Client, type Room } from 'colyseus.js';
import { createGameServer } from '../server/app';
import { createRoomStore } from '../server/roomStore';
import { DEFAULT_DATA } from '../shared/data';
import { PROTOCOL_VERSION, ROOM_NAME, S2C, type RoomSnapshot, type ResumeMsg } from '../shared/protocol';
async function until<T>(read: () => T | null | undefined | false, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = read();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out awaiting room state');
}
function watch(room: Room) {
  const messages: { type: string; body: unknown }[] = [];
  room.onMessage('*', (type, body) => {
    messages.push({ type: String(type), body });
  });
  room.onError(() => undefined);
  return {
    room,
    messages,
    snapshot: () => messages.filter((m) => m.type === S2C.room).at(-1)?.body as RoomSnapshot | undefined,
  };
}
test('real SDK disconnect/reclaim keeps persisted RNG and skill flags; resume exposes no authoritative RNG', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'allstars-skill-resume-'));
  const store = createRoomStore(dir),
    server = createGameServer({ roomStore: store, resolveData: () => DEFAULT_DATA });
  const opened: Room[] = [];
  try {
    await server.gameServer.listen(0);
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    const sdk = new Client(`ws://127.0.0.1:${address.port}`),
      options = { protocol: PROTOCOL_VERSION, nickname: 'skill-test' };
    const first = watch(await sdk.create(ROOM_NAME, options));
    opened.push(first.room);
    const seat = await until(first.snapshot),
      token = seat.seatToken!;
    const second = watch(await sdk.joinById(seat.code, { ...options, nickname: 'opponent' }));
    opened.push(second.room);
    await until(() => first.snapshot()?.seats[1]);
    first.room.send('ready', { ready: true });
    second.room.send('ready', { ready: true });
    await until(() => first.messages.find((m) => m.type === S2C.matchStart));
    const before = structuredClone((await until(() => store.loadAll(DEFAULT_DATA.version)[0])).match);
    await first.room.leave(false);
    await until(() => second.snapshot()?.seats[0]?.connected === false);
    const recovered = watch(await sdk.joinById(seat.code, { ...options, nickname: 'again', seatToken: token }));
    opened.push(recovered.room);
    const resume = (await until(() => recovered.messages.find((m) => m.type === S2C.resume))).body as ResumeMsg;
    const after = store.loadAll(DEFAULT_DATA.version)[0].match;
    expect(after).toEqual(before);
    expect(after.rng).toBe(before.rng);
    expect(resume.state.rng).toBe(0);
    expect(
      resume.state.pieces.map((p) => ({ id: p.id, ready: p.ready, anchored: p.anchored, frozen: p.frozen })),
    ).toEqual(before.pieces.map((p) => ({ id: p.id, ready: p.ready, anchored: p.anchored, frozen: p.frozen })));
    expect(recovered.messages.filter((m) => m.type === S2C.matchStart)).toHaveLength(0);
  } finally {
    await Promise.all(opened.filter((r) => r.connection?.isOpen).map((r) => r.leave(true)));
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
