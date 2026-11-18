import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Database, migrateDatabase, type SqlExecutor } from '@pengzhuang/persistence';
import { createDataFixture } from './helpers/data-factory';
import { Sessions } from '../server/accounts/sessions';
import { Lineups } from '../server/accounts/lineups';
import { MatchmakingQueue } from '../server/matches/matchmaking';
import { DEFAULT_DATA, type GameData } from '../shared/data';
import { MATCHMAKING_POLICY } from '../config/matchmaking';
import { QueueStatusSchema, type QueueRating } from '../packages/contracts/src/matchmaking';

let db: Database, fixture: Awaited<ReturnType<typeof createDataFixture>>, sessions: Sessions, lineups: Lineups;
beforeAll(async () => {
  db = new Database({ connectionString: process.env.TEST_DATABASE_URL! });
  fixture = await createDataFixture(db);
  await migrateDatabase(db);
  sessions = new Sessions(
    db,
    randomBytes(32).toString('base64url'),
    'http://localhost:2567',
    fixture.players.initialize,
  );
  lineups = new Lineups(db, fixture.players.initialize, () => DEFAULT_DATA);
});
afterAll(async () => {
  await fixture?.close();
  await db?.close();
});
async function owner() {
  const userId = await fixture.owner();
  const credentials = await db.transaction((tx) => sessions.issue(tx, userId, randomBytes(32).toString('base64url')));
  const principal = await sessions.authenticate(credentials.accessToken);
  const lineup = (await lineups.list(principal, {})).lineups[0];
  return { principal, lineup };
}
const command = (user: Awaited<ReturnType<typeof owner>>, extra: Record<string, unknown> = {}) => ({
  intentId: randomUUID(),
  mode: 'friend',
  protocol: 2,
  lineupId: user.lineup.id,
  expectedRevision: user.lineup.revision,
  configVersion: DEFAULT_DATA.version,
  region: 'local',
  ...extra,
});
function queue(extra: Partial<Omit<ConstructorParameters<typeof MatchmakingQueue>[0], 'db' | 'lineups'>> = {}) {
  return new MatchmakingQueue({ db, lineups, resolveData: () => DEFAULT_DATA, hostId: randomUUID(), ...extra });
}

test('one user has one active queue across instances and repeated intent returns the original entry', async () => {
  const a = await owner(),
    hostId = randomUUID(),
    first = queue({ hostId }),
    second = queue({ hostId });
  const input = command(a);
  const entries = await Promise.all(
    Array.from({ length: 6 }, (_, i) => (i % 2 ? first : second).enqueue(a.principal, input)),
  );
  expect(new Set(entries.map((value) => value.entry!.id)).size).toBe(1);
  expect(QueueStatusSchema.safeParse(entries[0]).success).toBe(true);
  await expect(second.enqueue(a.principal, command(a))).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(first.enqueue(a.principal, { ...input, region: 'west' })).rejects.toMatchObject({ code: 'CONFLICT' });
  const count = await db.query('SELECT count(*)::text AS n FROM matchmaking_entries WHERE user_id=$1', [
    a.principal.userId,
  ]);
  expect(count.rows[0].n).toBe('1');
});

test('cancelled intent stays cancelled on retry and a fresh intent may join', async () => {
  const a = await owner(),
    service = queue(),
    input = command(a);
  const entry = (await service.enqueue(a.principal, input)).entry!;
  expect((await service.cancel(a.principal, entry.id)).entry?.state).toBe('cancelled');
  expect((await service.enqueue(a.principal, input)).entry).toMatchObject({ id: entry.id, state: 'cancelled' });
  expect((await service.enqueue(a.principal, command(a))).entry!.id).not.toBe(entry.id);
});

test('cancel versus successful pairing has exactly one winner and never allocates a second assignment', async () => {
  const [a, b] = await Promise.all([owner(), owner()]),
    service = queue();
  const ae = (await service.enqueue(a.principal, command(a))).entry!;
  await service.enqueue(b.principal, command(b));
  const [cancelled, pair] = await Promise.all([service.cancel(a.principal, ae.id), service.pair('ABCDEF')]);
  const current = (await service.get(a.principal, ae.id)).entry!;
  if (cancelled.entry!.state === 'cancelled') {
    expect(pair).toBeNull();
    expect(current.state).toBe('cancelled');
  } else {
    expect(current.state).toBe('matched');
    expect(current.assignment!.id).toBe(pair!.id);
  }
  expect(await service.pair('BCDEFG')).toBeNull();
  expect(
    (await db.query('SELECT count(*)::text AS n FROM matchmaking_assignments WHERE host_id=$1', [service.hostId]))
      .rows[0].n,
  ).toBe(pair ? '1' : '0');
});

test('simultaneous workers pair only once and a lost reply retries the original code without pairing again', async () => {
  const [a, b] = await Promise.all([owner(), owner()]),
    hostId = randomUUID(),
    service = queue({ hostId }),
    other = queue({ hostId });
  await service.enqueue(a.principal, command(a));
  await service.enqueue(b.principal, command(b));
  const results = await Promise.all([service.pair('CDEFGH'), other.pair('DEFGHJ')]);
  const pair = results.find(Boolean)!;
  expect(results.filter(Boolean)).toHaveLength(1);
  expect((await other.pair(pair.roomCode))!.id).toBe(pair.id);
  expect((await service.cancel(a.principal, (await service.current(a.principal)).entry!.id)).entry!.state).toBe(
    'matched',
  );
  await service.ready(pair.id);
  expect((await service.current(b.principal)).entry!.assignment!.state).toBe('ready');
  expect(pair.selections.map((value) => value.userId).sort()).toEqual([a.principal.userId, b.principal.userId].sort());
});

test('mode, configuration, region and trusted rating season/band partition the queue', async () => {
  const [a, b, c] = await Promise.all([owner(), owner(), owner()]);
  const service = queue({
    policy: {
      ...MATCHMAKING_POLICY,
      regions: [
        { id: 'local', label: '本服' },
        { id: 'west', label: '西区' },
      ],
    },
  });
  await service.enqueue(a.principal, command(a));
  await service.enqueue(b.principal, command(b, { region: 'west' }));
  expect(await service.pair('EFGHJK')).toBeNull();
  await service.enqueue(c.principal, command(c));
  const pair = await service.pair('EFGHJK');
  expect(pair!.selections.map((value) => value.userId)).not.toContain(b.principal.userId);
  await expect(service.enqueue(a.principal, command(a, { rating: 9999 }))).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
  });
});

test('configuration is pinned and a new data version cannot pair with an old one', async () => {
  const [a, b] = await Promise.all([owner(), owner()]);
  let data: GameData = DEFAULT_DATA;
  const service = queue({ resolveData: () => data });
  await service.enqueue(a.principal, command(a));
  data = structuredClone(DEFAULT_DATA);
  data.version = DEFAULT_DATA.version.replace('phys-4', 'phys-9004');
  await service.enqueue(b.principal, command(b, { configVersion: data.version }));
  expect(await service.pair('FGHJKL')).toBeNull();
  const c = await owner();
  data = DEFAULT_DATA;
  await service.enqueue(c.principal, command(c));
  const pair = await service.pair('FGHJKL');
  expect(pair!.data.version).toBe(DEFAULT_DATA.version);
  expect((await service.current(b.principal)).entry!.state).toBe('queued');
});

test('database time expires a queued intent and expired assignment releases both participants', async () => {
  const [a, b] = await Promise.all([owner(), owner()]),
    service = queue(),
    input = command(a);
  const old = (await service.enqueue(a.principal, input)).entry!;
  await db.query("UPDATE matchmaking_entries SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [
    old.id,
  ]);
  expect((await service.enqueue(a.principal, input)).entry!.state).toBe('expired');
  await service.enqueue(a.principal, command(a));
  await service.enqueue(b.principal, command(b));
  const pair = await service.pair('GHJKLM');
  await db.query("UPDATE matchmaking_assignments SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [
    pair!.id,
  ]);
  expect((await service.current(a.principal)).entry!.state).toBe('expired');
  expect((await service.current(b.principal)).entry!.state).toBe('expired');
  expect((await service.enqueue(a.principal, command(a))).entry!.state).toBe('queued');
});

test('outsiders, forged identity and revoked sessions cannot read, cancel or join another queue', async () => {
  const [a, b] = await Promise.all([owner(), owner()]),
    service = queue();
  const entry = (await service.enqueue(a.principal, command(a))).entry!;
  await expect(service.get(b.principal, entry.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(service.cancel(b.principal, entry.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(service.enqueue(b.principal, command(a))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await sessions.revoke(a.principal, a.principal.sessionId);
  await expect(service.current(a.principal)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  await service.enqueue(b.principal, command(b));
  expect(await service.pair('HJKLMN')).toBeNull();
  expect(
    (await db.query('SELECT state,reason FROM matchmaking_entries WHERE id=$1', [entry.id])).rows[0],
  ).toMatchObject({ state: 'failed', reason: 'account-unavailable' });
});

test('inactive owned cards prevent pairing and snapshots retain the original owned levels', async () => {
  const [a, b] = await Promise.all([owner(), owner()]),
    service = queue();
  await service.enqueue(a.principal, command(a));
  await service.enqueue(b.principal, command(b));
  const card = a.lineup.ownedCardIds[0];
  await db.query('UPDATE owned_cards SET level=level+1,version=version+1 WHERE id=$1', [card]);
  const pair = await service.pair('JKLMNP');
  expect(pair!.selections.find((value) => value.userId === a.principal.userId)!.cards[0].ownedLevel).toBe(1);
  const [c, d] = await Promise.all([owner(), owner()]);
  await service.enqueue(c.principal, command(c));
  await service.enqueue(d.principal, command(d));
  await db.query("UPDATE owned_cards SET status='disabled' WHERE id=$1", [c.lineup.ownedCardIds[0]]);
  expect(await service.pair('KLMNPQ')).toBeNull();
});

test('capacity and wrong protocol/configuration are rejected without additional entries', async () => {
  const [a, b, c] = await Promise.all([owner(), owner(), owner()]),
    service = queue({ policy: { ...MATCHMAKING_POLICY, maxQueued: 2 } });
  await service.enqueue(a.principal, command(a));
  await service.enqueue(b.principal, command(b));
  await expect(service.enqueue(c.principal, command(c))).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  await expect(service.enqueue(c.principal, command(c, { protocol: 1 }))).rejects.toMatchObject({
    code: 'PROTOCOL_UNSUPPORTED',
  });
  await expect(service.enqueue(c.principal, command(c, { configVersion: 'obsolete' }))).rejects.toMatchObject({
    code: 'CONFLICT',
  });
});

test('ranked queues require a real rating source and compare its points/season, never client scores', async () => {
  const [a, b, c] = await Promise.all([owner(), owner(), owner()]);
  // A regular isolated fixture table permits independent pooled transactions to read actual persisted ratings.
  await db.query('CREATE TABLE IF NOT EXISTS queue_rating_test(user_id uuid PRIMARY KEY,points integer,season text)');
  for (const [user, points] of [
    [a, 1000],
    [b, 1500],
    [c, 1050],
  ] as const)
    await db.query("INSERT INTO queue_rating_test VALUES($1,$2,'season-1')", [user.principal.userId, points]);
  const service = queue({
    enabledModes: ['friend', 'ranked'],
    ratings: {
      async read(tx: SqlExecutor, userId: string) {
        const row = (await tx.query('SELECT points,season FROM queue_rating_test WHERE user_id=$1', [userId])).rows[0];
        return row ? ({ scope: 'ranked', ...row } as QueueRating) : null;
      },
    },
  });
  await expect(queue().enqueue(a.principal, command(a, { mode: 'ranked' }))).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  for (const user of [a, b, c]) {
    await service.enqueue(user.principal, command(user, { mode: 'ranked' }));
  }
  const pair = await service.pair('LMNPQR');
  expect(pair!.selections.map((value) => value.userId).sort()).toEqual([a.principal.userId, c.principal.userId].sort());
  const [d, e, f, g, h] = await Promise.all([owner(), owner(), owner(), owner(), owner()]);
  await service.enqueue(d.principal, command(d));
  expect(await service.pair('RSTUVW')).toBeNull();
  await service.enqueue(e.principal, command(e));
  expect((await service.pair('RSTUVW'))!.mode).toBe('friend');
  for (const [user, season] of [
    [f, 'season-2'],
    [g, 'season-3'],
    [h, 'season-2'],
  ] as const)
    await db.query('INSERT INTO queue_rating_test VALUES($1,1100,$2)', [user.principal.userId, season]);
  await service.enqueue(f.principal, command(f, { mode: 'ranked' }));
  await service.enqueue(g.principal, command(g, { mode: 'ranked' }));
  expect(await service.pair('STUVWX')).toBeNull();
  await db.query("UPDATE queue_rating_test SET season='changed-after-enqueue' WHERE user_id=$1", [f.principal.userId]);
  await service.enqueue(h.principal, command(h, { mode: 'ranked' }));
  const next = await service.pair('STUVWX');
  expect(next!.selections.map((value) => value.userId).sort()).toEqual([f.principal.userId, h.principal.userId].sort());
});

test('frozen entry fields and terminal lifecycle cannot be rewritten through SQL', async () => {
  const a = await owner(),
    service = queue(),
    entry = (await service.enqueue(a.principal, command(a))).entry!;
  await expect(
    db.query(
      "UPDATE matchmaking_entries SET lineup_snapshot=jsonb_set(lineup_snapshot,'{revision}','999') WHERE id=$1",
      [entry.id],
    ),
  ).rejects.toThrow('immutable_matchmaking_entry');
  await service.cancel(a.principal, entry.id);
  await expect(db.query("UPDATE matchmaking_entries SET state='queued' WHERE id=$1", [entry.id])).rejects.toThrow(
    'invalid_matchmaking_transition',
  );
});

test('pairing SQL failure rolls back both entries and the assignment, then the same code can succeed', async () => {
  const [a, b] = await Promise.all([owner(), owner()]),
    service = queue();
  await service.enqueue(a.principal, command(a));
  await service.enqueue(b.principal, command(b));
  await db.query(`CREATE FUNCTION queue_fail_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.room_code='MNPQRS' THEN RAISE EXCEPTION 'queue_sql_fixture'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER queue_fail_fixture BEFORE INSERT ON matchmaking_assignments FOR EACH ROW EXECUTE FUNCTION queue_fail_fixture()`);
  try {
    await expect(service.pair('MNPQRS')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect((await service.current(a.principal)).entry!.state).toBe('queued');
    expect((await service.current(b.principal)).entry!.state).toBe('queued');
    expect((await db.query("SELECT * FROM matchmaking_assignments WHERE room_code='MNPQRS'")).rowCount).toBe(0);
  } finally {
    await db.query('DROP TRIGGER queue_fail_fixture ON matchmaking_assignments; DROP FUNCTION queue_fail_fixture()');
  }
  expect(await service.pair('MNPQRS')).not.toBeNull();
});

test('runtime queues remain separate while the database rejects a user joining a second host', async () => {
  const [a, b] = await Promise.all([owner(), owner()]),
    first = queue(),
    second = queue();
  const entry = (await first.enqueue(a.principal, command(a))).entry!;
  await second.enqueue(b.principal, command(b));
  await expect(second.enqueue(a.principal, command(a))).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await first.pair('NPQRST')).toBeNull();
  expect(await second.pair('PQRSTU')).toBeNull();
  expect((await second.current(a.principal)).entry!.reason).toBe('other-server');
  await second.cancel(a.principal, entry.id);
  await second.enqueue(a.principal, command(a));
  expect(await second.pair('PQRSTU')).not.toBeNull();
});

test('a historic match using the same room code cannot complete a fresh queue assignment', async () => {
  const history = await fixture.outcome();
  await db.query("UPDATE matches SET room_code='QRSTUV' WHERE id=$1", [history.outcome.matchId]);
  expect((await history.worker.record(history.outcome)).recorded).toBe(true);
  const [a, b] = await Promise.all([owner(), owner()]),
    service = queue();
  await service.enqueue(a.principal, command(a));
  await service.enqueue(b.principal, command(b));
  const pair = await service.pair('QRSTUV');
  expect(pair).not.toBeNull();
  expect((await service.current(a.principal)).entry!.state).toBe('matched');
});
