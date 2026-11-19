import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { Database, AccountRepository, migrateDatabase } from '@pengzhuang/persistence';
import { readRuntimeConfig } from '../config/runtime';
import { createBundledEconomyConfiguration } from '../config/economy';
import { rulesForMode } from '../config/modes';
import { MATCHMAKING_POLICY } from '../config/matchmaking';
import { DEFAULT_DATA } from '../shared/data';
import { MatchmakingQueue } from '../server/matches/matchmaking';
import { MatchmakingInsights } from '../server/matches/insights';
import { Lineups } from '../server/accounts/lineups';
import { Sessions } from '../server/accounts/sessions';
import { WebSessions } from '../server/api/web-sessions';
import { MatchOutcomes } from '../server/matches/outcomes';
import { OutcomeJournal } from '../server/matches/outcome-journal';
import { PlayerData } from '../server/accounts/player-data';
import { Assets } from '../server/accounts/assets';
import { insightsModule } from '../server/api/insights';
import { createGameServer } from '../server/app';
import { OutcomeIntentSchema, type OutcomeIntent } from '../packages/contracts/src/match-results';
import { MatchmakingInsightsSchema } from '../packages/contracts/src/matchmaking';
import { freePort } from './helpers/mailpit';
import { jsonRequest } from './helpers/json-http';

let db: Database, players: PlayerData, assets: Assets, lineups: Lineups, sessions: Sessions;
const policy = createBundledEconomyConfiguration().policy;
const opened: MatchOutcomes[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
  lineups = new Lineups(db, players.initialize, () => DEFAULT_DATA);
  sessions = new Sessions(db, randomBytes(32).toString('base64url'), 'http://localhost:2567', players.initialize);
});
afterAll(async () => {
  await Promise.all(opened.map((s) => s.close()));
  await db?.close();
});
async function owner() {
  const user = await new AccountRepository(db).createUser();
  await db.transaction((tx) => players.initialize(tx, user.id));
  return user.id;
}
async function actor() {
  const userId = await owner();
  const credentials = await db.transaction((tx) => sessions.issue(tx, userId, randomBytes(32).toString('base64url')));
  const principal = await sessions.authenticate(credentials.accessToken);
  const lineup = (await lineups.list(principal, {})).lineups[0];
  return { principal, lineup };
}
const command = (a: Awaited<ReturnType<typeof actor>>, mode: 'friend' | 'ranked' = 'ranked') => ({
  intentId: randomUUID(),
  mode,
  protocol: 2,
  lineupId: a.lineup.id,
  expectedRevision: a.lineup.revision,
  configVersion: DEFAULT_DATA.version,
  region: 'local',
});
function queueWith(expansion: Record<string, unknown>, points: Map<string, number>) {
  return new MatchmakingQueue({
    db,
    lineups,
    resolveData: () => DEFAULT_DATA,
    hostId: randomUUID(),
    enabledModes: ['friend', 'ranked'],
    policy: { ...MATCHMAKING_POLICY, ...expansion },
    ratings: {
      read: async (_tx, userId) =>
        points.has(userId) ? { scope: 'ranked', season: 's1', points: points.get(userId)! } : null,
    },
  });
}
function worker() {
  const w = new MatchOutcomes({
    db,
    assets,
    policy: () => policy,
    journal: new OutcomeJournal(path.join(process.env.PG_TEST_TMP_DIR!, `mm04-${randomUUID()}`)),
    onEvent: () => undefined,
  });
  opened.push(w);
  return w;
}
async function match(
  w: MatchOutcomes,
  ids: [string, string],
  opts: { winner: -1 | 0 | 1; reason: OutcomeIntent['reason'] },
): Promise<OutcomeIntent> {
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
    return w.openInTransaction(tx, matchId, DEFAULT_DATA, rulesForMode(DEFAULT_DATA, 'ranked'));
  });
  return OutcomeIntentSchema.parse({
    schemaVersion: 1,
    protocol: 2,
    matchId,
    mode: 'ranked',
    configurationHash: hash,
    configVersion: DEFAULT_DATA.version,
    finalSeq: 4,
    score: opts.winner === -1 ? [0, 0] : [1, 0],
    winner: opts.winner,
    reason: opts.reason,
    elapsedSeconds: 180,
    endedAt: new Date().toISOString(),
    participants: ids.map((userId, side) => ({ userId, side, actions: 2 })),
  });
}

test('the base window blocks a farther opponent while expansion is inactive', async () => {
  const a = await actor(),
    b = await actor();
  const points = new Map([
    [a.principal.userId, 1000],
    [b.principal.userId, 1500],
  ]);
  // A long step keeps the window at the base for the whole test, independent of machine load.
  const q = queueWith({ windowStepMs: 60000, windowStepDifference: 300, windowMaxDifference: 800 }, points);
  await q.enqueue(a.principal, command(a));
  await q.enqueue(b.principal, command(b));
  expect(await q.pair(roomCode())).toBeNull();
});

test('rating window widens with wait so a farther opponent eventually pairs', async () => {
  const a = await actor(),
    b = await actor();
  const points = new Map([
    [a.principal.userId, 1000],
    [b.principal.userId, 1500],
  ]);
  const q = queueWith({ windowStepMs: 100, windowStepDifference: 300, windowMaxDifference: 800 }, points);
  await q.enqueue(a.principal, command(a));
  await q.enqueue(b.principal, command(b));
  await sleep(1200);
  const pair = await q.pair(roomCode());
  expect(pair).not.toBeNull();
  expect(pair!.selections.map((s) => s.userId).sort()).toEqual([a.principal.userId, b.principal.userId].sort());
});

test('expansion is bounded by the cap and never pairs beyond it', async () => {
  const a = await actor(),
    b = await actor();
  const points = new Map([
    [a.principal.userId, 1000],
    [b.principal.userId, 2000],
  ]);
  const q = queueWith({ windowStepMs: 100, windowStepDifference: 300, windowMaxDifference: 800 }, points);
  await q.enqueue(a.principal, command(a));
  await q.enqueue(b.principal, command(b));
  await sleep(1200);
  expect(await q.pair(roomCode())).toBeNull();
});

test('queue status exposes a live wait estimate that expands and then caps', async () => {
  const a = await actor();
  const points = new Map([[a.principal.userId, 1000]]);
  const q = queueWith({ windowStepMs: 100, windowStepDifference: 300, windowMaxDifference: 800 }, points);
  await q.enqueue(a.principal, command(a));
  const fresh = await q.current(a.principal);
  expect(fresh.wait).not.toBeNull();
  expect(fresh.wait!.currentWindow).toBeGreaterThanOrEqual(200);
  expect(fresh.wait!.currentWindow).toBeLessThanOrEqual(800);
  expect(fresh.wait!.maxWindow).toBe(800);
  await sleep(1600);
  const later = await q.current(a.principal);
  expect(later.wait!.currentWindow).toBe(800);
  expect(later.wait!.nextExpansionMs).toBeNull();
  await q.cancel(a.principal, fresh.entry!.id);
});

test('frequent surrender raises an advisory flag without banning the account', async () => {
  const user = await owner();
  const w = worker();
  for (let i = 0; i < 6; i++) {
    const opp = await owner();
    await w.record(await match(w, [user, opp], { winner: 1, reason: 'surrender' }));
  }
  await w.drain();
  const insights = new MatchmakingInsights(db, { minSample: 5, surrenderThreshold: 0.5, repeatThreshold: 5 });
  const result = await insights.analyze(user);
  expect(MatchmakingInsightsSchema.safeParse(result).success).toBe(true);
  expect(result.totals.surrenderLosses).toBe(6);
  expect(result.flags).toContain('frequent-surrender');
  expect((await db.query('SELECT status FROM users WHERE id=$1', [user])).rows[0].status).toBe('active');
});

test('repeat opponents are surfaced and server faults are distinguished from disconnects', async () => {
  const user = await owner(),
    rival = await owner(),
    other = await owner();
  const w = worker();
  for (let i = 0; i < 6; i++) await w.record(await match(w, [user, rival], { winner: 0, reason: 'time' }));
  await w.record(await match(w, [user, other], { winner: -1, reason: 'server-fault' }));
  await w.record(await match(w, [user, other], { winner: 1, reason: 'disconnect' }));
  await w.drain();
  const insights = new MatchmakingInsights(db, { minSample: 5, surrenderThreshold: 0.5, repeatThreshold: 5 });
  const result = await insights.analyze(user);
  expect(result.flags).toContain('repeat-opponent');
  expect(result.repeatOpponents[0].count).toBe(6);
  expect(result.totals.serverFaults).toBe(1);
  expect(result.totals.disconnectLosses).toBe(1);
  expect(result.totals.losses).toBe(1);
  expect(result.totals.wins).toBe(6);
  expect((await db.query('SELECT status FROM users WHERE id=$1', [user])).rows[0].status).toBe('active');
});

test('insights API requires auth and account target', async () => {
  const origin = `http://127.0.0.1:${await freePort()}`;
  const key = randomBytes(32).toString('base64url');
  const webSessions = new Sessions(db, key, origin, players.initialize);
  const web = new WebSessions(webSessions, { cookieSecure: false, allowedOrigins: [origin] }, key);
  const server = createGameServer({
    repository: db,
    clientDirectory: null,
    modules: [web.module(), insightsModule(new MatchmakingInsights(db), web)],
  });
  await server.gameServer.listen(Number(new URL(origin).port));
  try {
    expect(await jsonRequest(origin, '/api/v1/me/matchmaking-insights')).toMatchObject({ status: 401 });
    const userId = await owner();
    const credentials = await db.transaction((tx) =>
      webSessions.issue(tx, userId, randomBytes(32).toString('base64url')),
    );
    const cookie = `pz_access=${credentials.accessToken}`;
    const own = await jsonRequest(origin, '/api/v1/me/matchmaking-insights', { headers: { cookie, origin } });
    expect(own.status).toBe(200);
    expect(own.data.data.userId).toBe(userId);
    expect(MatchmakingInsightsSchema.safeParse(own.data.data).success).toBe(true);
    const other = await owner();
    expect(
      await jsonRequest(origin, '/api/v1/me/matchmaking-insights', {
        headers: { cookie, origin, 'x-account-id': other },
      }),
    ).toMatchObject({ status: 409 });
  } finally {
    await server.close();
  }
});
