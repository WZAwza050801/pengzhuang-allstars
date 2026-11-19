import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Database, migrateDatabase } from '@pengzhuang/persistence';
import { readRuntimeConfig } from '../config/runtime';
import { DataAudit } from '../server/maintenance/audit';
import { createDataFixture } from './helpers/data-factory';
import { DataRepairs } from '../server/maintenance/repairs';
import { repairHash } from '../server/maintenance/repair-plan';

let db: Database, fixture: Awaited<ReturnType<typeof createDataFixture>>, audit: DataAudit, repairs: DataRepairs;
beforeAll(async () => {
  const config = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
  if (!config.databaseUrl || !process.env.PG_TEST_TMP_DIR) throw new Error('Isolated PostgreSQL required');
  db = new Database({ connectionString: config.databaseUrl });
  fixture = await createDataFixture(db);
  await migrateDatabase(db);
  audit = new DataAudit(db);
  repairs = new DataRepairs(db, fixture.assets);
});
afterAll(async () => {
  await fixture?.close();
  await db?.close();
});

test('read-only audit verifies real starter history and leaves an uninitialized account untouched', async () => {
  const userId = await fixture.owner();
  const before = (await db.query('SELECT count(*)::text AS count FROM outbox_events')).rows[0].count;
  const result = await audit.user(userId);
  expect(result.findings).toEqual([]);
  expect(result.wallets.map((wallet) => [wallet.currency, wallet.balance, wallet.ledgerTotal])).toEqual([
    ['coins', '300', '300'],
    ['fragments', '0', '0'],
  ]);
  expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  const empty = await fixture.owner(false);
  expect(await audit.user(empty)).toMatchObject({ initialized: false, wallets: [], findings: [] });
  expect((await db.query('SELECT * FROM account_initializations WHERE user_id=$1', [empty])).rowCount).toBe(0);
  expect((await db.query('SELECT count(*)::text AS count FROM outbox_events')).rows[0].count).toBe(before);
});

test('audit locates a wallet projection mismatch without changing wallets or append-only history', async () => {
  const userId = await fixture.owner();
  await db.query("UPDATE wallets SET balance=777 WHERE user_id=$1 AND currency='coins'", [userId]);
  const result = await audit.user(userId);
  expect(result.findings).toContainEqual({
    code: 'wallet-balance-mismatch',
    subject: `${userId}:coins`,
    expected: '300',
    actual: '777',
  });
  expect(
    (await db.query("SELECT balance::text FROM wallets WHERE user_id=$1 AND currency='coins'", [userId])).rows[0]
      .balance,
  ).toBe('777');
  expect(
    (await db.query('SELECT count(*)::text AS count FROM asset_ledger WHERE user_id=$1', [userId])).rows[0].count,
  ).toBe('2');
});

test('projection restoration appends a zero-delta checkpoint and replays its original receipt without reverting later transactions', async () => {
  const userId = await fixture.owner();
  const old = (
    await db.query('SELECT id,delta::text,balance_after::text FROM asset_ledger WHERE user_id=$1 ORDER BY id', [userId])
  ).rows;
  await db.query("UPDATE wallets SET balance=777 WHERE user_id=$1 AND currency='coins'", [userId]);
  const draft = await repairs.prepare({
    kind: 'restore-wallet',
    userId,
    currency: 'coins',
    caseId: 'DAT06-PROJECTION',
    reason: 'Restore the verified ledger projection',
  });
  expect(draft.plan.preview).toMatchObject({
    beforeBalance: '777',
    afterBalance: '300',
    adjustmentDelta: '-477',
    ledgerDelta: '0',
  });
  const receipt = await repairs.apply(draft.plan, draft.sha256);
  expect(receipt.effect).toMatchObject({ afterBalance: '300', ledgerDelta: '0', adjustmentDelta: '-477' });
  expect((await audit.user(userId)).findings).toEqual([]);
  expect(
    (
      await db.query(
        'SELECT id,delta::text,balance_after::text FROM asset_ledger WHERE id=ANY($1::uuid[]) ORDER BY id',
        [old.map((r) => r.id)],
      )
    ).rows,
  ).toEqual(old);
  await fixture.assets.grantTrusted({
    userId,
    operationId: randomUUID(),
    sourceId: randomUUID(),
    reason: 'admin.correction',
    coins: '10',
    fragments: '0',
    playerDefIds: [],
  });
  expect(await repairs.apply(draft.plan, draft.sha256)).toEqual(receipt);
  expect((await audit.user(userId)).wallets[0].balance).toBe('310');
  expect((await db.query('SELECT * FROM data_repair_receipts WHERE id=$1', [draft.plan.id])).rowCount).toBe(1);
  await expect(db.query('DELETE FROM data_repair_receipts WHERE id=$1', [draft.plan.id])).rejects.toThrow(
    'append-only',
  );
});

test('concurrent compensation credits once with exact bigint precision and stable case ownership', async () => {
  const userId = await fixture.owner();
  const draft = await repairs.prepare({
    kind: 'compensate',
    userId,
    currency: 'coins',
    delta: '9007199254740993',
    caseId: 'DAT06-EXACT',
    reason: 'Explicit reviewed in-game compensation fixture',
  });
  const receipts = await Promise.all(Array.from({ length: 6 }, () => repairs.apply(draft.plan, draft.sha256)));
  expect(new Set(receipts.map((receipt) => receipt.id)).size).toBe(1);
  expect((await audit.user(userId)).wallets[0]).toMatchObject({
    balance: '9007199254741293',
    ledgerTotal: '9007199254741293',
  });
  expect((await db.query('SELECT * FROM asset_operations WHERE user_id=$1', [userId])).rowCount).toBe(1);
  await expect(repairs.prepare({ ...draft.plan.command })).rejects.toMatchObject({ code: 'CONFLICT' });
  const changed = { ...draft.plan, command: { ...draft.plan.command, delta: '1' } };
  await expect(repairs.apply(changed, repairHash(changed))).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('stale snapshots, a different database, changed previews and missing reviewed hashes cannot write', async () => {
  const userId = await fixture.owner();
  const draft = await repairs.prepare({
    kind: 'compensate',
    userId,
    currency: 'coins',
    delta: '25',
    caseId: 'DAT06-STALE',
    reason: 'Verify the review and stale-state boundary',
  });
  await expect(repairs.apply(draft.plan, '')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  const foreign = { ...draft.plan, database: 'another_database' };
  await expect(repairs.apply(foreign, repairHash(foreign))).rejects.toMatchObject({ code: 'CONFLICT' });
  const forged = { ...draft.plan, preview: { ...draft.plan.preview, afterBalance: '999' } };
  await expect(repairs.apply(forged, repairHash(forged))).rejects.toMatchObject({ code: 'CONFLICT' });
  await fixture.assets.grantTrusted({
    userId,
    operationId: randomUUID(),
    sourceId: randomUUID(),
    reason: 'admin.correction',
    coins: '1',
    fragments: '0',
    playerDefIds: [],
  });
  await expect(repairs.apply(draft.plan, draft.sha256)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await audit.user(userId)).wallets[0].balance).toBe('301');
  expect((await db.query('SELECT * FROM data_repair_receipts WHERE id=$1', [draft.plan.id])).rowCount).toBe(0);
});

test('a failure recording the repair rolls back assets, ledger, receipt and outbox before the same plan retries', async () => {
  const userId = await fixture.owner();
  const draft = await repairs.prepare({
    kind: 'compensate',
    userId,
    currency: 'fragments',
    delta: '7',
    caseId: 'DAT06-ROLLBACK',
    reason: 'Verify complete transaction rollback',
  });
  await db.query(
    "CREATE FUNCTION dat06_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'dat06-injected'; END $$; CREATE TRIGGER dat06_fail_receipt BEFORE INSERT ON data_repair_receipts FOR EACH ROW EXECUTE FUNCTION dat06_fail_receipt()",
  );
  try {
    await expect(repairs.apply(draft.plan, draft.sha256)).rejects.toThrow('dat06-injected');
  } finally {
    await db.query('DROP TRIGGER dat06_fail_receipt ON data_repair_receipts; DROP FUNCTION dat06_fail_receipt()');
  }
  expect((await audit.user(userId)).wallets[1].balance).toBe('0');
  expect((await db.query('SELECT * FROM asset_operations WHERE user_id=$1', [userId])).rowCount).toBe(0);
  expect(
    (await db.query("SELECT * FROM outbox_events WHERE type='data.repaired' AND aggregate_id=$1", [userId])).rowCount,
  ).toBe(0);
  expect((await repairs.apply(draft.plan, draft.sha256)).effect).toMatchObject({ afterBalance: '7' });
});

test('negative compensation cannot overdraw and projection restoration refuses inconsistent historical balances', async () => {
  const userId = await fixture.owner();
  await expect(
    repairs.prepare({
      kind: 'compensate',
      userId,
      currency: 'coins',
      delta: '-301',
      caseId: 'DAT06-DEBIT',
      reason: 'Insufficient funds must not partially apply',
    }),
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  await db.query(
    "INSERT INTO asset_ledger(user_id,currency,delta,balance_after,reason,source_id,idempotency_key,payload_hash) VALUES ($1,'coins',5,999,'injected.fixture','fixture','fixture',repeat('0',64))",
    [userId],
  );
  expect((await audit.user(userId)).findings.some((finding) => finding.code === 'ledger-chain-mismatch')).toBe(true);
  await expect(
    repairs.prepare({
      kind: 'restore-wallet',
      userId,
      currency: 'coins',
      caseId: 'DAT06-UNTRUSTED',
      reason: 'Conflicting history needs independent evidence',
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('arithmetically balanced but unreferenced ledger entries are unsafe compensation evidence', async () => {
  const userId = await fixture.owner();
  await db.query(
    "INSERT INTO asset_ledger(user_id,currency,delta,balance_after,reason,source_id,idempotency_key,payload_hash) VALUES ($1,'coins',5,305,'injected.fixture','untracked','untracked',repeat('0',64))",
    [userId],
  );
  await db.query("UPDATE wallets SET balance=305,version=1 WHERE user_id=$1 AND currency='coins'", [userId]);
  const result = await audit.user(userId);
  expect(result.findings.some((finding) => finding.code === 'ledger-reference-invalid')).toBe(true);
  await expect(
    repairs.prepare({
      kind: 'compensate',
      userId,
      currency: 'coins',
      delta: '5',
      caseId: 'DAT06-LINK',
      reason: 'Broken provenance must be investigated',
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('a repair cannot adopt an older asset receipt while claiming a new financial effect', async () => {
  const userId = await fixture.owner(),
    operationId = randomUUID();
  await fixture.assets.grantTrusted({
    userId,
    operationId,
    sourceId: 'repair:DAT06-LEGACY:coins',
    reason: 'admin.correction',
    coins: '25',
    fragments: '0',
    playerDefIds: [],
  });
  const draft = await repairs.prepare({
    kind: 'compensate',
    userId,
    currency: 'coins',
    delta: '25',
    caseId: 'DAT06-LEGACY',
    reason: 'Reject a colliding prior operation identifier',
  });
  const colliding = { ...draft.plan, id: operationId };
  await expect(repairs.apply(colliding, repairHash(colliding))).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await audit.user(userId)).wallets[0].balance).toBe('325');
  expect((await db.query('SELECT * FROM data_repair_receipts WHERE id=$1', [operationId])).rowCount).toBe(0);
});

test('match auditing detects exhausted settlement and rewards resume through the original consumer only once', async () => {
  const { outcome, worker, owners } = await fixture.outcome('growth');
  await worker.record(outcome);
  await worker.drain();
  await db.query(
    "UPDATE outbox_events SET attempts=12,error_code='rating-unavailable' WHERE type='match.settle' AND aggregate_id=$1",
    [outcome.matchId],
  );
  const report = await audit.match(outcome.matchId);
  expect(report.findings.some((finding) => finding.code === 'settlement-exhausted')).toBe(true);
  const draft = await repairs.prepare({
    kind: 'retry-settlement',
    matchId: outcome.matchId,
    caseId: 'DAT06-REQUEUE',
    reason: 'Dependency fixed; retry the original durable intent',
  });
  const original = (
    await db.query('SELECT payload,payload_hash FROM match_outcomes WHERE match_id=$1', [outcome.matchId])
  ).rows[0];
  await Promise.all(Array.from({ length: 4 }, () => repairs.apply(draft.plan, draft.sha256)));
  await db.query('CREATE TABLE dat06_rating_effects(match_id uuid PRIMARY KEY)');
  // A real SQL transaction marker tests atomicity; it is not MM-02 Elo or a production binding.
  const consumer = fixture.consumer({
    async applyInTransaction(tx, intent) {
      await tx.query('INSERT INTO dat06_rating_effects(match_id) VALUES ($1)', [intent.matchId]);
    },
  });
  await consumer.drain();
  await consumer.drain();
  const settledEvent = (
    await db.query("SELECT attempts,processed_at FROM outbox_events WHERE type='match.settle' AND aggregate_id=$1", [
      outcome.matchId,
    ])
  ).rows[0];
  await repairs.apply(draft.plan, draft.sha256);
  expect(
    (
      await db.query("SELECT attempts,processed_at FROM outbox_events WHERE type='match.settle' AND aggregate_id=$1", [
        outcome.matchId,
      ])
    ).rows[0],
  ).toEqual(settledEvent);
  expect((await audit.match(outcome.matchId)).findings).toEqual([]);
  expect((await audit.user(owners[0])).wallets[0].balance).toBe('350');
  expect(
    (await db.query('SELECT payload,payload_hash FROM match_outcomes WHERE match_id=$1', [outcome.matchId])).rows[0],
  ).toEqual(original);
  expect((await db.query('SELECT * FROM match_rewards WHERE match_id=$1', [outcome.matchId])).rowCount).toBe(2);
  expect((await db.query('SELECT * FROM dat06_rating_effects WHERE match_id=$1', [outcome.matchId])).rowCount).toBe(1);
  expect(
    (
      await db.query("SELECT * FROM asset_operations WHERE user_id=$1 AND reason='match.reward' AND source_id=$2", [
        owners[0],
        outcome.matchId,
      ])
    ).rowCount,
  ).toBe(1);
  await expect(
    repairs.prepare({
      kind: 'retry-settlement',
      matchId: outcome.matchId,
      caseId: 'DAT06-SETTLED',
      reason: 'A completed match must never be queued again',
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('paged audits cover each current identifier once and reject invalid cursors or unbounded limits', async () => {
  for (const table of ['users', 'matches'] as const) {
    const expected = (await db.query<{ id: string }>(`SELECT id FROM ${table} ORDER BY id`)).rows.map((row) => row.id);
    const found: string[] = [];
    let after: string | undefined;
    do {
      const page = await audit[table]({ after, limit: 7 });
      expect(page).toMatchObject({ database: 'pengzhuang_test', scope: table, limit: 7 });
      expect(page.snapshotAt).toMatch(/Z$/);
      expect(page.items.length).toBeLessThanOrEqual(7);
      found.push(...page.items.map((item) => ('userId' in item ? item.userId : item.matchId)));
      after = page.nextCursor ?? undefined;
    } while (after);
    expect(found).toEqual(expected);
  }
  expect(() => audit.users({ limit: 101 })).toThrow();
  expect(() => audit.matches({ after: 'invalid' })).toThrow();
});

test('valid negative compensation appends a debit and records the actual SQL principal', async () => {
  const userId = await fixture.owner();
  const draft = await repairs.prepare({
    kind: 'compensate',
    userId,
    currency: 'coins',
    delta: '-25',
    caseId: 'DAT06-DEBIT',
    reason: 'Approved correction',
  });
  const receipt = await repairs.apply(draft.plan, draft.sha256);
  const principal = (await db.query('SELECT session_user::text AS "sessionUser",current_user::text AS "effectiveRole"'))
    .rows[0];
  expect(receipt).toMatchObject({ ...principal, effect: { ledgerDelta: '-25', afterBalance: '275' } });
  expect((await audit.user(userId)).findings).toEqual([]);
  expect(
    (await db.query('SELECT delta::text,reason FROM asset_ledger WHERE id=ANY($1::uuid[])', [receipt.effect.ledgerIds]))
      .rows,
  ).toEqual([{ delta: '-25', reason: 'admin.correction' }]);
  await db.query("UPDATE users SET status='banned',banned_at=clock_timestamp() WHERE id=$1", [userId]);
  await expect(repairs.prepare({ ...draft.plan.command, caseId: 'DAT06-BANNED' })).rejects.toMatchObject({
    code: 'CONFLICT',
  });
  const activeId = await fixture.owner();
  await expect(
    repairs.prepare({
      ...draft.plan.command,
      userId: activeId,
      caseId: 'DAT06-OVERFLOW',
      delta: '9223372036854775807',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
});

test('settlement plans reject a stale queue, authoritative hash conflicts and partial effects', async () => {
  const { outcome, worker, owners } = await fixture.outcome('growth');
  await worker.record(outcome);
  await worker.drain();
  const command = {
    kind: 'retry-settlement',
    matchId: outcome.matchId,
    caseId: 'DAT06-RETRY-GUARDS',
    reason: 'Guard verification',
  };
  const draft = await repairs.prepare(command);
  await db.query("UPDATE outbox_events SET attempts=attempts+1 WHERE type='match.settle' AND aggregate_id=$1", [
    outcome.matchId,
  ]);
  await expect(repairs.apply(draft.plan, draft.sha256)).rejects.toMatchObject({ code: 'CONFLICT' });
  await db.query(
    "UPDATE outbox_events SET payload=jsonb_set(payload,'{payloadHash}',to_jsonb(repeat('f',64))) WHERE type='match.settle' AND aggregate_id=$1",
    [outcome.matchId],
  );
  await expect(repairs.prepare(command)).rejects.toMatchObject({ code: 'CONFLICT' });
  const original = (await db.query('SELECT payload_hash FROM match_outcomes WHERE match_id=$1', [outcome.matchId]))
    .rows[0].payload_hash;
  await db.query(
    "UPDATE outbox_events SET payload=jsonb_set(payload,'{payloadHash}',to_jsonb($2::text)) WHERE type='match.settle' AND aggregate_id=$1",
    [outcome.matchId, original],
  );
  await fixture.assets.grantTrusted({
    userId: owners[0],
    operationId: randomUUID(),
    sourceId: outcome.matchId,
    reason: 'match.reward',
    coins: '1',
    fragments: '0',
    playerDefIds: [],
  });
  expect((await audit.match(outcome.matchId)).findings.some((f) => f.code === 'settlement-partial-effects')).toBe(true);
  await expect(repairs.prepare(command)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await db.query('SELECT * FROM data_repair_receipts WHERE match_id=$1', [outcome.matchId])).rowCount).toBe(0);
});

test('fixture creation refuses a wrong runner marker before any writes', async () => {
  const before = (await db.query('SELECT count(*)::text AS count FROM users')).rows[0];
  const marker = process.env.PG_TEST_RUN_ID;
  try {
    process.env.PG_TEST_RUN_ID = randomUUID();
    await expect(createDataFixture(db)).rejects.toThrow('Refusing non-fixture database');
  } finally {
    process.env.PG_TEST_RUN_ID = marker;
  }
  expect((await db.query('SELECT count(*)::text AS count FROM users')).rows[0]).toEqual(before);
});

const executeFile = promisify(execFile);
async function cli(args: string[], databaseUrl = process.env.TEST_DATABASE_URL!) {
  try {
    const output = await executeFile(process.execPath, ['--import', 'tsx', 'tools/data-maintenance.ts', ...args], {
      env: { ...process.env, MAINTENANCE_DATABASE_URL: databaseUrl },
      timeout: 20000,
      maxBuffer: 1048576,
    });
    return { code: 0, ...output };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    if (typeof failed.code !== 'number') throw error;
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}
test('the real command audits, exclusively writes a reviewed plan, applies once and rejects changed intent without leaking credentials', async () => {
  const userId = await fixture.owner();
  await db.query("UPDATE wallets SET balance=777 WHERE user_id=$1 AND currency='coins'", [userId]);
  const report = await cli(['audit-user', '--user', userId]);
  expect(report.code).toBe(2);
  expect(JSON.parse(report.stdout).findings[0].code).toBe('wallet-balance-mismatch');
  const file = path.join(process.env.PG_TEST_TMP_DIR!, `dat06-plan-${randomUUID()}.json`);
  const args = [
    'prepare',
    '--kind',
    'restore-wallet',
    '--case',
    'DAT06-CLI',
    '--reason',
    'Restore verified projection',
    '--user',
    userId,
    '--currency',
    'coins',
    '--out',
    file,
  ];
  const prepared = await cli(args);
  expect(prepared.code).toBe(0);
  const original = await readFile(file, 'utf8'),
    draft = JSON.parse(original);
  expect(JSON.parse(prepared.stdout).sha256).toBe(draft.sha256);
  expect((await cli(args)).code).toBe(1);
  expect(await readFile(file, 'utf8')).toBe(original);
  expect((await cli(['apply', '--file', file])).code).toBe(1);
  expect((await cli(['apply', '--file', file, '--sha256', '0'.repeat(64)])).code).toBe(1);
  const first = await cli(['apply', '--file', file, '--sha256', draft.sha256]);
  expect(first.code).toBe(0);
  const replay = await cli(['apply', '--file', file, '--sha256', draft.sha256]);
  expect(replay.code).toBe(0);
  expect(JSON.parse(replay.stdout)).toEqual(JSON.parse(first.stdout));
  draft.plan.command.reason = 'Changed after review';
  await writeFile(file, JSON.stringify(draft));
  expect((await cli(['apply', '--file', file, '--sha256', draft.sha256])).code).toBe(1);
  expect((await cli(['audit-user', '--user', userId])).code).toBe(0);
  const page = await cli(['audit-users', '--limit', '2']);
  expect([0, 2]).toContain(page.code);
  expect(JSON.parse(page.stdout).items).toHaveLength(2);
  for (const flags of [
    ['--user', userId, '--role', 'admin'],
    ['--user', userId, '--user', userId],
  ]) {
    const rejected = await cli(['audit-user', ...flags]);
    expect(rejected.code).toBe(1);
    expect(rejected.stderr).not.toContain(process.env.TEST_DATABASE_URL!);
  }
  const secret = 'do-not-print-this-password';
  const rejected = await cli(['audit-user', '--user', userId], `postgresql://operator:${secret}@127.0.0.1:1/db`);
  expect(rejected.code).toBe(1);
  expect(rejected.stderr + rejected.stdout).not.toContain(secret);
}, 30000);

test('a real read-only SQL role can audit but cannot apply a repair', async () => {
  const role = 'dat06_reader',
    userId = await fixture.owner();
  await db.query("CREATE ROLE dat06_reader LOGIN PASSWORD 'isolated-fixture-only'");
  await db.query('GRANT USAGE ON SCHEMA public TO dat06_reader');
  await db.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO dat06_reader');
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.username = role;
  url.password = 'isolated-fixture-only';
  try {
    expect((await cli(['audit-user', '--user', userId], url.href)).code).toBe(0);
    const file = path.join(process.env.PG_TEST_TMP_DIR!, `dat06-readonly-${randomUUID()}.json`);
    expect(
      (
        await cli(
          [
            'prepare',
            '--kind',
            'compensate',
            '--case',
            'DAT06-READONLY',
            '--reason',
            'Read-only boundary',
            '--user',
            userId,
            '--currency',
            'fragments',
            '--delta',
            '5',
            '--out',
            file,
          ],
          url.href,
        )
      ).code,
    ).toBe(0);
    const draft = JSON.parse(await readFile(file, 'utf8'));
    const denied = await cli(['apply', '--file', file, '--sha256', draft.sha256], url.href);
    expect(denied.code).toBe(1);
    expect(JSON.parse(denied.stderr).error.code).toBe('FORBIDDEN');
    expect((await audit.user(userId)).wallets[1].balance).toBe('0');
    expect((await db.query('SELECT * FROM data_repair_receipts WHERE id=$1', [draft.plan.id])).rowCount).toBe(0);
  } finally {
    await db.query('REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM dat06_reader');
    await db.query('REVOKE USAGE ON SCHEMA public FROM dat06_reader');
    await db.query('DROP ROLE dat06_reader');
  }
}, 30000);

test('orphan and reward mismatch audits expose evidence without rewriting immutable rewards', async () => {
  const { outcome, worker } = await fixture.outcome();
  await worker.record(outcome);
  await worker.drain();
  expect((await audit.match(outcome.matchId)).findings).toEqual([]);
  const original = (await db.query('SELECT * FROM match_rewards WHERE match_id=$1 ORDER BY user_id', [outcome.matchId]))
    .rows;
  const missing = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query('SET LOCAL session_replication_role=replica');
    await tx.query('UPDATE match_rewards SET coins=9,ledger_ids=ARRAY[$2::uuid] WHERE match_id=$1 AND user_id=$3', [
      outcome.matchId,
      missing,
      original[0].user_id,
    ]);
  });
  try {
    expect(
      (await audit.match(outcome.matchId)).findings.some((finding) => finding.code === 'reward-ledger-mismatch'),
    ).toBe(true);
    const orphans = await audit.orphans();
    expect(
      orphans.findings.some(
        (finding) => finding.code === 'orphan-reward-ledger' && finding.examples.includes(outcome.matchId),
      ),
    ).toBe(true);
    const after = (
      await db.query('SELECT coins::text,ledger_ids FROM match_rewards WHERE match_id=$1 AND user_id=$2', [
        outcome.matchId,
        original[0].user_id,
      ])
    ).rows[0];
    expect(after).toEqual({ coins: '9', ledger_ids: [missing] });
  } finally {
    await db.transaction(async (tx) => {
      await tx.query('SET LOCAL session_replication_role=replica');
      await tx.query('UPDATE match_rewards SET coins=$3,ledger_ids=$4 WHERE match_id=$1 AND user_id=$2', [
        outcome.matchId,
        original[0].user_id,
        original[0].coins,
        original[0].ledger_ids,
      ]);
    });
  }
});
