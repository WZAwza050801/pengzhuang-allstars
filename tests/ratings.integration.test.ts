import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { Database, AccountRepository, migrateDatabase } from '@pengzhuang/persistence';
import { RatingRepository } from '../packages/persistence/src/ratings';
import { readRuntimeConfig } from '../config/runtime';
import { createBundledEconomyConfiguration } from '../config/economy';
import { rulesForMode } from '../config/modes';
import { RATINGS_CONFIG } from '../config/ratings';
import { DEFAULT_DATA } from '../shared/data';
import { MatchOutcomes } from '../server/matches/outcomes';
import { OutcomeJournal } from '../server/matches/outcome-journal';
import { PlayerData } from '../server/accounts/player-data';
import { Assets } from '../server/accounts/assets';
import { Ratings } from '../server/matches/ratings';
import { MatchmakingQueue } from '../server/matches/matchmaking';
import { Lineups } from '../server/accounts/lineups';
import { Sessions } from '../server/accounts/sessions';
import { WebSessions } from '../server/api/web-sessions';
import { ratingsModule } from '../server/api/ratings';
import { createGameServer } from '../server/app';
import { OutcomeIntentSchema, type OutcomeIntent } from '../packages/contracts/src/match-results';
import { LeaderboardSchema } from '../packages/contracts/src/ratings';
import { eloDelta } from '../packages/game-core/src/ratings';
import { freePort } from './helpers/mailpit';
import { jsonRequest } from './helpers/json-http';

let db: Database,
  players: PlayerData,
  assets: Assets,
  ratings: Ratings,
  worker: MatchOutcomes,
  lineups: Lineups,
  sessions: Sessions;
const policy = createBundledEconomyConfiguration().policy;
const opened: MatchOutcomes[] = [];
const season = RATINGS_CONFIG.season;
// Room codes are globally unique in the shared isolated DB; never reuse another suite's fixed codes.
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCode = () =>
  Array.from(randomBytes(6))
    .map((b) => ROOM_ALPHABET[b % 32])
    .join('');
beforeAll(async () => {
  const config = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
  if (!config.databaseUrl || !process.env.PG_TEST_TMP_DIR) throw new Error('Isolated PostgreSQL required');
  db = new Database({ connectionString: config.databaseUrl });
  await migrateDatabase(db);
  players = new PlayerData(db, policy, DEFAULT_DATA);
  assets = new Assets(db, players.initialize, () => ({ policy, data: DEFAULT_DATA }));
  ratings = new Ratings(db, RATINGS_CONFIG);
  worker = new MatchOutcomes({
    db,
    assets,
    policy: () => policy,
    ratings,
    journal: new OutcomeJournal(path.join(process.env.PG_TEST_TMP_DIR, `mm02-outcomes-${randomUUID()}`)),
    onEvent: () => undefined,
  });
  opened.push(worker);
  lineups = new Lineups(db, players.initialize, () => DEFAULT_DATA);
  sessions = new Sessions(db, randomBytes(32).toString('base64url'), 'http://localhost:2567', players.initialize);
});
afterAll(async () => {
  await Promise.all(opened.map((service) => service.close()));
  await db?.close();
});
async function owner() {
  const user = await new AccountRepository(db).createUser();
  await db.transaction((tx) => players.initialize(tx, user.id));
  return user.id;
}
interface MatchOptions {
  winner?: -1 | 0 | 1;
  reason?: OutcomeIntent['reason'];
  score?: [number, number];
  owners?: [string, string];
}
async function match(mode: 'friend' | 'growth' | 'ranked', options: MatchOptions = {}): Promise<OutcomeIntent> {
  const ids = options.owners ?? [await owner(), await owner()];
  const matchId = randomUUID();
  const winner = options.winner ?? 0;
  const reason = options.reason ?? 'time';
  const score = options.score ?? (winner === -1 ? [1, 1] : [1, 0]);
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
    return worker.openInTransaction(tx, matchId, DEFAULT_DATA, rulesForMode(DEFAULT_DATA, mode));
  });
  return OutcomeIntentSchema.parse({
    schemaVersion: 1,
    protocol: 2,
    matchId,
    mode,
    configurationHash: hash,
    configVersion: DEFAULT_DATA.version,
    finalSeq: 4,
    score,
    winner,
    reason,
    elapsedSeconds: 180,
    endedAt: new Date().toISOString(),
    participants: ids.map((userId, side) => ({ userId, side, actions: 2 })),
  });
}
const ratingRow = async (userId: string, scope: 'ranked' | 'growth' = 'ranked') =>
  (
    await db.query('SELECT points,wins,draws,losses,version FROM ratings WHERE user_id=$1 AND scope=$2 AND season=$3', [
      userId,
      scope,
      season,
    ])
  ).rows[0];
const applications = async (matchId: string) =>
  (
    await db.query(
      'SELECT user_id,result,delta,points_after FROM rating_applications WHERE match_id=$1 ORDER BY user_id',
      [matchId],
    )
  ).rows;
async function settle(outcome: OutcomeIntent) {
  await worker.record(outcome);
  await worker.drain();
}

test('ranked win/loss settles Elo once with an immutable application ledger', async () => {
  const outcome = await match('ranked');
  await settle(outcome);
  const [a, b] = outcome.participants;
  expect(await ratingRow(a.userId)).toMatchObject({ points: 1016, wins: 1, losses: 0, version: 1 });
  expect(await ratingRow(b.userId)).toMatchObject({ points: 984, wins: 0, losses: 1, version: 1 });
  const ledger = await applications(outcome.matchId);
  expect(ledger).toHaveLength(2);
  expect(ledger.find((r) => r.user_id === a.userId)).toMatchObject({ result: 'win', delta: 16, points_after: 1016 });
  expect(ledger.find((r) => r.user_id === b.userId)).toMatchObject({ result: 'loss', delta: -16, points_after: 984 });
});

test('draws move nobody and count once; forfeits count but void outcomes never touch ratings', async () => {
  const draw = await match('ranked', { winner: -1, score: [1, 1] });
  await settle(draw);
  for (const p of draw.participants)
    expect(await ratingRow(p.userId)).toMatchObject({ points: 1000, draws: 1, version: 1 });
  expect((await applications(draw.matchId)).every((r) => r.delta === 0 && r.result === 'draw')).toBe(true);

  const forfeit = await match('ranked', { winner: 1, reason: 'surrender' });
  await settle(forfeit);
  expect(await ratingRow(forfeit.participants[1].userId)).toMatchObject({ points: 1016, wins: 1 });
  expect(await ratingRow(forfeit.participants[0].userId)).toMatchObject({ points: 984, losses: 1 });

  const voided = await match('ranked', { winner: -1, reason: 'abandoned', score: [0, 0] });
  await settle(voided);
  expect(await applications(voided.matchId)).toHaveLength(0);
  for (const p of voided.participants) expect(await ratingRow(p.userId)).toBeUndefined();
});

test('replayed settlement and direct re-application never double-apply', async () => {
  const outcome = await match('ranked');
  await settle(outcome);
  const before = await ratingRow(outcome.participants[0].userId);
  await settle(outcome);
  await worker.drain();
  await db.transaction((tx) => ratings.applyInTransaction(tx, outcome, rulesForMode(DEFAULT_DATA, 'ranked')));
  expect(await ratingRow(outcome.participants[0].userId)).toEqual(before);
  expect(await applications(outcome.matchId)).toHaveLength(2);
});

test('out-of-order settlement keeps every application and reconciles points', async () => {
  const [a, b, c] = [await owner(), await owner(), await owner()];
  const first = await match('ranked', { owners: [a, b], winner: 0 });
  const second = await match('ranked', { owners: [a, c], winner: 1 });
  await settle(second);
  await settle(first);
  const afterSecond = eloDelta(1000, 1000, 'loss', RATINGS_CONFIG).after;
  const expectedA = eloDelta(afterSecond, 1000, 'win', RATINGS_CONFIG).after;
  expect(await ratingRow(a)).toMatchObject({ points: expectedA, wins: 1, losses: 1, version: 2 });
  expect(await ratingRow(b)).toMatchObject({ points: eloDelta(1000, afterSecond, 'loss', RATINGS_CONFIG).after });
  expect(await ratingRow(c)).toMatchObject({ points: eloDelta(1000, 1000, 'win', RATINGS_CONFIG).after });
  expect(await applications(first.matchId)).toHaveLength(2);
  expect(await applications(second.matchId)).toHaveLength(2);
});

test('concurrent settlements sharing one user serialize without lost updates', async () => {
  const a = await owner();
  const outcomes = await Promise.all(
    Array.from({ length: 6 }, async () => match('ranked', { owners: [a, await owner()], winner: 0 })),
  );
  await Promise.all(
    outcomes.map((outcome) =>
      db.transaction((tx) => ratings.applyInTransaction(tx, outcome, rulesForMode(DEFAULT_DATA, 'ranked'))),
    ),
  );
  const row = await ratingRow(a);
  expect(row).toMatchObject({ wins: 6, version: 6 });
  const ledger = (
    await db.query('SELECT delta,points_after FROM rating_applications WHERE user_id=$1 ORDER BY points_after', [a])
  ).rows;
  expect(ledger).toHaveLength(6);
  let previous = 1000;
  for (const entry of ledger) {
    expect(entry.points_after - previous).toBe(entry.delta);
    previous = entry.points_after;
  }
  expect(row.points).toBe(previous);
  const concurrentRecords = await Promise.all(
    Array.from({ length: 3 }, async () => match('ranked', { owners: [a, await owner()], winner: 0 })),
  );
  await Promise.all(concurrentRecords.map((outcome) => worker.record(outcome)));
  await worker.drain();
  expect(await ratingRow(a)).toMatchObject({ wins: 9, version: 9 });
});

test('SQL failure during application rolls back and the retry applies exactly once', async () => {
  const outcome = await match('ranked');
  await db.query(`CREATE FUNCTION mm02_fail_rating() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected rating failure'; END $$;
    CREATE TRIGGER mm02_fail_rating BEFORE INSERT ON rating_applications FOR EACH ROW EXECUTE FUNCTION mm02_fail_rating()`);
  try {
    await worker.record(outcome);
    await worker.drain();
    expect(await ratingRow(outcome.participants[0].userId)).toBeUndefined();
    expect(await applications(outcome.matchId)).toHaveLength(0);
  } finally {
    await db.query('DROP TRIGGER mm02_fail_rating ON rating_applications; DROP FUNCTION mm02_fail_rating()');
  }
  await db.query(
    "UPDATE outbox_events SET next_attempt_at=clock_timestamp() WHERE type='match.settle' AND aggregate_id=$1",
    [outcome.matchId],
  );
  await worker.drain();
  expect(await ratingRow(outcome.participants[0].userId)).toMatchObject({ points: 1016, version: 1 });
  expect(await applications(outcome.matchId)).toHaveLength(2);
});

test('growth and ranked pools stay isolated for the same user', async () => {
  const [a, b] = [await owner(), await owner()];
  const growth = await match('growth', { owners: [a, b], winner: 0 });
  await settle(growth);
  expect(await ratingRow(a, 'growth')).toMatchObject({ points: 1016, wins: 1 });
  expect(await ratingRow(a, 'ranked')).toBeUndefined();
  const own = await ratings.own(a);
  expect(own.ratings.find((r) => r.scope === 'growth')).toMatchObject({ points: 1016, tier: { id: 'bronze' } });
  expect(own.ratings.find((r) => r.scope === 'ranked')).toMatchObject({ points: 1000, version: 0 });
});

test('ranked queue reads real persisted points and season, never client scores', async () => {
  let active: Ratings = ratings;
  const queue = new MatchmakingQueue({
    db,
    lineups,
    resolveData: () => DEFAULT_DATA,
    hostId: randomUUID(),
    enabledModes: ['friend', 'ranked', 'growth'],
    ratings: { read: (tx, userId, mode) => active.readForQueue(tx, userId, mode) },
  });
  const actor = async () => {
    const userId = await owner();
    const credentials = await db.transaction((tx) => sessions.issue(tx, userId, randomBytes(32).toString('base64url')));
    const principal = await sessions.authenticate(credentials.accessToken);
    const lineup = (await lineups.list(principal, {})).lineups[0];
    return { principal, lineup };
  };
  const command = (user: Awaited<ReturnType<typeof actor>>, extra: Record<string, unknown> = {}) => ({
    intentId: randomUUID(),
    mode: 'ranked',
    protocol: 2,
    lineupId: user.lineup.id,
    expectedRevision: user.lineup.revision,
    configVersion: DEFAULT_DATA.version,
    region: 'local',
    ...extra,
  });
  const [a, b, c] = [await actor(), await actor(), await actor()];
  await queue.enqueue(a.principal, command(a));
  expect(await ratingRow(a.principal.userId)).toMatchObject({ points: 1000, version: 0 });
  await db.transaction(async (tx) => {
    const repo = new RatingRepository(tx);
    await repo.ensure(b.principal.userId, 'ranked', season, 1000);
    await tx.query('UPDATE ratings SET points=1500 WHERE user_id=$1 AND scope=$2 AND season=$3', [
      b.principal.userId,
      'ranked',
      season,
    ]);
    await repo.ensure(c.principal.userId, 'ranked', season, 1000);
    await tx.query('UPDATE ratings SET points=1050 WHERE user_id=$1 AND scope=$2 AND season=$3', [
      c.principal.userId,
      'ranked',
      season,
    ]);
  });
  await queue.enqueue(b.principal, command(b));
  await queue.enqueue(c.principal, command(c));
  const pair = await queue.pair(roomCode());
  expect(pair!.selections.map((s) => s.userId).sort()).toEqual([a.principal.userId, c.principal.userId].sort());
  const [d, e] = [await actor(), await actor()];
  await queue.enqueue(d.principal, command(d));
  // Simulate the MM-03 season switch between enqueues: frozen entries must keep seasons apart.
  active = new Ratings(db, { ...RATINGS_CONFIG, season: 'season-2' });
  await queue.enqueue(e.principal, command(e));
  expect(await queue.pair(roomCode())).toBeNull();
});

test('leaderboard and own-rating APIs enforce permissions, pagination and minimal identity', async () => {
  const origin = `http://127.0.0.1:${await freePort()}`;
  const key = randomBytes(32).toString('base64url');
  const webSessions = new Sessions(db, key, origin, players.initialize);
  const web = new WebSessions(webSessions, { cookieSecure: false, allowedOrigins: [origin] }, key);
  const server = createGameServer({
    repository: db,
    clientDirectory: null,
    modules: [web.module(), ...ratingsModule(ratings, web)],
  });
  await server.gameServer.listen(Number(new URL(origin).port));
  try {
    const users: string[] = [];
    for (let i = 0; i < 5; i++) {
      const userId = await owner();
      await db.transaction(async (tx) => {
        const repo = new RatingRepository(tx);
        await repo.ensure(userId, 'ranked', season, 1000);
        await tx.query('UPDATE ratings SET points=$2 WHERE user_id=$1 AND scope=$3 AND season=$4', [
          userId,
          2000 + i * 40,
          'ranked',
          season,
        ]);
      });
      users.push(userId);
    }
    const publicPage = await jsonRequest(origin, '/api/v1/ratings/leaderboard?scope=ranked&limit=2');
    expect(publicPage.status).toBe(200);
    expect(LeaderboardSchema.safeParse(publicPage.data.data).success).toBe(true);
    expect(publicPage.data.data.entries.map((e: { points: number }) => e.points)).toEqual([2160, 2120]);
    expect(publicPage.data.data.nextCursor).toBeTruthy();
    for (const entry of publicPage.data.data.entries) {
      expect(Object.keys(entry).sort()).toEqual(['draws', 'losses', 'nickname', 'points', 'tier', 'wins']);
    }
    const secondPage = await jsonRequest(
      origin,
      `/api/v1/ratings/leaderboard?scope=ranked&limit=2&cursor=${publicPage.data.data.nextCursor}`,
    );
    expect(secondPage.data.data.entries.map((e: { points: number }) => e.points)).toEqual([2080, 2040]);
    expect(await jsonRequest(origin, '/api/v1/ratings/leaderboard?scope=ranked&cursor=not-a-cursor')).toMatchObject({
      status: 400,
    });
    expect(await jsonRequest(origin, '/api/v1/ratings/leaderboard?scope=practice')).toMatchObject({ status: 400 });
    expect(await jsonRequest(origin, '/api/v1/ratings/leaderboard?scope=ranked&season=season-other')).toMatchObject({
      status: 200,
    });
    expect(
      (await jsonRequest(origin, '/api/v1/ratings/leaderboard?scope=ranked&season=season-other')).data.data.entries,
    ).toEqual([]);

    expect(await jsonRequest(origin, '/api/v1/me/rating')).toMatchObject({ status: 401 });
    const credentials = await db.transaction((tx) =>
      webSessions.issue(tx, users[0], randomBytes(32).toString('base64url')),
    );
    const cookie = `pz_access=${credentials.accessToken}`;
    const own = await jsonRequest(origin, '/api/v1/me/rating', { headers: { cookie, origin } });
    expect(own.status).toBe(200);
    expect(own.data.data.userId).toBe(users[0]);
    expect(own.data.data.ratings.find((r: { scope: string }) => r.scope === 'ranked').points).toBe(2000);
    const mismatch = await jsonRequest(origin, '/api/v1/me/rating', {
      headers: { cookie, origin, 'x-account-id': users[1] },
    });
    expect(mismatch.status).toBe(409);
  } finally {
    await server.close();
  }
});
