import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { Database, AccountRepository, migrateDatabase } from '@pengzhuang/persistence';
import { RatingRepository } from '../packages/persistence/src/ratings';
import { readRuntimeConfig } from '../config/runtime';
import { createBundledEconomyConfiguration } from '../config/economy';
import { rulesForMode } from '../config/modes';
import { RATINGS_CONFIG } from '../config/ratings';
import { SEASONS_CONFIG } from '../config/seasons';
import { DEFAULT_DATA } from '../shared/data';
import { MatchOutcomes } from '../server/matches/outcomes';
import { OutcomeJournal } from '../server/matches/outcome-journal';
import { PlayerData } from '../server/accounts/player-data';
import { Assets } from '../server/accounts/assets';
import { Ratings } from '../server/matches/ratings';
import { SeasonService } from '../server/matches/seasons';
import { seasonsModule } from '../server/api/seasons';
import { createGameServer } from '../server/app';
import { OutcomeIntentSchema } from '../packages/contracts/src/match-results';
import { SeasonHistorySchema } from '../packages/contracts/src/seasons';
import { freePort } from './helpers/mailpit';
import { jsonRequest } from './helpers/json-http';

let db: Database, players: PlayerData, assets: Assets, seasons: SeasonService;
const policy = createBundledEconomyConfiguration().policy;
const opened: MatchOutcomes[] = [];
const CLOSE_NOW = Date.parse('2026-12-02T00:00:00.000Z');
const CLOSE_NOW2 = Date.parse('2027-01-02T00:00:00.000Z');
beforeAll(async () => {
  const config = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
  if (!config.databaseUrl || !process.env.PG_TEST_TMP_DIR) throw new Error('Isolated PostgreSQL required');
  db = new Database({ connectionString: config.databaseUrl });
  await migrateDatabase(db);
  players = new PlayerData(db, policy, DEFAULT_DATA);
  assets = new Assets(db, players.initialize, () => ({ policy, data: DEFAULT_DATA }));
  seasons = new SeasonService(
    db,
    SEASONS_CONFIG,
    RATINGS_CONFIG,
    assets,
    () => policy,
    () => DEFAULT_DATA,
  );
});
afterAll(async () => {
  await Promise.all(opened.map((s) => s.close()));
  await seasons?.close();
  await db?.close();
});
async function owner() {
  const user = await new AccountRepository(db).createUser();
  await db.transaction((tx) => players.initialize(tx, user.id));
  return user.id;
}
async function seed(userId: string, scope: 'ranked' | 'growth', season: string, points: number) {
  await db.transaction(async (tx) => {
    await new RatingRepository(tx).ensure(userId, scope, season, RATINGS_CONFIG.initialPoints);
    await tx.query('UPDATE ratings SET points=$2 WHERE user_id=$1 AND scope=$3 AND season=$4', [
      userId,
      points,
      scope,
      season,
    ]);
  });
}
const rating = async (userId: string, season: string, scope: 'ranked' | 'growth' = 'ranked') =>
  (
    await db.query('SELECT points,wins,draws,losses,version FROM ratings WHERE user_id=$1 AND scope=$2 AND season=$3', [
      userId,
      scope,
      season,
    ])
  ).rows[0];
const balance = async (userId: string) =>
  (await db.query("SELECT balance::text FROM wallets WHERE user_id=$1 AND currency='coins'", [userId])).rows[0].balance;
const historyRow = async (userId: string, season: string, scope: 'ranked' | 'growth' = 'ranked') =>
  (
    await db.query(
      'SELECT points,tier_id,tier_label,reward_coins FROM season_history WHERE season_id=$1 AND user_id=$2 AND scope=$3',
      [season, userId, scope],
    )
  ).rows[0];

test('a failed season switch rolls back completely and a re-run grants once', async () => {
  const user = await owner();
  await seed(user, 'ranked', 'season-1', 1600);
  const before = await balance(user);
  await db.query(`CREATE FUNCTION mm03_fail_reward() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected season reward failure'; END $$;
    CREATE TRIGGER mm03_fail_reward BEFORE INSERT ON season_rewards FOR EACH ROW EXECUTE FUNCTION mm03_fail_reward()`);
  try {
    await expect(seasons.runJob(CLOSE_NOW)).rejects.toThrow();
    expect(await balance(user)).toBe(before);
    expect(await historyRow(user, 'season-1')).toBeUndefined();
    expect((await seasons.list()).seasons.every((s) => s.status !== 'closed')).toBe(true);
  } finally {
    await db.query('DROP TRIGGER mm03_fail_reward ON season_rewards; DROP FUNCTION mm03_fail_reward()');
  }
  const { closed } = await seasons.runJob(CLOSE_NOW);
  expect(closed).toContain('season-1');
  expect(await balance(user)).toBe((BigInt(before) + 2000n).toString());
  expect(await historyRow(user, 'season-1')).toMatchObject({ points: 1600, tier_id: 'diamond', reward_coins: '2000' });
});

test('closing freezes the board, soft-resets into the next season and rewards by tier', async () => {
  const diamond = await owner(),
    gold = await owner(),
    bronze = await owner();
  const bronzeBefore = await balance(bronze);
  // season-1 was closed by the previous test; exercise the next switch on season-2.
  await seed(diamond, 'ranked', 'season-2', 1600);
  await seed(gold, 'ranked', 'season-2', 1250);
  await seed(bronze, 'ranked', 'season-2', 1000);
  const { closed } = await seasons.runJob(CLOSE_NOW2);
  expect(closed).toContain('season-2');
  expect(await historyRow(diamond, 'season-2')).toMatchObject({
    points: 1600,
    tier_id: 'diamond',
    reward_coins: '2000',
  });
  expect(await historyRow(gold, 'season-2')).toMatchObject({ points: 1250, tier_id: 'gold', reward_coins: '500' });
  expect(await historyRow(bronze, 'season-2')).toMatchObject({ points: 1000, tier_id: 'bronze', reward_coins: '0' });
  expect(await rating(diamond, 'season-3')).toMatchObject({ points: 800 });
  expect(await rating(gold, 'season-3')).toMatchObject({ points: 625 });
  expect(await rating(bronze, 'season-3')).toMatchObject({ points: 500 });
  expect(await balance(bronze)).toBe(bronzeBefore);
  const list = await seasons.list();
  expect(list.seasons.find((s) => s.id === 'season-2')?.status).toBe('closed');
  expect(list.seasons.find((s) => s.id === 'season-3')?.status).toBe('active');
});

test('repeated and concurrent jobs never double-grant or double-reset', async () => {
  const user = await owner();
  await seed(user, 'ranked', 'season-3', 1400);
  const now = Date.parse('2027-02-02T00:00:00.000Z');
  const results = await Promise.all([seasons.runJob(now), seasons.runJob(now), seasons.runJob(now)]);
  expect(results.filter((r) => r.closed.includes('season-3')).length).toBe(1);
  const after = await balance(user);
  expect(await historyRow(user, 'season-3')).toMatchObject({ points: 1400, tier_id: 'platinum', reward_coins: '1000' });
  const again = await seasons.runJob(now);
  expect(again.closed).toEqual([]);
  expect(await balance(user)).toBe(after);
  const rewards = await db.query(
    "SELECT count(*)::int AS n FROM season_rewards WHERE season_id='season-3' AND user_id=$1",
    [user],
  );
  expect(rewards.rows[0].n).toBe(1);
});

test('cross-season settlement applies to the current clock season', async () => {
  const ratings = new Ratings(db, RATINGS_CONFIG, () => seasons.currentSeason(CLOSE_NOW2)?.id ?? null);
  const worker = new MatchOutcomes({
    db,
    assets,
    policy: () => policy,
    ratings,
    journal: new OutcomeJournal(path.join(process.env.PG_TEST_TMP_DIR!, `mm03-${randomUUID()}`)),
    onEvent: () => undefined,
  });
  opened.push(worker);
  const ids = [await owner(), await owner()];
  const matchId = randomUUID();
  const hash = await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO matches(id,mode,config_version,protocol_version,status,room_code) VALUES ($1,'ranked',$2,2,'playing','ABCDEF')",
      [matchId, DEFAULT_DATA.version],
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
    return worker.openInTransaction(tx, matchId, DEFAULT_DATA, rulesForMode(DEFAULT_DATA, 'ranked'));
  });
  const outcome = OutcomeIntentSchema.parse({
    schemaVersion: 1,
    protocol: 2,
    matchId,
    mode: 'ranked',
    configurationHash: hash,
    configVersion: DEFAULT_DATA.version,
    finalSeq: 4,
    score: [1, 0],
    winner: 0,
    reason: 'time',
    elapsedSeconds: 180,
    endedAt: new Date(CLOSE_NOW2).toISOString(),
    participants: ids.map((userId, side) => ({ userId, side, actions: 2 })),
  });
  await worker.record(outcome);
  await worker.drain();
  // CLOSE_NOW2 is in season-3; the winner gains there, not in season-2.
  expect(await rating(ids[0], 'season-3')).toMatchObject({ points: 1016, wins: 1 });
  expect(await rating(ids[0], 'season-2')).toBeUndefined();
});

test('history leaderboard reads the frozen snapshot with pagination and minimal identity', async () => {
  const page = await seasons.history({ season: 'season-2', scope: 'ranked', limit: 2 });
  expect(SeasonHistorySchema.safeParse(page).success).toBe(true);
  expect(page.entries.length).toBeGreaterThan(0);
  expect(page.entries[0].points).toBeGreaterThanOrEqual(page.entries[1]?.points ?? 0);
  for (const entry of page.entries)
    expect(Object.keys(entry).sort()).toEqual(['draws', 'losses', 'nickname', 'points', 'tier', 'wins']);
  if (page.nextCursor) {
    const next = await seasons.history({ season: 'season-2', scope: 'ranked', limit: 2, cursor: page.nextCursor });
    expect(next.entries[0].points).toBeLessThanOrEqual(page.entries[page.entries.length - 1].points);
  }
  await expect(seasons.history({ season: 'no-such-season', scope: 'ranked' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});

test('season list and history APIs are public and validate input', async () => {
  const origin = `http://127.0.0.1:${await freePort()}`;
  const server = createGameServer({ repository: db, clientDirectory: null, modules: seasonsModule(seasons) });
  await server.gameServer.listen(Number(new URL(origin).port));
  try {
    const list = await jsonRequest(origin, '/api/v1/seasons');
    expect(list.status).toBe(200);
    expect(list.data.data.seasons.length).toBe(SEASONS_CONFIG.seasons.length);
    const history = await jsonRequest(origin, '/api/v1/ratings/history?season=season-2&scope=ranked&limit=2');
    expect(history.status).toBe(200);
    expect(SeasonHistorySchema.safeParse(history.data.data).success).toBe(true);
    expect(await jsonRequest(origin, '/api/v1/ratings/history?season=season-2&scope=practice')).toMatchObject({
      status: 400,
    });
    expect(await jsonRequest(origin, '/api/v1/ratings/history?scope=ranked')).toMatchObject({ status: 400 });
    expect(await jsonRequest(origin, '/api/v1/ratings/history?season=missing&scope=ranked')).toMatchObject({
      status: 404,
    });
  } finally {
    await server.close();
  }
});
