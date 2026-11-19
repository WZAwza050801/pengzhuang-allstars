import { afterEach, expect, test, vi } from 'vitest';
import { createDecisionBroker, type DecisionWorker } from '@pengzhuang/platform';
class FakeWorker implements DecisionWorker {
  messages = new Set<(v: unknown) => void>();
  errors = new Set<() => void>();
  posted: { id: number; payload: unknown } | null = null;
  terminate = vi.fn();
  postMessage(value: unknown) {
    this.posted = value as typeof this.posted;
  }
  onMessage(fn: (v: unknown) => void) {
    this.messages.add(fn);
    return () => this.messages.delete(fn);
  }
  onError(fn: () => void) {
    this.errors.add(fn);
    return () => this.errors.delete(fn);
  }
  reply(value: unknown, id = this.posted!.id) {
    for (const fn of this.messages) fn({ id, payload: value });
  }
}
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
test('matching replies settle once; wrong ids stay pending and every listener/timer/worker is released', async () => {
  vi.useFakeTimers();
  const worker = new FakeWorker(),
    broker = createDecisionBroker(() => worker),
    result = broker.run({ turn: 1 }, 100);
  worker.reply('stale', 99);
  expect(broker.pending).toBe(true);
  worker.reply('ok');
  expect(await result).toEqual({ status: 'completed', value: 'ok' });
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(worker.messages.size + worker.errors.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(broker.pending).toBe(false);
  broker.dispose();
});
test('hard timeout, creation failure, worker error and posting failure use explicit outcomes and clean up', async () => {
  vi.useFakeTimers();
  const worker = new FakeWorker(),
    broker = createDecisionBroker(() => worker),
    result = broker.run({}, 50);
  await vi.advanceTimersByTimeAsync(50);
  expect(await result).toEqual({ status: 'timeout' });
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  const unavailable = createDecisionBroker(() => {
    throw new Error('workers unavailable');
  });
  expect(await unavailable.run({}, 50)).toEqual({ status: 'unavailable' });
  const errorWorker = new FakeWorker(),
    failure = createDecisionBroker(() => errorWorker),
    bad = failure.run({}, 50);
  for (const fn of errorWorker.errors) fn();
  expect(await bad).toEqual({ status: 'failed' });
  const postWorker = new FakeWorker();
  postWorker.postMessage = () => {
    throw new Error('post failed');
  };
  expect(await createDecisionBroker(() => postWorker).run({}, 50)).toEqual({ status: 'failed' });
  expect(postWorker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  broker.dispose();
  unavailable.dispose();
  failure.dispose();
});
test('replacing/disposing a job aborts it and late callbacks cannot change a later job', async () => {
  vi.useFakeTimers();
  const a = new FakeWorker(),
    b = new FakeWorker(),
    queue = [a, b],
    factory = vi.fn(() => queue.shift()!);
  const broker = createDecisionBroker(factory);
  const first = broker.run({}, 100),
    stale = [...a.messages][0];
  const second = broker.run({}, 100);
  expect(await first).toEqual({ status: 'aborted' });
  stale({ id: a.posted!.id, payload: 'late' });
  expect(broker.pending).toBe(true);
  broker.dispose();
  expect(await second).toEqual({ status: 'aborted' });
  expect(await broker.run({}, 100)).toEqual({ status: 'aborted' });
  expect(factory).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  await expect(broker.run({}, 0)).rejects.toThrow('timeout');
});
