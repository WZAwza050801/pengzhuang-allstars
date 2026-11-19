import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { QueueStateModel, type QueuePort } from '../packages/client-model/src/queue';
import { MATCHMAKING_POLICY } from '../config/matchmaking';
import type { QueueStatus, QueueCommand } from '../packages/contracts/src/matchmaking';
import { DEFAULT_DATA } from '../shared/data';
import { rulesForMode } from '../config/modes';

const ok = <T>(data: T) => ({ ok: true as const, data });
function fixture() {
  const userId = randomUUID(),
    command: QueueCommand = {
      intentId: randomUUID(),
      mode: 'friend',
      protocol: 2,
      lineupId: randomUUID(),
      expectedRevision: 0,
      configVersion: DEFAULT_DATA.version,
      region: 'local',
    };
  const empty: QueueStatus = { userId, serverNow: '2026-11-18T00:00:00.000Z', entry: null };
  const queued: QueueStatus = {
    ...empty,
    entry: {
      id: randomUUID(),
      intentId: command.intentId,
      mode: 'friend',
      configVersion: DEFAULT_DATA.version,
      policyVersion: 'queue-1',
      rules: rulesForMode(DEFAULT_DATA, 'friend'),
      region: 'local',
      lineupId: command.lineupId,
      lineupRevision: 0,
      rating: null,
      state: 'queued',
      reason: 'waiting-compatible-player',
      createdAt: empty.serverNow,
      expiresAt: '2026-11-18T00:02:00.000Z',
      assignment: null,
    },
  };
  const port: QueuePort = {
    queueOptions: async () =>
      ok({ protocol: 2, configVersion: DEFAULT_DATA.version, policy: MATCHMAKING_POLICY, enabledModes: ['friend'] }),
    queueStatus: async () => ok(empty),
    enterQueue: async () => ok(queued),
    cancelQueue: async () => ok({ ...queued, entry: { ...queued.entry!, state: 'cancelled', reason: 'cancelled' } }),
  };
  return { userId, command, empty, queued, port };
}
test('uncertain entry submission retries the exact original intent and never announces a local success', async () => {
  const value = fixture(),
    commands: QueueCommand[] = [];
  value.port.enterQueue = async (_owner, command) => {
    commands.push(command);
    return commands.length === 1 ? { ok: false, error: { code: 'NETWORK_ERROR', retryable: true } } : ok(value.queued);
  };
  const model = new QueueStateModel(value.port, value.userId);
  await model.refresh();
  await model.enter(value.command);
  expect(model.snapshot).toMatchObject({ pending: 'entry', busy: false, data: { entry: null } });
  await model.refresh();
  expect(model.snapshot.pending).toBe('entry');
  await model.retry();
  expect(commands).toEqual([value.command, value.command]);
  expect(model.snapshot).toMatchObject({ pending: null, data: value.queued });
});

test('an options failure retains the authoritative own entry and allows cancellation', async () => {
  const value = fixture();
  value.port.queueOptions = async () => ({ ok: false, error: { code: 'UNAVAILABLE', retryable: true } });
  value.port.queueStatus = async () => ok(value.queued);
  const model = new QueueStateModel(value.port, value.userId);
  await model.refresh();
  expect(model.snapshot).toMatchObject({ data: value.queued, loading: false, problem: { code: 'UNAVAILABLE' } });
  await model.cancel();
  expect(model.snapshot.data?.entry?.state).toBe('cancelled');
});
test('a late queue read cannot overwrite a successful match returned by a cancel race', async () => {
  const value = fixture();
  let reads = 0,
    resolve!: (value: ReturnType<typeof ok<QueueStatus>>) => void;
  value.port.queueStatus = async () =>
    ++reads === 1
      ? ok(value.queued)
      : new Promise((done) => {
          resolve = done;
        });
  const matched: QueueStatus = {
    ...value.queued,
    entry: {
      ...value.queued.entry!,
      state: 'matched',
      reason: 'paired',
      assignment: { id: randomUUID(), roomCode: 'ABCDEF', expiresAt: '2026-11-18T00:02:00.000Z', state: 'ready' },
    },
  };
  value.port.cancelQueue = async () => ok(matched);
  const model = new QueueStateModel(value.port, value.userId);
  await model.refresh();
  const stale = model.refresh();
  await model.cancel();
  resolve(ok(value.queued));
  await stale;
  expect(model.snapshot.data).toEqual(matched);
  expect(model.snapshot.notice).toContain('取消未生效');
});
test('disposal and changed identity discard late private replies and prevent further mutations', async () => {
  const value = fixture();
  let resolve!: (value: ReturnType<typeof ok<QueueStatus>>) => void,
    changes = 0;
  value.port.enterQueue = async () =>
    new Promise((done) => {
      resolve = done;
    });
  const model = new QueueStateModel(value.port, value.userId);
  await model.refresh();
  model.subscribe(() => {
    changes++;
  });
  const pending = model.enter(value.command);
  model.dispose();
  const count = changes;
  resolve(ok(value.queued));
  await pending;
  expect(model.snapshot.data?.entry).toBeNull();
  expect(changes).toBe(count);
  const other = new QueueStateModel(value.port, value.userId, () => false);
  await other.enter(value.command);
  expect(other.snapshot.pending).toBeNull();
});
