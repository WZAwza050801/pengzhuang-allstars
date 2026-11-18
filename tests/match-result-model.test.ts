import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { ResultCache, MatchResultModel } from '../packages/client-model/src/match-result';
import { MatchResultSchema } from '../packages/contracts/src/match-results';

const account = () => ({ userId: randomUUID(), sessionId: randomUUID() });
function fixture() {
  const owner = account(),
    matchId = randomUUID(),
    cache = new ResultCache();
  cache.setIdentity(owner);
  const result = MatchResultSchema.parse({
    userId: owner.userId,
    matchId,
    side: 0,
    mode: 'friend',
    configVersion: 'game-1',
    economyVersion: 'economy-2',
    modesVersion: 'modes-1',
    finalSeq: 0,
    score: [0, 0],
    winner: 1,
    reason: 'surrender',
    endedAt: '2026-11-18T05:00:00.000Z',
    status: 'recorded',
    recorded: true,
    pendingReason: null,
    reward: null,
  });
  const port = { matchResult: vi.fn(async () => ({ ok: true as const, data: result })), matchLedger: vi.fn() };
  return { owner, matchId, cache, result, port, model: new MatchResultModel(port, owner, matchId, cache) };
}

test('result reads coalesce, preserve confirmed data offline and on failures, and never turn a pending reward into zero', async () => {
  const f = fixture();
  let resolve!: (value: unknown) => void;
  const waiting = new Promise((done) => {
    resolve = done;
  });
  f.port.matchResult.mockImplementationOnce(() => waiting as ReturnType<typeof f.port.matchResult>);
  const first = f.model.refresh(),
    second = f.model.refresh();
  expect(first).toBe(second);
  expect(f.port.matchResult).toHaveBeenCalledTimes(1);
  resolve({ ok: true, data: f.result });
  await first;
  expect(f.model.snapshot.value?.reward).toBeNull();
  f.model.setOnline(false);
  await f.model.refresh();
  expect(f.port.matchResult).toHaveBeenCalledTimes(1);
  expect(f.model.snapshot).toMatchObject({ offline: true, value: f.result });
  f.model.setOnline(true);
  f.port.matchResult.mockResolvedValueOnce({ ok: false, error: { code: 'UNAVAILABLE', retryable: true } } as never);
  await f.model.refresh();
  expect(f.model.snapshot).toMatchObject({ value: f.result, error: { code: 'UNAVAILABLE' } });
  const openedAgain = new MatchResultModel(f.port, f.owner, f.matchId, f.cache);
  expect(openedAgain.snapshot.value).toEqual(f.result);
  f.model.dispose();
  openedAgain.dispose();
});

test('session changes and disposed views discard late responses, and authorization failures remove private cached results', async () => {
  const f = fixture();
  let resolve!: (value: unknown) => void;
  f.port.matchResult.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done as typeof resolve;
      }),
  );
  const pending = f.model.refresh();
  f.cache.setIdentity(account());
  resolve({ ok: true, data: f.result });
  await pending;
  expect(f.model.snapshot.value).toBeNull();
  f.cache.setIdentity(f.owner);
  expect(new MatchResultModel(f.port, f.owner, f.matchId, f.cache).snapshot.value).toBeNull();
  const current = new MatchResultModel(f.port, f.owner, f.matchId, f.cache);
  await current.refresh();
  f.port.matchResult.mockResolvedValueOnce({
    ok: false,
    error: { code: 'UNAUTHENTICATED', retryable: false },
  } as never);
  await current.refresh();
  expect(current.snapshot.value).toBeNull();
  expect(f.cache.isIdentity(f.owner)).toBe(false);
  current.dispose();
  f.model.dispose();
  const disposed = fixture();
  let finish!: (value: unknown) => void;
  disposed.port.matchResult.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done as typeof finish;
      }),
  );
  const delayed = disposed.model.refresh();
  disposed.model.dispose();
  finish({ ok: true, data: disposed.result });
  await delayed;
  expect(disposed.cache.read(disposed.owner, disposed.matchId)).toBeNull();
});

test('only committed rewards can request their exact immutable ledger, and mismatched rows remain an error', async () => {
  const f = fixture();
  await f.model.refresh();
  await f.model.readLedger();
  expect(f.port.matchLedger).not.toHaveBeenCalled();
  const ledgerId = randomUUID();
  const settled = MatchResultSchema.parse({
    ...f.result,
    mode: 'growth',
    status: 'settled',
    reward: {
      eligible: true,
      coins: '50',
      fragments: '0',
      playerDefId: null,
      operationId: randomUUID(),
      ledgerIds: [ledgerId],
      dayKey: '2026-11-18',
    },
  });
  f.port.matchResult.mockResolvedValueOnce({ ok: true, data: settled });
  await f.model.refresh();
  f.port.matchLedger.mockResolvedValueOnce({
    ok: true,
    data: {
      userId: f.owner.userId,
      matchId: f.matchId,
      entries: [
        {
          id: ledgerId,
          currency: 'coins',
          delta: '500',
          balanceAfter: '800',
          reason: 'match.reward',
          sourceId: f.matchId,
          createdAt: settled.endedAt,
        },
      ],
    },
  });
  await f.model.readLedger();
  expect(f.model.snapshot.ledger).toBeNull();
  expect(f.model.snapshot.ledgerError?.code).toBe('INVALID_RESPONSE');
  f.port.matchLedger.mockResolvedValueOnce({
    ok: true,
    data: {
      userId: f.owner.userId,
      matchId: f.matchId,
      entries: [
        {
          id: ledgerId,
          currency: 'coins',
          delta: '50',
          balanceAfter: '350',
          reason: 'match.reward',
          sourceId: f.matchId,
          createdAt: settled.endedAt,
        },
      ],
    },
  });
  await f.model.readLedger();
  expect(f.model.snapshot.ledger).toHaveLength(1);
  f.port.matchResult.mockResolvedValueOnce({ ok: true, data: f.result });
  await f.model.refresh();
  expect(f.model.snapshot.value?.status).toBe('settled');
  f.model.dispose();
});
