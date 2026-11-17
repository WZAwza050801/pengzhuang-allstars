import { afterEach, expect, test, vi } from 'vitest';
import { LocalHost } from '../client/src/localHost';
import { DEFAULT_DATA } from '../shared/data';
import type { MatchState } from '../shared/match';
import type { ShotPacket } from '../client/src/host';
import type { DecisionWorker } from '@pengzhuang/platform';
function fixture(unavailable = false) {
  let handler: ((value: unknown) => void) | null = null;
  let envelope: { id: number; payload: unknown } | null = null;
  const terminate = vi.fn(),
    create = vi.fn(() => {
      if (unavailable) throw new Error('No worker');
      const worker: DecisionWorker = {
        postMessage(value) {
          envelope = value as typeof envelope;
        },
        onMessage(fn) {
          handler = fn;
          return () => {};
        },
        onError() {
          return () => {};
        },
        terminate,
      };
      return worker;
    });
  const packets: ShotPacket[] = [];
  let state: MatchState;
  const host = new LocalHost(
    {
      mode: 'bot',
      names: ['a', 'b'],
      lineups: [DEFAULT_DATA.rules.defaultLineup, DEFAULT_DATA.rules.defaultLineup],
      timer: false,
    },
    { seed: 7, createWorker: create },
  );
  host.start({
    onState: (s) => {
      state = s;
    },
    onShot: (p) => {
      packets.push(p);
      state = p.state;
    },
    onEvents: () => {},
  });
  const human = state!.pieces.find((p) => p.side === state!.turn && p.out === 0 && p.frozen === 0)!;
  host.shoot({ pieceId: human.id, dirX: 1, dirY: 0, power: 0.06, curve: 0 });
  host.playbackDone();
  return { host, packets, create, terminate, state: () => state!, late: () => handler!, envelope: () => envelope! };
}
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
test('host dispose cancels the scheduled AI start before it can create a worker', async () => {
  vi.useFakeTimers();
  const f = fixture();
  expect(f.packets).toHaveLength(1);
  f.host.dispose();
  await vi.advanceTimersByTimeAsync(3000);
  expect(f.create).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
test('surrender cancels an active worker and rejects its late result without another shot', async () => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    await vi.advanceTimersByTimeAsync(600);
    const late = f.late(),
      id = f.envelope().id;
    f.host.surrender();
    late({
      id,
      payload: {
        epoch: { shotNo: 1, turn: 1, dataVersion: DEFAULT_DATA.version },
        input: null,
        stats: { evaluated: 0, elapsedMs: 0, reason: 'no-move' },
      },
    });
    await Promise.resolve();
    expect(f.state().over).toBe(true);
    expect(f.packets).toHaveLength(1);
    expect(f.terminate).toHaveBeenCalledOnce();
  } finally {
    f.host.dispose();
  }
  expect(vi.getTimerCount()).toBe(0);
});
test('deadline or unavailable workers fall back to one legal bot shot without blocking progression', async () => {
  vi.useFakeTimers();
  for (const unavailable of [false, true]) {
    const f = fixture(unavailable);
    try {
      await vi.advanceTimersByTimeAsync(2200);
      expect(f.packets).toHaveLength(2);
      expect(f.packets[1].input.pieceId.startsWith('1-')).toBe(true);
      expect(f.state().shotNo).toBe(2);
    } finally {
      f.host.dispose();
    }
  }
  expect(vi.getTimerCount()).toBe(0);
});
