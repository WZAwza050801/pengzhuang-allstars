import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { build } from 'vite';
import { chromium, expect as visible, type Browser, type BrowserContext, type Page } from 'playwright/test';
import { beforeAll, afterAll, afterEach, expect, test } from 'vitest';
import { Database, migrateDatabase, AccountRepository } from '@pengzhuang/persistence';
import { createDataFixture } from './helpers/data-factory';
import { jsonRequest } from './helpers/json-http';
import { freePort } from './helpers/mailpit';
import { Sessions } from '../server/accounts/sessions';
import { Lineups } from '../server/accounts/lineups';
import { WebSessions } from '../server/api/web-sessions';
import { authOptionsModule } from '../server/api/auth-options';
import { currentUserModule } from '../server/api/current-user';
import { playerDataModule } from '../server/api/player-data';
import { lineupModule } from '../server/api/lineups';
import { MatchTickets } from '../server/matches/tickets';
import { MatchmakingQueue } from '../server/matches/matchmaking';
import { createGameServer } from '../server/app';
import { DEFAULT_DATA } from '../shared/data';
import type { MatchState } from '../shared/match';

let db: Database, fixture: Awaited<ReturnType<typeof createDataFixture>>, browser: Browser;
let server: ReturnType<typeof createGameServer>, sessions: Sessions, lineups: Lineups, queue: MatchmakingQueue;
let origin: string;
const contexts: BrowserContext[] = [],
  errors: string[] = [];
const screenshots = path.resolve('work/mm01-browser');
beforeAll(async () => {
  db = new Database({ connectionString: process.env.TEST_DATABASE_URL! });
  fixture = await createDataFixture(db);
  await migrateDatabase(db);
  origin = `http://127.0.0.1:${await freePort()}`;
  const key = randomBytes(32).toString('base64url');
  sessions = new Sessions(db, key, origin, fixture.players.initialize);
  lineups = new Lineups(db, fixture.players.initialize, () => DEFAULT_DATA);
  const web = new WebSessions(sessions, { cookieSecure: false, allowedOrigins: [origin] }, key);
  queue = new MatchmakingQueue({ db, lineups, resolveData: () => DEFAULT_DATA });
  const directory = path.join(process.env.PG_TEST_TMP_DIR!, 'mm01-browser-client');
  await build({
    configFile: path.resolve('client/vite.config.ts'),
    mode: 'test',
    logLevel: 'silent',
    build: { outDir: directory },
  });
  server = createGameServer({
    repository: db,
    clientDirectory: directory,
    matchmakingQueue: queue,
    accountRooms: { tickets: new MatchTickets(db, lineups, () => DEFAULT_DATA), web, outcomes: fixture.consumer() },
    modules: [
      authOptionsModule(true, false, web, true, true, true),
      web.module(),
      currentUserModule(web),
      playerDataModule(fixture.players, web),
      lineupModule(lineups, web),
    ],
  });
  await server.gameServer.listen(Number(new URL(origin).port));
  await server.startMatchmaking();
  browser = await chromium.launch({ headless: true });
  mkdirSync(screenshots, { recursive: true });
}, 90000);
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
  expect(errors.splice(0)).toEqual([]);
});
afterAll(async () => {
  await browser?.close();
  await server?.close();
  await fixture?.close();
  await db?.close();
});

async function actor(width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  contexts.push(context);
  const user = await new AccountRepository(db).createUser();
  const csrf = (await jsonRequest(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
  const issued = await db.transaction((tx) => sessions.issue(tx, user.id, csrf, 'desktop'));
  await context.addCookies([
    { name: 'pz_csrf', value: csrf, url: origin },
    { name: 'pz_access', value: issued.accessToken, url: origin, httpOnly: true },
    { name: 'pz_refresh', value: issued.refreshToken, url: origin, httpOnly: true },
  ]);
  const principal = await sessions.authenticate(issued.accessToken);
  const lineup = (await lineups.list(principal, {})).lineups[0];
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('dialog', (dialog) => void dialog.accept());
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !/Failed to load resource:.*(?:400|401|403|404|409|429|503)|net::ERR_FAILED|net::ERR_INTERNET_DISCONNECTED/.test(
        message.text(),
      )
    )
      errors.push(message.text());
  });
  return {
    context,
    page,
    principal,
    body: {
      intentId: randomUUID(),
      protocol: 2,
      mode: 'friend',
      lineupId: lineup.id,
      expectedRevision: lineup.revision,
      configVersion: DEFAULT_DATA.version,
      region: 'local',
    },
  };
}
type Actor = Awaited<ReturnType<typeof actor>>;
async function enter(value: Actor) {
  await value.page.goto(`${origin}/queue/friend`);
  await visible(value.page.getByRole('button', { name: '开始匹配', exact: true })).toBeEnabled();
  await value.page.getByRole('button', { name: '开始匹配', exact: true }).click();
  await visible(value.page.getByRole('heading', { name: /正在寻找兼容对手|已找到对手/ })).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('mobile lobby opens real matching, reload preserves one entry, cancellation and server expiry are confirmed', async () => {
  const a = await actor();
  let release!: () => void, observed!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const restoring = new Promise<void>((resolve) => {
    observed = resolve;
  });
  // A slow real /me response must not allow navigating with an unresolved account identity.
  await a.page.route('**/api/v1/me', async (route) => {
    observed();
    await gate;
    await route.continue();
  });
  try {
    await a.page.goto(origin);
    await restoring;
    await visible(a.page.getByRole('button', { name: '匹配对手', exact: true })).toBeDisabled();
  } finally {
    release();
    await a.page.unrouteAll({ behavior: 'wait' });
  }
  await a.page.getByRole('button', { name: '匹配对手', exact: true }).click();
  await visible(a.page.getByRole('button', { name: '开始匹配', exact: true })).toBeEnabled();
  await a.page.getByRole('button', { name: '开始匹配', exact: true }).click();
  await visible(a.page.getByRole('heading', { name: '正在寻找兼容对手' })).toBeVisible();
  const entry = (await queue.current(a.principal)).entry!;
  await a.page.reload();
  await visible(a.page.getByRole('heading', { name: '正在寻找兼容对手' })).toBeVisible();
  expect((await queue.current(a.principal)).entry!.id).toBe(entry.id);
  expect((await db.query('SELECT id FROM matchmaking_entries WHERE user_id=$1', [a.principal.userId])).rowCount).toBe(
    1,
  );
  await noOverflow(a.page);
  await a.page.screenshot({ path: path.join(screenshots, 'mobile-queued.png'), fullPage: true });
  await a.context.setOffline(true);
  await visible(a.page.getByRole('button', { name: '取消匹配', exact: true })).toBeDisabled();
  await a.context.setOffline(false);
  await visible(a.page.getByRole('button', { name: '取消匹配', exact: true })).toBeEnabled();
  await a.page.getByRole('button', { name: '取消匹配', exact: true }).click();
  await visible(a.page.getByRole('heading', { name: '已取消排队' })).toBeVisible();
  expect((await queue.get(a.principal, entry.id)).entry!.state).toBe('cancelled');
  await a.page.getByRole('button', { name: '重新匹配', exact: true }).click();
  await visible(a.page.getByRole('heading', { name: '正在寻找兼容对手' })).toBeVisible();
  const next = (await queue.current(a.principal)).entry!;
  expect(next.id).not.toBe(entry.id);
  // Expire the actual isolated row; the page must wait for a server response, not its local countdown.
  await db.query("UPDATE matchmaking_entries SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [
    next.id,
  ]);
  await a.page.getByRole('button', { name: '刷新状态和阵容', exact: true }).click();
  await visible(a.page.getByRole('heading', { name: '本次匹配已超时' })).toBeVisible();
  await a.page.screenshot({ path: path.join(screenshots, 'mobile-expired.png'), fullPage: true });
}, 45000);

test('two real browser accounts use their matched private room and start exactly one durable game', async () => {
  const a = await actor(1280),
    b = await actor();
  await enter(a);
  await enter(b);
  for (const value of [a, b])
    await visible(value.page.getByRole('link', { name: '进入比赛房间', exact: true })).toBeVisible();
  const matched = (await queue.current(a.principal)).entry!;
  expect((await queue.current(b.principal)).entry!.assignment!.id).toBe(matched.assignment!.id);
  await b.page.screenshot({ path: path.join(screenshots, 'mobile-matched.png'), fullPage: true });
  for (const value of [a, b]) {
    await value.page.getByRole('link', { name: '进入比赛房间', exact: true }).click();
    await value.page.getByRole('button', { name: '进入匹配房间', exact: true }).click();
    await visible(value.page.getByRole('button', { name: '准备比赛', exact: true })).toBeEnabled();
    expect(new URL(value.page.url()).searchParams.get('queueEntry')).toBe(
      (await queue.current(value.principal)).entry!.id,
    );
    await noOverflow(value.page);
  }
  await b.page.screenshot({ path: path.join(screenshots, 'mobile-private-room.png'), fullPage: true });
  for (const value of [a, b]) await value.page.getByRole('button', { name: '准备比赛', exact: true }).click();
  for (const value of [a, b]) await visible(value.page.locator('.stage canvas')).toBeVisible();
  await visible
    .poll(
      async () =>
        (await db.query('SELECT match_id FROM matchmaking_assignments WHERE id=$1', [matched.assignment!.id])).rows[0]
          .match_id,
    )
    .toBeTruthy();
  const matchId = (await db.query('SELECT match_id FROM matchmaking_assignments WHERE id=$1', [matched.assignment!.id]))
    .rows[0].match_id;
  expect(
    (await db.query('SELECT user_id FROM match_participants WHERE match_id=$1', [matchId])).rows
      .map((row) => row.user_id)
      .sort(),
  ).toEqual([a.principal.userId, b.principal.userId].sort());
  const game = (page: Page) =>
    page.evaluate(() => {
      const api = (window as unknown as { __pz?: { state(): MatchState; mySides(): number[] } }).__pz;
      return api && { state: api.state(), sides: api.mySides() };
    });
  for (const value of [a, b]) await visible.poll(() => game(value.page)).toBeTruthy();
  const first = (await game(a.page))!,
    second = (await game(b.page))!;
  expect(first.state).toEqual(second.state);
  expect(first.state.dataVersion).toBe(DEFAULT_DATA.version);
  expect([first.sides[0], second.sides[0]].sort()).toEqual([0, 1]);
  expect((await db.query("SELECT id FROM matches WHERE id=$1 AND status='playing'", [matchId])).rowCount).toBe(1);
}, 45000);

test('a real SQL failure retries one original intent and a winning pair survives an actual HTTP cancellation', async () => {
  const a = await actor(),
    submitted: string[] = [];
  a.page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/matchmaking/entries'))
      submitted.push(request.postDataJSON().intentId);
  });
  await a.page.goto(`${origin}/queue/friend`);
  await visible(a.page.getByRole('button', { name: '开始匹配', exact: true })).toBeEnabled();
  await db.query(`CREATE FUNCTION queue_ui_fail_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'queue_ui_fail_fixture'; END $$;
    CREATE TRIGGER queue_ui_fail_fixture BEFORE INSERT ON matchmaking_entries FOR EACH ROW EXECUTE FUNCTION queue_ui_fail_fixture()`);
  try {
    await a.page.getByRole('button', { name: '开始匹配', exact: true }).click();
    await visible(a.page.getByRole('button', { name: '重试原入队请求', exact: true })).toBeVisible();
    expect((await queue.current(a.principal)).entry).toBeNull();
    await a.page.screenshot({ path: path.join(screenshots, 'mobile-retry.png'), fullPage: true });
  } finally {
    await db.query('DROP TRIGGER queue_ui_fail_fixture ON matchmaking_entries; DROP FUNCTION queue_ui_fail_fixture()');
  }
  await a.page.getByRole('button', { name: '重试原入队请求', exact: true }).click();
  await visible(a.page.getByRole('heading', { name: '正在寻找兼容对手' })).toBeVisible();
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toBe(submitted[0]);
  expect((await db.query('SELECT id FROM matchmaking_entries WHERE user_id=$1', [a.principal.userId])).rowCount).toBe(
    1,
  );
  // Delay only polling visibility; both pairing and the cancellation still execute in the real server/database.
  await a.page.route('**/api/v1/matchmaking/entries/current', (route) => route.abort('failed'));
  const b = await actor();
  await queue.enqueue(b.principal, b.body);
  await server.matchmaking!.pump();
  await a.page.getByRole('button', { name: '取消匹配', exact: true }).click();
  await visible(a.page.getByRole('heading', { name: '已找到对手' })).toBeVisible();
  await visible(a.page.getByText('已先完成配对，取消未生效。请进入本场比赛。', { exact: true })).toBeVisible();
  await visible(a.page.getByRole('link', { name: '进入比赛房间', exact: true })).toBeVisible();
  expect((await queue.current(a.principal)).entry!.state).toBe('matched');
  expect((await queue.current(b.principal)).entry!.assignment!.id).toBe(
    (await queue.current(a.principal)).entry!.assignment!.id,
  );
  await a.page.screenshot({ path: path.join(screenshots, 'mobile-cancel-race.png'), fullPage: true });
}, 45000);

test('switching the actual cookie session discards a delayed private queue response from the previous account', async () => {
  const a = await actor(),
    b = await actor();
  await enter(a);
  const original = (await queue.current(a.principal)).entry!;
  let release!: () => void,
    observed!: () => void,
    once = true;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const captured = new Promise<void>((resolve) => {
    observed = resolve;
  });
  await a.page.route('**/api/v1/matchmaking/entries/current', async (route) => {
    if (!once) return route.continue();
    once = false;
    const response = await route.fetch();
    observed();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await a.page.getByRole('button', { name: '刷新状态和阵容', exact: true }).click();
    await captured;
    await a.context.addCookies(await b.context.cookies(origin));
    await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await visible(a.page.getByRole('heading', { name: '选择阵容，开始匹配' })).toBeVisible();
    await visible(a.page.getByRole('button', { name: '开始匹配', exact: true })).toBeEnabled();
    release();
    await a.page.unrouteAll({ behavior: 'wait' });
    await visible(a.page.getByRole('heading', { name: '正在寻找兼容对手' })).toHaveCount(0);
    await visible(a.page.getByRole('button', { name: '开始匹配', exact: true })).toBeEnabled();
    expect((await queue.current(b.principal)).entry).toBeNull();
    expect((await queue.get(a.principal, original.id)).entry!.state).toBe('queued');
  } finally {
    release();
    await queue.cancel(a.principal, original.id);
  }
}, 45000);
