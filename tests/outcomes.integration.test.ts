import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { freePort } from './helpers/mailpit';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { Database, AccountRepository, migrateDatabase } from '@pengzhuang/persistence';
import { readRuntimeConfig } from '../config/runtime';
import { createBundledEconomyConfiguration } from '../config/economy';
import { rulesForMode } from '../config/modes';
import { DEFAULT_DATA } from '../shared/data';
import { MatchOutcomes, type MatchRatings } from '../server/matches/outcomes';
import { OutcomeJournal, OutcomeConflict } from '../server/matches/outcome-journal';
import { PlayerData } from '../server/accounts/player-data';
import { Assets } from '../server/accounts/assets';
import { OutcomeIntentSchema, type OutcomeIntent } from '../packages/contracts/src/match-results';
import { quoteDuplicateFragments } from '../packages/game-core/src/economy';
import type { EconomyPolicy } from '../packages/contracts/src/economy';

let db: Database, assets: Assets, players: PlayerData, root: string;
const policy = createBundledEconomyConfiguration().policy;
const opened: MatchOutcomes[] = [];
// This SQL marker tests the future rating port's transaction boundary, not the MM-02 rating algorithm.
const ratingTransaction: MatchRatings = {
  async applyInTransaction(tx, outcome) {
    await tx.query('INSERT INTO test_match_rating_effects(match_id,winner) VALUES ($1,$2)', [
      outcome.matchId,
      outcome.winner,
    ]);
  },
};
beforeAll(async () => {
  const config = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
  if (!config.databaseUrl || !process.env.PG_TEST_TMP_DIR) throw new Error('Isolated PostgreSQL required');
  db = new Database({ connectionString: config.databaseUrl });
  await migrateDatabase(db);
  await db.query('CREATE TABLE test_match_rating_effects(match_id uuid PRIMARY KEY,winner integer NOT NULL)');
  players = new PlayerData(db, policy, DEFAULT_DATA);
  assets = new Assets(db, players.initialize, () => ({ policy, data: DEFAULT_DATA }));
  root = path.join(process.env.PG_TEST_TMP_DIR, 'outcome-journals');
});
afterAll(async () => {
  await Promise.all(opened.map((service) => service.close()));
  await db?.close();
});
function service(
  directory: string = randomUUID(),
  ratings: MatchRatings | undefined = ratingTransaction,
  current: () => EconomyPolicy = () => policy,
) {
  const journal = new OutcomeJournal(path.join(root, directory));
  const instance = new MatchOutcomes({ db, assets, policy: current, journal, ratings, onEvent: () => undefined });
  opened.push(instance);
  return { instance, journal };
}
async function owner() {
  const user = await new AccountRepository(db).createUser();
  await db.transaction((tx) => players.initialize(tx, user.id));
  return user.id;
}
async function match(
  port: MatchOutcomes,
  mode: 'friend' | 'growth' = 'growth',
  owners?: [string, string],
  endedAt = '2026-11-18T05:00:00.000Z',
): Promise<OutcomeIntent> {
  const ids = owners ?? [await owner(), await owner()],
    matchId = randomUUID();
  const hash = await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO matches(id,mode,config_version,protocol_version,status,room_code) VALUES ($1,$2,$3,2,'playing','ABCDEF')",
      [matchId, mode, DEFAULT_DATA.version],
    );
    for (const [side, id] of ids.entries()) {
      const cards = (
        await tx.query('SELECT id,player_def_id,level FROM owned_cards WHERE user_id=$1 ORDER BY id LIMIT 5', [id])
      ).rows;
      await tx.query('INSERT INTO match_participants(match_id,user_id,side,lineup_snapshot) VALUES ($1,$2,$3,$4)', [
        matchId,
        id,
        side,
        JSON.stringify(cards),
      ]);
    }
    return port.openInTransaction(tx, matchId, DEFAULT_DATA, rulesForMode(DEFAULT_DATA, mode));
  });
  return OutcomeIntentSchema.parse({
    schemaVersion: 1,
    protocol: 2,
    matchId,
    mode,
    configurationHash: hash,
    configVersion: DEFAULT_DATA.version,
    finalSeq: 4,
    score: [1, 0],
    winner: 0,
    reason: 'time',
    elapsedSeconds: 180,
    endedAt,
    participants: ids.map((userId, side) => ({ userId, side, actions: 2 })),
  });
}
const balance = async (id: string, currency = 'coins') =>
  (
    await db.query<{ balance: string }>('SELECT balance::text FROM wallets WHERE user_id=$1 AND currency=$2', [
      id,
      currency,
    ])
  ).rows[0].balance;
const rewards = async (id: string) =>
  (await db.query('SELECT * FROM match_rewards WHERE match_id=$1 ORDER BY user_id', [id])).rows;
const settled = async (id: string) =>
  (await db.query('SELECT settled_at FROM match_outcomes WHERE match_id=$1', [id])).rows[0]?.settled_at;

for (const action of ['journal-only', 'before-commit', 'after-commit'])
  test(`a killed real worker recovers exactly once at ${action}`, async () => {
    const directory = `crash-${action}-${randomUUID()}`,
      port = service(directory),
      outcome = await match(port.instance);
    const originalUrl = readRuntimeConfig({ ...process.env, APP_ENV: 'test' }).databaseUrl!;
    const unavailable = new URL(originalUrl);
    unavailable.port = String(await freePort());
    if (action !== 'journal-only') await port.instance.record(outcome);
    const child = fork(path.resolve('tests/helpers/outcome-worker-child.ts'), {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const exited = once(child, 'exit');
    try {
      const reached = new Promise<void>((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => reject(new Error('Worker boundary timeout')), 20000);
        const fail = () => {
          clearTimeout(timeout);
          reject(new Error('Worker exited before boundary'));
        };
        child.once('error', fail);
        child.once('exit', fail);
        child.stdout!.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes(JSON.stringify({ stage: action }))) {
            clearTimeout(timeout);
            child.off('error', fail);
            child.off('exit', fail);
            resolve();
          }
        });
      });
      child.send({
        action,
        databaseUrl: action === 'journal-only' ? unavailable.toString() : originalUrl,
        journal: path.join(root, directory),
        outcome,
        matchId: outcome.matchId,
      });
      await reached;
      if (action === 'before-commit') {
        expect(await balance(outcome.participants[0].userId)).toBe('300');
        expect(await rewards(outcome.matchId)).toHaveLength(0);
      }
      child.kill();
      await exited;
      expect(port.journal.read(outcome.matchId)).toEqual(outcome);
      if (action === 'journal-only') expect(await settled(outcome.matchId)).toBeUndefined();
      else expect(!!(await settled(outcome.matchId))).toBe(action === 'after-commit');
      const fresh = service(directory);
      await fresh.instance.drain();
      await fresh.instance.drain();
      expect(await settled(outcome.matchId)).toBeTruthy();
      expect(await rewards(outcome.matchId)).toHaveLength(2);
      expect(await balance(outcome.participants[0].userId)).toBe('350');
      expect(await balance(outcome.participants[1].userId)).toBe('320');
      expect(
        (await db.query("SELECT id FROM asset_ledger WHERE source_id=$1 AND reason='match.reward'", [outcome.matchId]))
          .rows,
      ).toHaveLength(2);
      expect(
        (await db.query('SELECT * FROM test_match_rating_effects WHERE match_id=$1', [outcome.matchId])).rows,
      ).toHaveLength(1);
      expect(fresh.journal.list()).toEqual([]);
    } finally {
      if (child.exitCode === null) child.kill();
      await exited;
    }
  }, 30000);

test('same result retries and concurrent consumers produce one outcome and exactly one asset effect', async () => {
  const first = service('shared'),
    second = service('shared');
  const outcome = await match(first.instance),
    [a, b] = outcome.participants;
  expect(await first.instance.record(outcome)).toEqual({ status: 'recorded', recorded: true, recoverable: true });
  expect(await second.instance.record(outcome)).toEqual({ status: 'recorded', recorded: true, recoverable: true });
  expect(
    (await db.query("SELECT id FROM outbox_events WHERE type='match.settle' AND aggregate_id=$1", [outcome.matchId]))
      .rows,
  ).toHaveLength(1);
  expect(await balance(a.userId)).toBe('300');
  await Promise.all([first.instance.drain(), second.instance.drain()]);
  expect(await settled(outcome.matchId)).toBeTruthy();
  expect(await balance(a.userId)).toBe('350');
  expect(await balance(b.userId)).toBe('320');
  expect(await rewards(outcome.matchId)).toHaveLength(2);
  expect(
    (await db.query("SELECT id FROM asset_ledger WHERE source_id=$1 AND reason='match.reward'", [outcome.matchId]))
      .rows,
  ).toHaveLength(2);
  expect(
    (await db.query('SELECT match_id FROM test_match_rating_effects WHERE match_id=$1', [outcome.matchId])).rows,
  ).toHaveLength(1);
  expect(await first.instance.record(outcome)).toEqual({ status: 'settled', recorded: true, recoverable: true });
  expect(first.journal.list()).toEqual([]);
  expect(await balance(a.userId)).toBe('350');
});

test('conflicting outcome payloads and immutable history writes are rejected without changing the payout', async () => {
  const port = service(),
    outcome = await match(port.instance);
  await port.instance.record(outcome);
  await expect(port.instance.record({ ...outcome, score: [0, 1], winner: 1 })).rejects.toBeInstanceOf(OutcomeConflict);
  await port.instance.drain();
  await expect(
    db.query("UPDATE match_outcomes SET payload_hash=repeat('b',64) WHERE match_id=$1", [outcome.matchId]),
  ).rejects.toThrow('immutable_match_outcome');
  await expect(db.query('DELETE FROM match_rewards WHERE match_id=$1', [outcome.matchId])).rejects.toThrow(
    'immutable_match_settlement_record',
  );
  expect(await balance(outcome.participants[0].userId)).toBe('350');
});

test('friend, void, forfeit, short and idle matches keep their existing zero-reward rules', async () => {
  for (const kind of ['friend', 'void', 'forfeit', 'short', 'idle']) {
    const port = service(),
      base = await match(port.instance, kind === 'friend' ? 'friend' : 'growth');
    const outcome = OutcomeIntentSchema.parse({
      ...base,
      ...(kind === 'void' ? { reason: 'abandoned', winner: -1 } : {}),
      ...(kind === 'forfeit' ? { reason: 'surrender' } : {}),
      ...(kind === 'short' ? { elapsedSeconds: 1 } : {}),
      ...(kind === 'idle' ? { finalSeq: 0, participants: base.participants.map((p) => ({ ...p, actions: 0 })) } : {}),
    });
    await port.instance.record(outcome);
    await port.instance.drain();
    expect(await settled(outcome.matchId)).toBeTruthy();
    for (const p of outcome.participants) expect(await balance(p.userId)).toBe('300');
    expect(
      (await rewards(outcome.matchId)).every((row) => !row.eligible && row.coins === '0' && row.operation_id === null),
    ).toBe(true);
  }
});

test('official rating scopes remain pending when no real rating port is available', async () => {
  const port = service('no-ratings', undefined),
    outcome = await match(port.instance);
  // The constructor's test default above is deliberately bypassed to exercise the actual absent production port.
  const missing = new MatchOutcomes({
    db,
    assets,
    policy: () => policy,
    journal: port.journal,
    onEvent: () => undefined,
  });
  opened.push(missing);
  await missing.record(outcome);
  await missing.drain();
  expect(await settled(outcome.matchId)).toBeNull();
  expect(await rewards(outcome.matchId)).toEqual([]);
  expect(await balance(outcome.participants[0].userId)).toBe('300');
  expect(
    (
      await db.query("SELECT error_code FROM outbox_events WHERE type='match.settle' AND aggregate_id=$1", [
        outcome.matchId,
      ])
    ).rows[0].error_code,
  ).toBe('rating-unavailable');
  expect(port.journal.list()).toEqual([outcome]);
});

test('a failure after wallet and ledger writes rolls the whole award back and a later retry succeeds once', async () => {
  const port = service(),
    outcome = await match(port.instance);
  await port.instance.record(outcome);
  await db.query(`CREATE FUNCTION test_fail_match_reward() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected award failure'; END $$;
    CREATE TRIGGER test_fail_match_reward BEFORE INSERT ON match_rewards FOR EACH ROW EXECUTE FUNCTION test_fail_match_reward()`);
  try {
    await port.instance.drain();
    expect(await settled(outcome.matchId)).toBeNull();
    expect(await rewards(outcome.matchId)).toEqual([]);
    for (const p of outcome.participants) expect(await balance(p.userId)).toBe('300');
    expect(
      (await db.query("SELECT id FROM asset_ledger WHERE source_id=$1 AND reason='match.reward'", [outcome.matchId]))
        .rows,
    ).toEqual([]);
  } finally {
    await db.query('DROP TRIGGER test_fail_match_reward ON match_rewards; DROP FUNCTION test_fail_match_reward()');
  }
  await db.query(
    "UPDATE outbox_events SET next_attempt_at=clock_timestamp() WHERE type='match.settle' AND aggregate_id=$1",
    [outcome.matchId],
  );
  await port.instance.drain();
  expect(await settled(outcome.matchId)).toBeTruthy();
  expect(await balance(outcome.participants[0].userId)).toBe('350');
  expect(port.journal.list()).toEqual([]);
});

test('concurrent matches share one daily cap and one participation card; progress carries to the next day', async () => {
  const port = service(),
    owners: [string, string] = [await owner(), await owner()];
  const matches = await Promise.all(Array.from({ length: 8 }, () => match(port.instance, 'growth', owners)));
  await Promise.all(matches.map((outcome) => port.instance.record(outcome)));
  await Promise.all([port.instance.drain(), service().instance.drain()]);
  expect(await balance(owners[0])).toBe('600');
  expect(await balance(owners[1])).toBe('460');
  expect(
    (await db.query('SELECT * FROM match_rewards WHERE user_id=$1 AND player_def_id IS NOT NULL', [owners[0]])).rows,
  ).toHaveLength(1);
  const carry: [string, string] = [await owner(), await owner()];
  for (let i = 0; i < 2; i++) {
    const value = await match(port.instance, 'growth', carry);
    await port.instance.record(value);
    await port.instance.drain();
  }
  const next = await match(port.instance, 'growth', carry, '2026-11-19T05:00:00.000Z');
  await port.instance.record(next);
  await port.instance.drain();
  const earned = (await rewards(next.matchId)).find((row) => row.user_id === carry[0])!;
  expect(earned.player_def_id).toBeTruthy();
  expect(earned.fragments).toBe(quoteDuplicateFragments(policy, DEFAULT_DATA.players[earned.player_def_id]).toString());
});

test('settlement uses its pinned economy even if the current policy changes before consumption', async () => {
  let current = policy;
  const port = service('pinned', ratingTransaction, () => current),
    outcome = await match(port.instance);
  await port.instance.record(outcome);
  current = { ...policy, version: 'economy-test-new', matchRewards: { ...policy.matchRewards, win: '999' } };
  await port.instance.drain();
  expect(await balance(outcome.participants[0].userId)).toBe('350');
});

for (const [table, operation, condition] of [
  ['wallets', 'BEFORE UPDATE', 'true'],
  ['asset_ledger', 'AFTER INSERT', "NEW.reason='match.reward'"],
  ['asset_operations', 'AFTER INSERT', "NEW.reason='match.reward'"],
  ['match_outcomes', 'BEFORE UPDATE', 'NEW.settled_at IS NOT NULL'],
  ['outbox_events', 'BEFORE UPDATE', "NEW.type='match.settle' AND NEW.processed_at IS NOT NULL"],
])
  test(`a settlement failure at ${table} preserves the result and rolls back every effect`, async () => {
    const port = service(),
      outcome = await match(port.instance);
    await port.instance.record(outcome);
    // All identifiers/conditions below are fixture constants, never player input.
    await db.query(`CREATE FUNCTION net04_fail_boundary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected boundary failure'; END $$;
    CREATE TRIGGER net04_fail_boundary ${operation} ON ${table} FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION net04_fail_boundary()`);
    try {
      await port.instance.drain();
      expect(await rewards(outcome.matchId)).toHaveLength(0);
      expect(await settled(outcome.matchId)).toBeNull();
      expect(await balance(outcome.participants[0].userId)).toBe('300');
      expect(
        (await db.query('SELECT recovery_closed_at FROM matches WHERE id=$1', [outcome.matchId])).rows[0]
          .recovery_closed_at,
      ).toBeNull();
      expect(
        (await db.query("SELECT * FROM asset_ledger WHERE reason='match.reward' AND source_id=$1", [outcome.matchId]))
          .rows,
      ).toHaveLength(0);
      expect(port.journal.read(outcome.matchId)).toEqual(outcome);
    } finally {
      await db.query(`DROP TRIGGER net04_fail_boundary ON ${table}; DROP FUNCTION net04_fail_boundary()`);
    }
    await db.query(
      "UPDATE outbox_events SET next_attempt_at=clock_timestamp() WHERE type='match.settle' AND aggregate_id=$1",
      [outcome.matchId],
    );
    await port.instance.drain();
    expect(await settled(outcome.matchId)).toBeTruthy();
    expect(await balance(outcome.participants[0].userId)).toBe('350');
  });

test('a conflicting queued hash is parked with its evidence, and exhausted retries report failure without deleting results', async () => {
  const port = service(),
    outcome = await match(port.instance);
  await port.instance.record(outcome);
  const receipts: string[] = [];
  port.instance.subscribe(outcome.matchId, (receipt) => receipts.push(receipt.status));
  await db.query("UPDATE outbox_events SET payload=$2 WHERE type='match.settle' AND aggregate_id=$1", [
    outcome.matchId,
    JSON.stringify({ payloadHash: '0'.repeat(64) }),
  ]);
  await port.instance.drain();
  const event = (
    await db.query(
      "SELECT attempts,error_code,processed_at FROM outbox_events WHERE type='match.settle' AND aggregate_id=$1",
      [outcome.matchId],
    )
  ).rows[0];
  expect(event).toMatchObject({ attempts: 12, error_code: 'outcome-conflict', processed_at: null });
  expect(receipts.at(-1)).toBe('failed');
  expect(port.journal.read(outcome.matchId)).toEqual(outcome);
  expect(await settled(outcome.matchId)).toBeNull();
  expect(await rewards(outcome.matchId)).toHaveLength(0);
  const before = event.attempts;
  await port.instance.drain();
  expect(
    (
      await db.query("SELECT attempts FROM outbox_events WHERE type='match.settle' AND aggregate_id=$1", [
        outcome.matchId,
      ])
    ).rows[0].attempts,
  ).toBe(before);
});

test('a journal import reaching its retry bound notifies failure and preserves the only durable candidate', async () => {
  const port = service(),
    outcome = await match(port.instance),
    receipts: string[] = [];
  port.instance.subscribe(outcome.matchId, (receipt) => receipts.push(receipt.status));
  await db.query(`CREATE FUNCTION net04_fail_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected import failure'; END $$;
    CREATE TRIGGER net04_fail_import BEFORE INSERT ON match_outcomes FOR EACH ROW EXECUTE FUNCTION net04_fail_import()`);
  try {
    expect(await port.instance.record(outcome)).toEqual({ status: 'pending', recorded: false, recoverable: true });
    for (let i = 0; i < 11; i++) port.journal.defer(outcome.matchId, 'storage-unavailable', 0);
    await port.instance.drain();
    expect(port.journal.retry(outcome.matchId).attempts).toBe(12);
    expect(receipts.at(-1)).toBe('failed');
    expect(port.journal.read(outcome.matchId)).toEqual(outcome);
    expect(await settled(outcome.matchId)).toBeUndefined();
    await port.instance.drain();
    expect(port.journal.retry(outcome.matchId).attempts).toBe(12);
  } finally {
    await db.query('DROP TRIGGER net04_fail_import ON match_outcomes; DROP FUNCTION net04_fail_import()');
  }
});

test('a full journal still permits durable database delivery without any memory-only acceptance', async () => {
  const port = service(),
    outcome = await match(port.instance);
  const journal = new OutcomeJournal(path.join(root, `full-${randomUUID()}`), 0);
  const databaseOnly = new MatchOutcomes({
    db,
    assets,
    policy: () => policy,
    journal,
    ratings: ratingTransaction,
    onEvent: () => undefined,
  });
  opened.push(databaseOnly);
  expect(await databaseOnly.record(outcome)).toEqual({ status: 'recorded', recorded: true, recoverable: true });
  await databaseOnly.drain();
  expect(await settled(outcome.matchId)).toBeTruthy();
  expect(await balance(outcome.participants[0].userId)).toBe('350');
  expect(journal.list()).toEqual([]);
});

test('an eligible banned participant prevents a partial payout; a verified retry commits both participants once', async () => {
  const port = service(),
    outcome = await match(port.instance),
    [a, b] = outcome.participants;
  await port.instance.record(outcome);
  await db.query("UPDATE users SET status='banned',banned_at=clock_timestamp() WHERE id=$1", [b.userId]);
  await port.instance.drain();
  expect(await rewards(outcome.matchId)).toHaveLength(0);
  expect(await balance(a.userId)).toBe('300');
  expect(await balance(b.userId)).toBe('300');
  expect(
    (
      await db.query("SELECT error_code FROM outbox_events WHERE type='match.settle' AND aggregate_id=$1", [
        outcome.matchId,
      ])
    ).rows[0].error_code,
  ).toBe('account-restricted');
  await db.query("UPDATE users SET status='active',banned_at=NULL WHERE id=$1", [b.userId]);
  await db.query(
    "UPDATE outbox_events SET next_attempt_at=clock_timestamp() WHERE type='match.settle' AND aggregate_id=$1",
    [outcome.matchId],
  );
  await port.instance.drain();
  expect(await settled(outcome.matchId)).toBeTruthy();
  expect(await balance(a.userId)).toBe('350');
  expect(await balance(b.userId)).toBe('320');
});
