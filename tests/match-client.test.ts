import { expect, test, vi } from 'vitest';
import { OnlineHost } from '../client/src/onlineHost';
import { DEFAULT_DATA } from '../shared/data';
import { createMatch, resolveShot, type MatchState } from '../shared/match';
import { rulesForMode } from '../config/modes';
import { S2C, type MatchStartMsg, type ShotPacketMsg, type UpdateMsg } from '../shared/protocol';
import type { ShotPacket } from '../client/src/host';

const transport = vi.hoisted(() => ({ rooms: [] as unknown[] }));
vi.mock('colyseus.js', () => ({
  Client: class {
    async joinById() {
      return transport.rooms.shift();
    }
  },
}));
async function fixture() {
  const handlers = new Map<string, (message: unknown) => void>();
  const room = {
    roomId: 'ABCDEF',
    send: vi.fn(),
    leave: vi.fn(async () => undefined),
    onMessage: (type: string, callback: (message: unknown) => void) => handlers.set(type, callback),
    onLeave: vi.fn(),
    onError: vi.fn(),
  };
  transport.rooms.push(room);
  const statuses: string[] = [],
    states: MatchState[] = [],
    packets: ShotPacket[] = [];
  const host = new OnlineHost(
    {
      nickname: 'account',
      account: {
        userId: crypto.randomUUID(),
        issueTicket: async () => ({
          ok: true,
          data: {
            ticket: 'a'.repeat(43),
            roomCode: 'ABCDEF',
            expiresAt: '2026-11-18T00:00:00.000Z',
            protocol: 2,
            mode: 'friend',
            configVersion: DEFAULT_DATA.version,
          },
        }),
      },
    },
    (status) => statuses.push(status),
  );
  await host.connect();
  host.start({
    onState: (state) => states.push(state),
    onShot: (packet) => packets.push(packet),
    onEvents: () => undefined,
  });
  const state = createMatch(DEFAULT_DATA, [DEFAULT_DATA.rules.defaultLineup, DEFAULT_DATA.rules.defaultLineup], {
    seed: 1,
    firstSide: 0,
  });
  const rules = rulesForMode(DEFAULT_DATA, 'friend');
  const start: MatchStartMsg = {
    protocol: 2,
    revision: 0,
    matchId: 'match-a',
    configVersion: DEFAULT_DATA.version,
    skin: 'classic',
    lineups: [DEFAULT_DATA.rules.defaultLineup, DEFAULT_DATA.rules.defaultLineup],
    levels: [Array(5).fill(5), Array(5).fill(5)],
    names: ['a', 'b'],
    state,
    turnEvents: [],
    clocks: { turnMs: 20000, matchMs: 180000 },
    rules,
  };
  const emit = (type: string, message: unknown) => handlers.get(type)!(structuredClone(message));
  emit(S2C.matchStart, start);
  const input = { pieceId: state.pieces[0].id, dirX: 1, dirY: 0, power: 0.1, curve: 0 };
  const work = structuredClone(state),
    output = resolveShot(work, DEFAULT_DATA, input);
  const packet: ShotPacketMsg = {
    protocol: 2,
    revision: 1,
    matchId: start.matchId,
    seat: 0,
    clientShotId: 'old-shot',
    seq: 1,
    input,
    ids: output.sim.ids,
    frames: output.sim.frames,
    recordHz: DEFAULT_DATA.physics.recordHz,
    simEvents: output.sim.events,
    events: output.events,
    turnEvents: output.turnEvents,
    state: work,
    clocks: start.clocks,
  };
  return { host, room, emit, states, statuses, packets, start, input, packet };
}

test('v2 clients ignore reordered or duplicate state packets after a newer terminal update', async () => {
  const game = await fixture();
  try {
    game.emit(S2C.shotPacket, game.packet);
    game.emit(S2C.shotPacket, game.packet);
    const ended: UpdateMsg = {
      protocol: 2,
      revision: 2,
      matchId: game.start.matchId,
      state: { ...game.packet.state, over: true, endReason: 'surrender', winner: 1 },
      events: [],
      clocks: { turnMs: null, matchMs: 0 },
    };
    game.emit(S2C.update, ended);
    game.emit(S2C.shotPacket, game.packet);
    game.emit(S2C.update, { ...ended, revision: 1, state: game.start.state });
    game.emit(S2C.resume, { ...game.start, seq: 0 });
    expect(game.packets).toHaveLength(1);
    expect(game.states.at(-1)).toEqual(ended.state);
    expect(game.statuses.at(-1)).toBe('ended');
  } finally {
    game.host.dispose();
  }
});

test('old resume/errors cannot unlock a pending intent; an ACK without its packet requests a snapshot', async () => {
  const game = await fixture();
  try {
    game.host.shoot(game.input);
    const command = game.room.send.mock.calls.at(-1)![1];
    expect(command).toMatchObject({ protocol: 2, revision: 0, matchId: 'match-a' });
    expect(game.host.inputStatus()).toBe('pending');
    game.emit(S2C.update, {
      protocol: 2,
      revision: 1,
      matchId: 'match-a',
      state: game.start.state,
      events: [],
      clocks: game.start.clocks,
    });
    game.host.shoot(game.input);
    const pending = game.room.send.mock.calls.at(-1)![1];
    game.emit(S2C.resume, { ...game.start, seq: 0 });
    game.emit(S2C.error, { protocol: 2, revision: 0, on: 'shot', code: 'bad-power' });
    expect(game.host.inputStatus()).toBe('pending');
    game.emit(S2C.shotAck, {
      protocol: 2,
      revision: 2,
      acceptedRevision: 2,
      matchId: 'match-a',
      clientShotId: pending.clientShotId,
      seq: 1,
      duplicate: false,
    });
    expect(game.host.inputStatus()).toBe('reconnecting');
    expect(game.room.send.mock.calls.filter((call) => call[0] === 'shot')).toHaveLength(2);
  } finally {
    game.host.dispose();
  }
});

test('account clients fail closed on incompatible state stamps and oversized playback', async () => {
  for (const invalid of ['stamp', 'frames']) {
    const game = await fixture();
    try {
      if (invalid === 'stamp') game.emit(S2C.update, { protocol: 1, revision: 1, matchId: 'match-a' });
      else game.emit(S2C.shotPacket, { ...game.packet, frames: Array(1025).fill(game.packet.frames[0]) });
      expect(game.host.inputStatus()).toBe('closed');
      expect(game.room.leave).toHaveBeenCalledWith(true);
      expect(game.packets).toHaveLength(0);
    } finally {
      game.host.dispose();
    }
  }
});
