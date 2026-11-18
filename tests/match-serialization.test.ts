import { expect, test, vi } from 'vitest';
import { Client, type Room } from 'colyseus.js';
import { matchMaker } from 'colyseus';
import { createGameServer, type GameServerOptions } from '../server/app';
import { MatchRoom, type MatchTiming } from '../server/rooms/MatchRoom';
import { isRoomRecord, type RoomRecord, type RoomStore } from '../server/roomStore';
import { resolveShot } from '../shared/match';
import {
  C2S,
  S2C,
  ROOM_NAME,
  PROTOCOL_VERSION,
  type MatchStartMsg,
  type ShotMsg,
  type ErrorMsg,
  type RoomSnapshot,
  type ShotPacketMsg,
  type UpdateMsg,
} from '../shared/protocol';

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until<T>(read: () => T | undefined | null | false): Promise<T> {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const result = read();
    if (result) return result;
    await pause(5);
  }
  throw new Error('Room message timeout');
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function watch(room: Room) {
  const messages: { type: string; data: unknown }[] = [];
  room.onMessage('*', (type, data) => messages.push({ type: String(type), data }));
  room.onError(() => undefined);
  return {
    room,
    messages,
    latest: <T>(type: string) => messages.filter((message) => message.type === type).at(-1)?.data as T | undefined,
  };
}
async function listen(options: GameServerOptions = {}) {
  const server = createGameServer({ clientDirectory: null, ...options });
  await server.gameServer.listen(0);
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  return { server, sdk: new Client(`ws://127.0.0.1:${address.port}`) };
}
async function playing(options: GameServerOptions = {}, timing: Partial<MatchTiming> = {}) {
  const restoreTiming = MatchRoom.useTiming({
    matchMs: 20000,
    turnMs: 10000,
    reconnectMs: 3000,
    playbackMarginMs: 0,
    ...timing,
  });
  const runtime = await listen(options);
  const a = watch(await runtime.sdk.create(ROOM_NAME, { protocol: PROTOCOL_VERSION, nickname: 'a' }));
  const b = watch(await runtime.sdk.joinById(a.room.roomId, { protocol: PROTOCOL_VERSION, nickname: 'b' }));
  const peers = [a, b];
  peers.forEach((peer) => peer.room.send(C2S.ready, { ready: true }));
  const start = await until(() => a.latest<MatchStartMsg>(S2C.matchStart));
  await until(() => b.latest<MatchStartMsg>(S2C.matchStart));
  const local = matchMaker.getLocalRoomById(a.room.roomId) as MatchRoom;
  const shot: ShotMsg = {
    matchId: start.matchId,
    configVersion: start.configVersion,
    turnId: start.state.shotNo,
    clientShotId: 'intent-1',
    input: {
      pieceId: start.state.pieces.find((piece) => piece.side === start.state.turn)!.id,
      dirX: 1,
      dirY: 0,
      power: 0.1,
      curve: 0,
    },
  };
  return {
    ...runtime,
    peers,
    local,
    start,
    shot,
    actor: peers[start.state.turn],
    close: async () => {
      await runtime.server.close();
      restoreTiming();
    },
  };
}
async function rejection(peer: ReturnType<typeof watch>, body: ShotMsg, code: string) {
  const from = peer.messages.length;
  peer.room.send(C2S.shot, body);
  const reply = await until(
    () => peer.messages.slice(from).find((message) => message.type === S2C.error)?.data as ErrorMsg | undefined,
  );
  expect(reply.code).toBe(code);
  return reply;
}

test('an admitted shot finishes before queued surrender; the expired old turn cannot overwrite the result', async () => {
  const held = gate();
  let entered = false;
  const game = await playing(
    {
      simulateShot: async (...args) => {
        entered = true;
        await held.promise;
        return resolveShot(...args);
      },
    },
    { turnMs: 90 },
  );
  try {
    game.actor.room.send(C2S.shot, game.shot);
    await until(() => entered);
    game.actor.room.send(C2S.surrender, {});
    await pause(120);
    expect(game.local.inspect().seq).toBe(0);
    held.release();
    const ended = await until(
      () => game.actor.latest<UpdateMsg>(S2C.update)?.state.over && game.actor.latest<UpdateMsg>(S2C.update),
    );
    expect(ended.state.endReason).toBe('surrender');
    expect(game.local.inspect()).toMatchObject({
      seq: 1,
      revision: 2,
      phase: 'ended',
      match: { shotNo: 1, over: true },
    });
    await pause(30);
    expect(game.actor.messages.filter((message) => message.type === S2C.update)).toHaveLength(1);
    expect((await rejection(game.actor, game.shot, 'duplicate-shot')).seq).toBe(1);
    await rejection(game.actor, { ...game.shot, input: { ...game.shot.input, power: 0.2 } }, 'shot-conflict');
  } finally {
    held.release();
    await game.close();
  }
});

test('a guessed next-turn shot queued against the old revision is refused and an old timeout is invalidated', async () => {
  const held = gate();
  let entered = false;
  const game = await playing(
    {
      simulateShot: async (...args) => {
        entered = true;
        await held.promise;
        return resolveShot(...args);
      },
    },
    { turnMs: 90 },
  );
  try {
    game.actor.room.send(C2S.shot, game.shot);
    await until(() => entered);
    const otherSide = game.start.state.turn === 0 ? 1 : 0,
      other = game.peers[otherSide];
    other.room.send(C2S.shot, {
      ...game.shot,
      turnId: 1,
      clientShotId: 'guessed-next',
      input: { ...game.shot.input, pieceId: game.start.state.pieces.find((piece) => piece.side === otherSide)!.id },
    });
    await pause(120);
    held.release();
    await until(() => game.actor.latest<ShotPacketMsg>(S2C.shotPacket));
    expect((await until(() => other.latest<ErrorMsg>(S2C.error))).code).toBe('stale-turn');
    await pause(30);
    expect(game.local.inspect()).toMatchObject({ seq: 1, revision: 1, match: { shotNo: 1 } });
    expect(game.actor.latest(S2C.update)).toBeUndefined();
  } finally {
    held.release();
    await game.close();
  }
});

test('the match clock queues behind a valid shot and ends after its playback without restoring old state', async () => {
  const held = gate();
  let entered = false;
  const game = await playing(
    {
      simulateShot: async (...args) => {
        entered = true;
        await held.promise;
        return resolveShot(...args);
      },
    },
    { matchMs: 90 },
  );
  try {
    game.actor.room.send(C2S.shot, game.shot);
    await until(() => entered);
    await pause(120);
    held.release();
    await until(() => game.actor.latest<ShotPacketMsg>(S2C.shotPacket));
    const ended = await until(
      () => game.actor.latest<UpdateMsg>(S2C.update)?.state.over && game.actor.latest<UpdateMsg>(S2C.update),
    );
    expect(ended.state.shotNo).toBe(1);
    expect(game.local.inspect()).toMatchObject({ seq: 1, revision: 2, phase: 'ended' });
  } finally {
    held.release();
    await game.close();
  }
});

test('failed or oversized simulation leaves the authoritative state and receipt untouched; the same intent can retry', async () => {
  let failure = 'throw';
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const game = await playing({
    simulateShot: (...args) => {
      const result = resolveShot(...args);
      if (failure === 'throw') throw new Error('private engine details');
      if (failure === 'frames') result.sim.frames = Array(1025).fill(result.sim.frames[0]);
      if (failure === 'bytes') result.sim.events = [{ padding: 'x'.repeat(512 * 1024) }] as never;
      if (failure === 'coords') result.sim.frames[0][0] = Infinity;
      return result;
    },
  });
  try {
    const original = game.local.inspect();
    for (const kind of ['throw', 'frames', 'bytes', 'coords']) {
      failure = kind;
      await rejection(game.actor, game.shot, kind === 'throw' ? 'internal-error' : 'simulation-limit');
      expect(game.local.inspect()).toEqual(original);
    }
    expect(logged.mock.calls.flat().join(' ')).not.toContain('private engine details');
    failure = 'none';
    game.actor.room.send(C2S.shot, game.shot);
    await until(() => game.actor.latest<ShotPacketMsg>(S2C.shotPacket));
    expect(game.local.inspect()).toMatchObject({ seq: 1, acceptedShots: 1, revision: 1 });
  } finally {
    logged.mockRestore();
    await game.close();
  }
});

test('an expired reconnect window cannot be bypassed while its adjudication waits behind simulation', async () => {
  const held = gate();
  let entered = false;
  const game = await playing(
    {
      simulateShot: async (...args) => {
        entered = true;
        await held.promise;
        return resolveShot(...args);
      },
    },
    { reconnectMs: 90 },
  );
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const otherSide = game.start.state.turn === 0 ? 1 : 0,
      other = game.peers[otherSide];
    const snapshot = await until(() => other.latest<RoomSnapshot>(S2C.room));
    game.actor.room.send(C2S.shot, game.shot);
    await until(() => entered);
    await other.room.leave(false);
    await until(() => game.actor.latest<RoomSnapshot>(S2C.room)?.seats[otherSide]?.connected === false);
    await pause(120);
    await expect(
      game.sdk.joinById(snapshot.code, { protocol: 1, nickname: 'late', seatToken: snapshot.seatToken }),
    ).rejects.toThrow('bad-seat-token');
    held.release();
    const ended = await until(
      () => game.actor.latest<UpdateMsg>(S2C.update)?.state.over && game.actor.latest<UpdateMsg>(S2C.update),
    );
    expect(ended.state.endReason).toBe('disconnect');
    expect(game.local.inspect()).toMatchObject({ seq: 1, revision: 2 });
  } finally {
    held.release();
    logged.mockRestore();
    await game.close();
  }
});

test('disposed rooms discard a delayed computation and all commands behind it', async () => {
  const held = gate();
  let entered = false,
    finished = false;
  const game = await playing({
    simulateShot: async (...args) => {
      entered = true;
      await held.promise;
      const out = resolveShot(...args);
      finished = true;
      return out;
    },
  });
  try {
    game.actor.room.send(C2S.shot, game.shot);
    await until(() => entered);
    game.actor.room.send(C2S.surrender, {});
    const before = game.local.inspect();
    await game.server.close();
    held.release();
    await until(() => finished);
    await pause(10);
    expect(game.local.inspect()).toEqual(before);
  } finally {
    held.release();
    await game.close();
  }
});

test('a delivery failure still persists the committed receipt, which survives a server restart', async () => {
  let saved: RoomRecord | undefined;
  const store: RoomStore = {
    dir: 'in-memory-test',
    save: (record) => {
      saved = structuredClone(record);
    },
    remove: () => {
      saved = undefined;
    },
    loadAll: () => (saved ? [structuredClone(saved)] : []),
  };
  const game = await playing({ roomStore: store });
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let next: Awaited<ReturnType<typeof listen>> | undefined;
  try {
    const snapshot = await until(() => game.actor.latest<RoomSnapshot>(S2C.room));
    vi.spyOn(game.local, 'broadcast').mockImplementationOnce(() => {
      throw new Error('delivery fault');
    });
    await rejection(game.actor, game.shot, 'internal-error');
    expect(game.local.inspect()).toMatchObject({ seq: 1, revision: 1 });
    expect(saved?.shotReceipts).toHaveLength(1);
    expect(isRoomRecord(saved)).toBe(true);
    await game.server.close();
    next = await listen({ roomStore: store });
    await MatchRoom.restore(structuredClone(saved!));
    const resumed = watch(
      await next.sdk.joinById(snapshot.code, { protocol: 1, nickname: 'resumed', seatToken: snapshot.seatToken }),
    );
    await until(() => resumed.latest(S2C.resume));
    expect((await rejection(resumed, game.shot, 'duplicate-shot')).seq).toBe(1);
    await rejection(resumed, { ...game.shot, input: { ...game.shot.input, curve: 0.1 } }, 'shot-conflict');
    const stored = structuredClone(saved!);
    delete stored.revision;
    delete stored.shotReceipts;
    stored.seats.forEach((seat) => {
      delete seat.actorId;
    });
    expect(isRoomRecord(stored)).toBe(true);
  } finally {
    logged.mockRestore();
    await next?.server.close();
    await game.close();
  }
});
