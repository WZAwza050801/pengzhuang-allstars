import { expect, test } from 'vitest';
import { ShotReceipts, shotFingerprint } from '../server/matches/shot-receipts';
import { RoomCommandQueue } from '../server/matches/command-queue';
import { boundedShotPacket, MAX_SHOT_FRAMES, MAX_SERVER_MESSAGE_BYTES } from '../packages/contracts/src/match-wire';
import { DEFAULT_DATA } from '../shared/data';
import { createMatch, resolveShot } from '../shared/match';

const command = {
  matchId: 'match-a',
  turnId: 0,
  clientShotId: 'shot-a',
  configVersion: 'config-a',
  input: { pieceId: '0-0', dirX: 1, dirY: 0, power: 0.2, curve: 0 },
};
test('receipts distinguish identical retries, payload conflicts, users and matches', () => {
  const receipts = new ShotReceipts();
  receipts.accept('user-a', command, 1, 1);
  expect(receipts.lookup('user-a', command)).toMatchObject({ kind: 'same', receipt: { seq: 1, revision: 1 } });
  for (const changed of [{ turnId: 1 }, { configVersion: 'other' }, { input: { ...command.input, power: 0.3 } }])
    expect(receipts.lookup('user-a', { ...command, ...changed }).kind).toBe('conflict');
  expect(receipts.lookup('user-b', command).kind).toBe('new');
  expect(receipts.lookup('user-a', { ...command, input: { ...command.input, power: NaN } }).kind).toBe('conflict');
  expect(receipts.lookup('user-a', { ...command, matchId: 'match-b' }).kind).toBe('new');
  expect(shotFingerprint({ ...command, input: { ...command.input, dirY: -0 } })).toBe(shotFingerprint(command));
  expect(() => receipts.accept('user-a', command, 2, 2)).toThrow();
  const restored = new ShotReceipts(receipts.records());
  expect(restored.lookup('user-a', command)).toMatchObject({ kind: 'same', receipt: { seq: 1 } });
});

test('the room queue serializes async commands, bounds network work and retains clock control work', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const events: string[] = [],
    failures: unknown[] = [];
  const queue = new RoomCommandQueue(2);
  expect(
    queue.submit(
      async () => {
        events.push('shot');
        await gate;
        events.push('accepted');
      },
      (error) => failures.push(error),
    ),
  ).toBe(true);
  expect(
    queue.submit(
      () => {
        events.push('surrender');
      },
      (error) => failures.push(error),
    ),
  ).toBe(true);
  expect(
    queue.submit(
      () => {
        events.push('overflow');
      },
      (error) => failures.push(error),
    ),
  ).toBe(false);
  expect(
    queue.submit(
      () => {
        events.push('old-clock');
      },
      (error) => failures.push(error),
      'turn',
    ),
  ).toBe(true);
  expect(
    queue.submit(
      () => {
        events.push('new-clock');
      },
      (error) => failures.push(error),
      'turn',
    ),
  ).toBe(true);
  expect(events).toEqual(['shot']);
  release();
  await queue.idle();
  expect(events).toEqual(['shot', 'accepted', 'surrender', 'new-clock']);
  expect(failures).toEqual([]);
});

test('queue failures do not stop subsequent commands and close drops pending work', async () => {
  const events: string[] = [];
  const queue = new RoomCommandQueue();
  queue.submit(
    () => {
      throw new Error('injected');
    },
    () => events.push('failure'),
  );
  queue.submit(
    () => {
      events.push('next');
    },
    () => undefined,
  );
  await queue.idle();
  expect(events).toEqual(['failure', 'next']);
  let release!: () => void;
  queue.submit(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    () => undefined,
  );
  queue.submit(
    () => {
      events.push('discarded');
    },
    () => undefined,
  );
  queue.close();
  release();
  await queue.idle();
  expect(
    queue.submit(
      () => undefined,
      () => undefined,
    ),
  ).toBe(false);
  expect(events).toEqual(['failure', 'next']);
});

test('real physics packets fit bounded playback, while malformed dimensions, coordinates and bytes fail', () => {
  const lineup = DEFAULT_DATA.rules.defaultLineup;
  const state = createMatch(DEFAULT_DATA, [lineup, lineup], { seed: 1, firstSide: 0 });
  const output = resolveShot(state, DEFAULT_DATA, command.input);
  const packet = {
    ...command,
    state,
    ids: output.sim.ids,
    frames: output.sim.frames,
    recordHz: DEFAULT_DATA.physics.recordHz,
    simEvents: output.sim.events,
    events: output.events,
    turnEvents: output.turnEvents,
    seq: 1,
    seat: 0,
    protocol: 2,
    revision: 1,
  };
  expect(boundedShotPacket(packet)).toBe(true);
  for (const changed of [
    { frames: Array(MAX_SHOT_FRAMES + 1).fill(packet.frames[0]) },
    { frames: [[1, 2]] },
    { frames: [packet.frames[0].map(() => Infinity)] },
    { recordHz: 0 },
    { simEvents: Array(4097).fill({}) },
    { padding: 'x'.repeat(MAX_SERVER_MESSAGE_BYTES) },
  ])
    expect(boundedShotPacket({ ...packet, ...changed })).toBe(false);
});
