import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { rename, writeFile, unlink, readdir } from 'node:fs/promises';
import { Database, migrateDatabase } from '@pengzhuang/persistence';
import { createDataFixture } from './helpers/data-factory';
import { MatchCheckpoints } from '../server/matches/checkpoint-store';
import { CheckpointSchema, checkpointHash, type AccountCheckpoint } from '../server/matches/checkpoint';
import { DEFAULT_DATA } from '../shared/data';
import { createMatch, beginTurn, passTurn, forfeit } from '../shared/match';
import { parseSkin } from '../server/validation';
import { canonicalJson } from '../packages/game-core/src/snapshot';
import { RecoveryJournal } from '../server/matches/recovery-journal';
import { LiveCheckpoints } from '../server/matches/live-checkpoints';
import { systemClock } from '../server/clock';
import { MatchOutcomes } from '../server/matches/outcomes';
import { OutcomeJournal } from '../server/matches/outcome-journal';
import { AccountRestorer } from '../server/matches/account-restorer';
import { DataAudit } from '../server/maintenance/audit';

let db: Database, fixture: Awaited<ReturnType<typeof createDataFixture>>, store: MatchCheckpoints;
beforeAll(async () => {
  db = new Database({ connectionString: process.env.TEST_DATABASE_URL! });
  fixture = await createDataFixture(db);
  await migrateDatabase(db);
  store = new MatchCheckpoints(db);
});
afterAll(async () => {
  await fixture?.close();
  await db?.close();
});

async function running() {
  const { outcome, owners } = await fixture.outcome();
  const participants = (
    await db.query('SELECT user_id,lineup_snapshot FROM match_participants WHERE match_id=$1 ORDER BY side', [
      outcome.matchId,
    ])
  ).rows;
  const seats = await Promise.all(
    participants.map(async (participant) => {
      const selection = (
        await db.query(
          'SELECT l.id,l.revision FROM account_initializations a JOIN lineups l ON l.id=a.default_lineup_id AND l.user_id=a.user_id WHERE a.user_id=$1',
          [participant.user_id],
        )
      ).rows[0];
      return {
        userId: participant.user_id,
        lineupId: selection.id,
        lineupRevision: selection.revision,
        cards: participant.lineup_snapshot.map(
          (card: {
            slot: number;
            ownedCardId: string;
            playerDefId: string;
            cardVersion: number;
            ownedLevel: number;
            level: number;
          }) => ({
            slot: card.slot,
            ownedCardId: card.ownedCardId,
            playerDefId: card.playerDefId,
            cardVersion: card.cardVersion,
            ownedLevel: card.ownedLevel,
            level: card.level,
          }),
        ),
      };
    }),
  );
  const match = createMatch(
    DEFAULT_DATA,
    seats.map((seat) => seat.cards.map((card: { playerDefId: string }) => card.playerDefId)) as [string[], string[]],
    {
      seed: 123,
      levels: seats.map((seat) => seat.cards.map((card: { level: number }) => card.level)) as [number[], number[]],
    },
  );
  beginTurn(match, DEFAULT_DATA);
  const skin = parseSkin(undefined);
  if (!skin.ok) throw new Error('Default skin unavailable');
  const record = CheckpointSchema.parse({
    format: 1,
    engine: 'shared-match-v1',
    identity: 'account',
    protocol: 2,
    clockPolicy: 'freeze-v1',
    code: 'ABCDEF',
    matchId: outcome.matchId,
    configVersion: DEFAULT_DATA.version,
    configurationHash: outcome.configurationHash,
    skin: skin.value,
    seed: 123,
    seq: 0,
    revision: 0,
    match,
    seats,
    receipts: [],
    clocks: { matchMs: 180000, turnMs: 15000, playbackMs: 0, elapsedMs: 0, reconnectMs: [null, null] },
    savedAt: Date.now(),
    terminal: null,
  });
  await db.query('UPDATE matches SET room_code=$2 WHERE id=$1', [record.matchId, record.code]);
  return { record, owners };
}
function update(record: AccountCheckpoint) {
  const next = structuredClone(record);
  passTurn(next.match, DEFAULT_DATA, 'timeout');
  next.revision++;
  next.savedAt++;
  next.clocks.elapsedMs += 15000;
  next.clocks.matchMs -= 15000;
  return next;
}
// JSON and the existing wire canonicalization identify -0 and +0 as the same coordinate.
function expectRecord(actual: AccountCheckpoint, expected: AccountCheckpoint) {
  expect(canonicalJson(actual)).toBe(canonicalJson(expected));
}
test('a real checkpoint binds both owned seats and its original configuration without retaining credentials', async () => {
  const { record } = await running();
  const lease = await db.transaction((tx) => store.initialize(tx, record));
  const saved = await store.read(record.matchId);
  expectRecord(saved.record, record);
  expect(saved.configuration.data).toEqual(DEFAULT_DATA);
  expect(saved.lease).toEqual(lease);
  expect(JSON.stringify(saved.record)).not.toMatch(/authSessionId|seatToken|password|access_token/);
  await expect(
    db.query('UPDATE match_checkpoints SET payload=payload WHERE match_id=$1', [record.matchId]),
  ).rejects.toThrow();
});
test('the same committed snapshot replays after a lost response and a changed payload at that generation conflicts', async () => {
  const { record } = await running();
  const lease = await db.transaction((tx) => store.initialize(tx, record)),
    next = update(record);
  const committed = await store.write(lease, next, 'update');
  expect(await store.write(lease, next, 'update')).toEqual(committed);
  await expect(store.write(lease, { ...next, savedAt: next.savedAt + 1 }, 'update')).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  expect((await db.query('SELECT * FROM match_checkpoints WHERE match_id=$1', [record.matchId])).rowCount).toBe(2);
  expectRecord((await store.read(record.matchId)).record, next);
});
test('only an expired lease can be taken over and the old owner stays fenced even after a later retry', async () => {
  const { record } = await running();
  const lease = await db.transaction((tx) => store.initialize(tx, record));
  const other = new MatchCheckpoints(db, { storageId: store.storageId });
  expect(await other.claim(record.matchId)).toBeNull();
  await db.query(
    "UPDATE match_recovery_heads SET lease_until=clock_timestamp()-interval '1 second' WHERE match_id=$1",
    [record.matchId],
  );
  const takeover = await other.claim(record.matchId);
  expect(takeover?.lease.epoch).toBe('2');
  await expect(store.write(lease, update(record), 'update')).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await store.renew(lease)).toBe(false);
  await other.write(takeover!.lease, update(record), 'update');
  expect((await store.read(record.matchId)).record.revision).toBe(1);
});
test('failed head publication rolls back the immutable snapshot and permits the original retry', async () => {
  const { record } = await running();
  const lease = await db.transaction((tx) => store.initialize(tx, record)),
    next = update(record);
  await db.query(`CREATE FUNCTION dat_net05_fail_head() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.match_id='${record.matchId}'::uuid THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$`);
  await db.query(
    'CREATE TRIGGER dat_net05_fail_head BEFORE UPDATE ON match_recovery_heads FOR EACH ROW EXECUTE FUNCTION dat_net05_fail_head()',
  );
  try {
    await expect(store.write(lease, next, 'update')).rejects.toThrow();
    expectRecord((await store.read(record.matchId)).record, record);
    expect((await db.query('SELECT * FROM match_checkpoints WHERE match_id=$1', [record.matchId])).rowCount).toBe(1);
  } finally {
    await db.query('DROP TRIGGER dat_net05_fail_head ON match_recovery_heads');
    await db.query('DROP FUNCTION dat_net05_fail_head()');
  }
  await store.write(lease, next, 'update');
  expectRecord((await store.read(record.matchId)).record, next);
});
test('strict snapshots reject forged seats, altered pinned data, invalid engine formats and inconsistent receipt history', async () => {
  const { record } = await running();
  const forged = structuredClone(record);
  forged.seats[0].userId = randomUUID();
  await expect(db.transaction((tx) => store.initialize(tx, forged))).rejects.toMatchObject({ code: 'CONFLICT' });
  const changed = structuredClone(record);
  changed.configurationHash = 'f'.repeat(64);
  await expect(db.transaction((tx) => store.initialize(tx, changed))).rejects.toMatchObject({ code: 'CONFLICT' });
  const wrongLineup = structuredClone(record);
  wrongLineup.seats[0].lineupId = wrongLineup.seats[1].lineupId;
  await expect(db.transaction((tx) => store.initialize(tx, wrongLineup))).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(CheckpointSchema.safeParse({ ...record, format: 2 }).success).toBe(false);
  expect(CheckpointSchema.safeParse({ ...record, engine: 'unknown' }).success).toBe(false);
  expect(CheckpointSchema.safeParse({ ...record, seq: 1 }).success).toBe(false);
  expect(
    CheckpointSchema.safeParse({
      ...record,
      seats: [{ ...record.seats[0], authSessionId: randomUUID() }, record.seats[1]],
    }).success,
  ).toBe(false);
});
test('renewal and explicit release do not rewrite state and closed outcomes cannot become running checkpoints again', async () => {
  const { record } = await running();
  const lease = await db.transaction((tx) => store.initialize(tx, record));
  expect(await store.renew(lease)).toBe(true);
  await store.release(lease);
  await expect(store.write(lease, update(record), 'update')).rejects.toMatchObject({ code: 'CONFLICT' });
  const claimed = await store.claim(record.matchId);
  expect(claimed).not.toBeNull();
  await db.query("UPDATE matches SET status='settled' WHERE id=$1", [record.matchId]);
  await expect(store.write(claimed!.lease, update(record), 'update')).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('one match waiting for a real row lock does not block another match or the event loop', async () => {
  const a = await running(),
    b = await running();
  const leaseA = await db.transaction((tx) => store.initialize(tx, a.record)),
    leaseB = await db.transaction((tx) => store.initialize(tx, b.record));
  let unlock!: () => void, locked!: () => void;
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const holding = db.transaction(async (tx) => {
    await tx.query('SELECT 1 FROM match_recovery_heads WHERE match_id=$1 FOR UPDATE', [a.record.matchId]);
    locked();
    await gate;
  });
  await ready;
  let finished = false;
  const writing = store.write(leaseA, update(a.record), 'update').then((result) => {
    finished = true;
    return result;
  });
  try {
    const savedB = await store.write(leaseB, update(b.record), 'update');
    expect(savedB.checkpoint).toBe('1');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(finished).toBe(false);
  } finally {
    unlock();
    await holding;
  }
  expect((await writing).checkpoint).toBe('1');
});

test('a refused database connection cannot publish half a checkpoint and the same lease can retry after access returns', async () => {
  const { record } = await running(),
    next = update(record);
  const lease = await db.transaction((tx) => store.initialize(tx, record));
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.port = '1';
  const unreachable = new Database({ connectionString: url.href });
  try {
    await expect(
      new MatchCheckpoints(unreachable, { ownerId: store.ownerId, storageId: store.storageId }).write(
        lease,
        next,
        'update',
      ),
    ).rejects.toThrow();
  } finally {
    await unreachable.close();
  }
  expectRecord((await store.read(record.matchId)).record, record);
  await store.write(lease, next, 'update');
  expectRecord((await store.read(record.matchId)).record, next);
});

for (const action of ['before-commit', 'after-commit'] as const)
  test(`a killed real checkpoint writer recovers the last committed state at ${action}`, async () => {
    const { record } = await running(),
      next = update(record);
    const original = new MatchCheckpoints(db, { leaseMs: 5000, storageId: store.storageId });
    const lease = await db.transaction((tx) => original.initialize(tx, record));
    const child = fork(path.resolve('tests/helpers/checkpoint-worker-child.ts'), {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const exited = once(child, 'exit');
    try {
      const reached = new Promise<void>((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Checkpoint writer boundary timeout'));
        }, 10000);
        const failed = () => {
          cleanup();
          reject(new Error('Checkpoint writer exited before boundary'));
        };
        const cleanup = () => {
          clearTimeout(timeout);
          child.off('error', failed);
          child.off('exit', failed);
        };
        child.once('error', failed);
        child.once('exit', failed);
        child.stdout!.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes(JSON.stringify({ stage: action }))) {
            cleanup();
            resolve();
          }
        });
      });
      child.send({ action, databaseUrl: process.env.TEST_DATABASE_URL!, lease, record: next });
      await reached;
      child.kill('SIGKILL');
      await exited;
      const restarted = new MatchCheckpoints(db, { storageId: store.storageId });
      const deadline = Date.now() + 8000;
      let recovered = await restarted.claim(record.matchId);
      while (!recovered && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        recovered = await restarted.claim(record.matchId);
      }
      expect(recovered).not.toBeNull();
      expectRecord(recovered!.record, action === 'after-commit' ? next : record);
      expect(recovered!.lease.epoch).toBe('2');
      expect((await db.query('SELECT * FROM match_checkpoints WHERE match_id=$1', [record.matchId])).rowCount).toBe(
        action === 'after-commit' ? 2 : 1,
      );
      await expect(original.write(lease, update(recovered!.record), 'update')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
  });

test('checkpoint initialization cannot bind a guest protocol or mismatched match configuration metadata', async () => {
  const { record } = await running();
  await db.query('UPDATE matches SET protocol_version=1 WHERE id=$1', [record.matchId]);
  await expect(db.transaction((tx) => store.initialize(tx, record))).rejects.toMatchObject({ code: 'CONFLICT' });
  await db.query("UPDATE matches SET protocol_version=2,config_version='invalid-version' WHERE id=$1", [
    record.matchId,
  ]);
  await expect(db.transaction((tx) => store.initialize(tx, record))).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('clock fields cannot exceed the original game or reconnect budgets', async () => {
  const { record } = await running();
  for (const clocks of [
    { ...record.clocks, matchMs: DEFAULT_DATA.rules.matchSeconds * 1000 + 1 },
    { ...record.clocks, turnMs: 2147483647 },
    { ...record.clocks, playbackMs: 2147483647 },
    { ...record.clocks, reconnectMs: [DEFAULT_DATA.rules.reconnectSeconds * 1000 + 1, null] },
  ])
    await expect(db.transaction((tx) => store.initialize(tx, { ...record, clocks }))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
});

test('a different persistent journal volume cannot claim a running match even after its lease expires', async () => {
  const { record } = await running();
  await db.transaction((tx) => store.initialize(tx, record));
  await db.query(
    "UPDATE match_recovery_heads SET lease_until=clock_timestamp()-interval '1 second' WHERE match_id=$1",
    [record.matchId],
  );
  const foreign = new MatchCheckpoints(db, { storageId: randomUUID() });
  expect(await foreign.claim(record.matchId)).toBeNull();
  expect((await store.read(record.matchId)).lease.epoch).toBe('1');
});

function terminal(record: AccountCheckpoint): AccountCheckpoint {
  const next = structuredClone(record);
  forfeit(next.match, 0, 'surrender');
  next.revision++;
  next.savedAt++;
  next.clocks = { ...next.clocks, matchMs: 0, turnMs: null, playbackMs: 0 };
  next.terminal = {
    schemaVersion: 1,
    protocol: 2,
    matchId: next.matchId,
    mode: 'friend',
    configurationHash: next.configurationHash,
    configVersion: next.configVersion,
    finalSeq: next.seq,
    score: next.match.score,
    winner: next.match.winner,
    reason: 'surrender',
    elapsedSeconds: Math.floor(next.clocks.elapsedMs / 1000),
    endedAt: new Date().toISOString(),
    participants: [
      { userId: next.seats[0].userId, side: 0, actions: 0 },
      { userId: next.seats[1].userId, side: 1, actions: 0 },
    ],
  };
  return next;
}
async function liveRoom() {
  const { record } = await running(),
    journal = new RecoveryJournal(path.join(process.env.PG_TEST_TMP_DIR!, `net05-terminal-${randomUUID()}`));
  const storageId = await journal.open(),
    owned = new MatchCheckpoints(db, { storageId });
  const requested = systemClock.nowMs(),
    lease = await db.transaction((tx) => owned.initialize(tx, record));
  return { record, journal, owned, lease, requested };
}
test('live terminal delivery persists a fenced snapshot and the original outcome without changing its result identity', async () => {
  const setup = await liveRoom(),
    worker = fixture.consumer();
  const live = new LiveCheckpoints(setup.owned, setup.journal, worker, systemClock, () => undefined);
  live.bind(setup.lease, setup.record, setup.requested);
  try {
    const next = terminal(setup.record),
      receipt = await live.recordTerminal(next);
    expect(receipt).toMatchObject({ recorded: true, recoverable: true });
    expect((await setup.owned.read(next.matchId)).record.terminal).toEqual(next.terminal);
    expect(
      (await db.query('SELECT payload FROM match_outcomes WHERE match_id=$1', [next.matchId])).rows[0].payload,
    ).toEqual(next.terminal);
    expect(await setup.journal.ids()).toEqual([]);
    expect(await live.recordTerminal(next)).toMatchObject({ recorded: true, recoverable: true });
    expect((await db.query('SELECT * FROM match_outcomes WHERE match_id=$1', [next.matchId])).rowCount).toBe(1);
  } finally {
    await live.close();
  }
});
test('a real database outage retains a fenced terminal journal for takeover and the existing durable outcome journal fallback', async () => {
  const setup = await liveRoom(),
    url = new URL(process.env.TEST_DATABASE_URL!);
  url.port = '1';
  const unreachable = new Database({ connectionString: url.href });
  const failedStore = new MatchCheckpoints(unreachable, {
    storageId: setup.owned.storageId,
    ownerId: setup.owned.ownerId,
  });
  const oldJournal = new OutcomeJournal(
    path.join(process.env.PG_TEST_TMP_DIR!, `net05-outage-outcome-${randomUUID()}`),
  );
  const worker = new MatchOutcomes({
    db: unreachable,
    assets: fixture.assets,
    policy: () => fixture.policy,
    journal: oldJournal,
    onEvent: () => undefined,
  });
  const live = new LiveCheckpoints(failedStore, setup.journal, worker, systemClock, () => undefined);
  live.bind(setup.lease, setup.record, setup.requested);
  try {
    const next = terminal(setup.record);
    expect(await live.recordTerminal(next)).toEqual({ status: 'pending', recorded: false, recoverable: true });
    const durable = await setup.journal.read(next.matchId);
    expect(durable.record.terminal).toEqual(next.terminal);
    expect(oldJournal.read(next.matchId)).toEqual(next.terminal);
    expect((await db.query('SELECT * FROM match_outcomes WHERE match_id=$1', [next.matchId])).rowCount).toBe(0);
    await setup.owned.release(setup.lease);
    const restarted = new MatchCheckpoints(db, { storageId: setup.owned.storageId });
    const recovery = await restarted.claim(next.matchId);
    expect(recovery).not.toBeNull();
    await restarted.write(recovery!.lease, durable.record, 'terminal');
    const resumed = fixture.consumer();
    await resumed.record(durable.record.terminal);
    await resumed.drain();
    expect((await db.query('SELECT * FROM match_rewards WHERE match_id=$1', [next.matchId])).rowCount).toBe(2);
  } finally {
    await live.close().catch(() => undefined);
    await worker.close();
    await unreachable.close();
  }
});
test('a real journal write failure uses its SQL terminal checkpoint and preserves a reliable result', async () => {
  const setup = await liveRoom(),
    moved = `${setup.journal.root}.offline`;
  expect(path.dirname(path.resolve(setup.journal.root))).toBe(path.resolve(process.env.PG_TEST_TMP_DIR!));
  expect(path.dirname(path.resolve(moved))).toBe(path.resolve(process.env.PG_TEST_TMP_DIR!));
  await rename(setup.journal.root, moved);
  await writeFile(setup.journal.root, 'blocked directory');
  const live = new LiveCheckpoints(setup.owned, setup.journal, fixture.consumer(), systemClock, () => undefined);
  live.bind(setup.lease, setup.record, setup.requested);
  try {
    const next = terminal(setup.record);
    expect(await live.recordTerminal(next)).toMatchObject({ recorded: true, recoverable: true });
    expect((await setup.owned.read(next.matchId)).record.terminal).toEqual(next.terminal);
  } finally {
    await live.close();
    await unlink(setup.journal.root);
    await rename(moved, setup.journal.root);
  }
});
test('an expired local lease plus a database outage cannot acknowledge a newly published terminal result', async () => {
  const setup = await liveRoom(),
    url = new URL(process.env.TEST_DATABASE_URL!);
  url.port = '1';
  const unreachable = new Database({ connectionString: url.href });
  const failedStore = new MatchCheckpoints(unreachable, {
    storageId: setup.owned.storageId,
    ownerId: setup.owned.ownerId,
  });
  const oldJournal = new OutcomeJournal(
    path.join(process.env.PG_TEST_TMP_DIR!, `net05-expired-outcome-${randomUUID()}`),
  );
  const worker = new MatchOutcomes({
    db: unreachable,
    assets: fixture.assets,
    policy: () => fixture.policy,
    journal: oldJournal,
    onEvent: () => undefined,
  });
  const live = new LiveCheckpoints(failedStore, setup.journal, worker, systemClock, () => undefined);
  live.bind(setup.lease, setup.record, systemClock.nowMs() - failedStore.leaseMs - 1);
  try {
    expect(await live.recordTerminal(terminal(setup.record))).toEqual({
      status: 'pending',
      recorded: false,
      recoverable: false,
    });
    expect(await setup.journal.ids()).toEqual([]);
    expect(oldJournal.ids()).toEqual([]);
  } finally {
    await live.close().catch(() => undefined);
    await worker.close();
    await unreachable.close();
  }
});

test('the recovery coordinator terminates a checkpoint older than its offline retention budget without fabricating a winner', async () => {
  const setup = await liveRoom(),
    worker = fixture.consumer();
  await setup.owned.release(setup.lease);
  await db.transaction(async (tx) => {
    await tx.query('SET LOCAL session_replication_role=replica');
    await tx.query("UPDATE match_checkpoints SET created_at=clock_timestamp()-interval '25 hours' WHERE match_id=$1", [
      setup.record.matchId,
    ]);
  });
  const restorer = new AccountRestorer(async () => setup.owned, setup.journal, worker, systemClock, {
    has: () => false,
    install: async () => {
      throw new Error('Expired game must not reopen');
    },
  });
  try {
    expect((await restorer.scan()).terminal).toBe(1);
    const outcome = (await db.query('SELECT payload FROM match_outcomes WHERE match_id=$1', [setup.record.matchId]))
      .rows[0].payload;
    expect(outcome).toMatchObject({ reason: 'server-fault', winner: -1, finalSeq: 0, score: setup.record.match.score });
    await worker.drain();
    expect((await db.query('SELECT status FROM matches WHERE id=$1', [setup.record.matchId])).rows[0].status).toBe(
      'void',
    );
    expect(
      (
        await db.query("SELECT * FROM asset_operations WHERE reason='match.reward' AND source_id=$1", [
          setup.record.matchId,
        ])
      ).rowCount,
    ).toBe(0);
  } finally {
    await restorer.close();
  }
});

test('an incompatible persisted engine stays blocked and its evidence is never rewritten into a new game', async () => {
  const setup = await liveRoom();
  await setup.owned.release(setup.lease);
  await db.transaction(async (tx) => {
    await tx.query('SET LOCAL session_replication_role=replica');
    await tx.query(
      "UPDATE match_checkpoints SET payload=jsonb_set(payload,'{engine}','\"unsupported-engine\"') WHERE match_id=$1",
      [setup.record.matchId],
    );
  });
  let installed = 0;
  const restorer = new AccountRestorer(async () => setup.owned, setup.journal, fixture.consumer(), systemClock, {
    has: () => false,
    install: async () => {
      installed++;
    },
  });
  try {
    const report = await restorer.scan();
    expect(report.blocked).toBe(1);
    expect(report.failed).toBe(1);
    expect(installed).toBe(0);
    expect(
      (
        await db.query("SELECT payload->>'engine' AS engine FROM match_checkpoints WHERE match_id=$1", [
          setup.record.matchId,
        ])
      ).rows[0].engine,
    ).toBe('unsupported-engine');
    expect((await db.query('SELECT * FROM match_outcomes WHERE match_id=$1', [setup.record.matchId])).rowCount).toBe(0);
  } finally {
    await restorer.close();
  }
});

test('a late old-epoch terminal candidate cannot overwrite an already advanced checkpoint', async () => {
  const setup = await liveRoom(),
    next = update(setup.record);
  const lease = await setup.owned.write(setup.lease, next, 'update');
  await setup.journal.put({
    format: 1,
    base: { ...setup.lease, payloadHash: checkpointHash(setup.record) },
    record: terminal(setup.record),
  });
  await setup.owned.release(lease);
  const installed: AccountCheckpoint[] = [];
  const restorer = new AccountRestorer(async () => setup.owned, setup.journal, fixture.consumer(), systemClock, {
    has: () => false,
    install: async (input) => {
      installed.push(input.record);
      await setup.owned.release(input.lease);
    },
  });
  try {
    expect((await restorer.scan()).restored).toBe(1);
    expect(installed).toHaveLength(1);
    expectRecord(installed[0], next);
    expect(await setup.journal.peek(setup.record.matchId)).toBeNull();
    expect((await readdir(setup.journal.root)).some((name) => name.endsWith('.quarantine'))).toBe(true);
    expect((await db.query('SELECT * FROM match_outcomes WHERE match_id=$1', [setup.record.matchId])).rowCount).toBe(0);
  } finally {
    await restorer.close();
  }
});

test('settled recovery cache pruning preserves the durable outcome, rewards and wallet ledger while keeping unfinished games', async () => {
  const setup = await liveRoom(),
    worker = fixture.consumer(),
    next = terminal(setup.record);
  const live = new LiveCheckpoints(setup.owned, setup.journal, worker, systemClock, () => undefined);
  live.bind(setup.lease, setup.record, setup.requested);
  try {
    await live.recordTerminal(next);
    await worker.drain();
  } finally {
    await live.close();
  }
  const unfinished = await running();
  await db.transaction((tx) => setup.owned.initialize(tx, unfinished.record));
  await db.query('SELECT pg_sleep(0.01)');
  expect(await setup.owned.pruneSettled(1)).toBe(1);
  expect((await db.query('SELECT * FROM match_recovery_heads WHERE match_id=$1', [next.matchId])).rowCount).toBe(0);
  expect((await db.query('SELECT * FROM match_checkpoints WHERE match_id=$1', [next.matchId])).rowCount).toBe(0);
  expect((await db.query('SELECT * FROM match_outcomes WHERE match_id=$1', [next.matchId])).rowCount).toBe(1);
  expect((await db.query('SELECT * FROM match_rewards WHERE match_id=$1', [next.matchId])).rowCount).toBe(2);
  expect(
    (
      await db.query('SELECT count(*)::text AS n FROM asset_ledger WHERE user_id=ANY($1::uuid[])', [
        next.seats.map((seat) => seat.userId),
      ])
    ).rows[0].n,
  ).toBe('4');
  expect(
    (await db.query('SELECT * FROM match_recovery_heads WHERE match_id=$1', [unfinished.record.matchId])).rowCount,
  ).toBe(1);
  expect(await worker.record(next.terminal)).toMatchObject({ status: 'settled', recorded: true });
});

test('only a closed pre-start reservation with no accepted event can be pruned without an outcome', async () => {
  const setup = await liveRoom();
  await setup.owned.release(setup.lease);
  await db.query(
    "UPDATE matches SET recovery_closed_at=clock_timestamp(),recovery_close_reason='abandoned' WHERE id=$1",
    [setup.record.matchId],
  );
  const advanced = await running(),
    lease = await db.transaction((tx) => setup.owned.initialize(tx, advanced.record));
  await setup.owned.write(lease, update(advanced.record), 'update');
  await db.query(
    "UPDATE matches SET recovery_closed_at=clock_timestamp(),recovery_close_reason='abandoned' WHERE id=$1",
    [advanced.record.matchId],
  );
  await db.query('SELECT pg_sleep(0.01)');
  expect(await setup.owned.pruneAborted(1)).toBe(1);
  expect((await db.query('SELECT * FROM match_checkpoints WHERE match_id=$1', [setup.record.matchId])).rowCount).toBe(
    0,
  );
  expect((await db.query('SELECT * FROM matches WHERE id=$1', [setup.record.matchId])).rowCount).toBe(1);
  expect((await db.query('SELECT * FROM match_participants WHERE match_id=$1', [setup.record.matchId])).rowCount).toBe(
    2,
  );
  expect((await db.query('SELECT * FROM match_outcomes WHERE match_id=$1', [setup.record.matchId])).rowCount).toBe(0);
  expect(
    (await db.query('SELECT * FROM match_checkpoints WHERE match_id=$1', [advanced.record.matchId])).rowCount,
  ).toBe(2);
});

test('legacy account records without a running checkpoint are diagnosed without inventing a state or outcome', async () => {
  const setup = await liveRoom(),
    before = await setup.owned.legacy();
  const legacy = await fixture.outcome();
  await db.query("UPDATE matches SET room_code='ABCDEF' WHERE id=$1", [legacy.outcome.matchId]);
  const after = await setup.owned.legacy();
  expect(BigInt(after.total)).toBe(BigInt(before.total) + 1n);
  const installed: string[] = [];
  const restorer = new AccountRestorer(async () => setup.owned, setup.journal, fixture.consumer(), systemClock, {
    has: () => false,
    install: async (input) => {
      installed.push(input.record.matchId);
    },
  });
  try {
    expect((await restorer.scan()).legacyUnavailable).toBe(after.total);
    expect(installed).not.toContain(legacy.outcome.matchId);
    expect((await db.query('SELECT * FROM match_outcomes WHERE match_id=$1', [legacy.outcome.matchId])).rowCount).toBe(
      0,
    );
    expect(
      (await db.query('SELECT * FROM match_recovery_heads WHERE match_id=$1', [legacy.outcome.matchId])).rowCount,
    ).toBe(0);
  } finally {
    await restorer.close();
  }
});

test('maintenance orphan diagnostics include checkpoint references without repairing a corrupt head silently', async () => {
  const setup = await liveRoom();
  await db.transaction(async (tx) => {
    await tx.query('SET LOCAL session_replication_role=replica');
    await tx.query('UPDATE match_recovery_heads SET checkpoint=999 WHERE match_id=$1', [setup.record.matchId]);
  });
  try {
    const report = await new DataAudit(db).orphans();
    expect(
      report.findings.some(
        (finding) => finding.code === 'orphan-checkpoint-head' && finding.examples.includes(setup.record.matchId),
      ),
    ).toBe(true);
    expect(
      (await db.query('SELECT checkpoint::text FROM match_recovery_heads WHERE match_id=$1', [setup.record.matchId]))
        .rows[0].checkpoint,
    ).toBe('999');
  } finally {
    await db.query('UPDATE match_recovery_heads SET checkpoint=0 WHERE match_id=$1', [setup.record.matchId]);
  }
});
