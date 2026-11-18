import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { build } from 'vite';
import { chromium, expect as visible, type Browser, type Page, type BrowserContext } from 'playwright/test';
import { beforeAll, afterAll, test, expect } from 'vitest';
import { matchMaker } from 'colyseus';
import { AccountRepository, Database, migrateDatabase } from '@pengzhuang/persistence';
import { readRuntimeConfig } from '../config/runtime';
import { createBundledEconomyConfiguration } from '../config/economy';
import { DEFAULT_DATA } from '../shared/data';
import type { MatchState } from '../shared/match';
import { createGameServer } from '../server/app';
import { MatchRoom, type MatchTiming } from '../server/rooms/MatchRoom';
import { PlayerData } from '../server/accounts/player-data';
import { Lineups } from '../server/accounts/lineups';
import { MatchTickets } from '../server/matches/tickets';
import { Sessions } from '../server/accounts/sessions';
import { WebSessions } from '../server/api/web-sessions';
import { authOptionsModule } from '../server/api/auth-options';
import { currentUserModule } from '../server/api/current-user';
import { playerDataModule } from '../server/api/player-data';
import { lineupModule } from '../server/api/lineups';
import { jsonRequest } from './helpers/json-http';
import { freePort } from './helpers/mailpit';

let db: Database, server: ReturnType<typeof createGameServer>, browser: Browser, sessions: Sessions;
let origin: string;
const errors: string[] = [];
const screenshots = path.resolve('work/ui05-browser');
beforeAll(async () => {
  if (!process.env.PG_TEST_TMP_DIR) throw new Error('Isolated PostgreSQL required');
  db = new Database({ connectionString: readRuntimeConfig({ ...process.env, APP_ENV: 'test' }).databaseUrl! });
  await migrateDatabase(db);
  origin = `http://127.0.0.1:${await freePort()}`;
  const key = randomBytes(32).toString('base64url');
  const players = new PlayerData(db, createBundledEconomyConfiguration().policy, DEFAULT_DATA);
  const lineups = new Lineups(db, players.initialize, () => DEFAULT_DATA);
  sessions = new Sessions(db, key, origin, players.initialize);
  const web = new WebSessions(sessions, { cookieSecure: false, allowedOrigins: [origin] }, key);
  const directory = path.join(process.env.PG_TEST_TMP_DIR, 'ui05-browser-client');
  await build({
    configFile: path.resolve('client/vite.config.ts'),
    mode: 'test',
    logLevel: 'silent',
    build: { outDir: directory },
  });
  server = createGameServer({
    repository: db,
    clientDirectory: directory,
    accountRooms: { tickets: new MatchTickets(db, lineups, () => DEFAULT_DATA), web },
    modules: [
      authOptionsModule(true, false, web, true, true),
      web.module(),
      currentUserModule(web),
      playerDataModule(players, web),
      lineupModule(lineups, web),
    ],
  });
  await server.gameServer.listen(Number(new URL(origin).port));
  browser = await chromium.launch({ headless: true });
  mkdirSync(screenshots, { recursive: true });
}, 90000);
afterAll(async () => {
  await browser?.close();
  await server?.close();
  await db?.close();
});

async function seed(context: BrowserContext) {
  const user = await new AccountRepository(db).createUser();
  const csrf = (await jsonRequest(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
  const credentials = await db.transaction((tx) => sessions.issue(tx, user.id, csrf, 'desktop'));
  await context.addCookies([
    { name: 'pz_csrf', value: csrf, url: origin },
    { name: 'pz_access', value: credentials.accessToken, url: origin, httpOnly: true },
    { name: 'pz_refresh', value: credentials.refreshToken, url: origin, httpOnly: true },
  ]);
  return { userId: user.id };
}
function observe(page: Page) {
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !/Failed to load resource:.*(?:400|401|403|404|409|429|503)|net::ERR_FAILED/.test(message.text())
    )
      errors.push(message.text());
  });
}
async function pageIn({ width = 390, height = 844, touch = false, anonymous = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
  const account = anonymous ? null : await seed(context);
  const page = await context.newPage();
  observe(page);
  return { context, page, account };
}
type Actor = Awaited<ReturnType<typeof pageIn>>;
type Automation = {
  state(): MatchState;
  mySides(): number[];
  canAim(): boolean;
  playing(): boolean;
  curve(): number;
  screenOf(x: number, y: number): { x: number; y: number; scale: number };
};
const state = (page: Page) => page.evaluate(() => (window as unknown as { __pz?: Automation }).__pz?.state());
const canAim = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pz?: Automation }).__pz?.canAim() ?? false);
const room = (code: string) => matchMaker.getLocalRoomById(code) as MatchRoom;
async function create(actor: Actor) {
  await actor.page.goto(`${origin}/room`);
  await visible(actor.page.getByRole('button', { name: '创建房间', exact: true })).toBeEnabled();
  await actor.page.getByRole('button', { name: '创建房间', exact: true }).click();
  const invite = actor.page.getByRole('textbox', { name: '邀请链接', exact: true });
  await visible(invite).toBeVisible();
  return (await invite.inputValue()).split('/').at(-1)!;
}
async function join(actor: Actor, code: string) {
  await actor.page.goto(`${origin}/room/${code}`);
  await visible(actor.page.getByRole('button', { name: '加入房间', exact: true })).toBeEnabled();
  await actor.page.getByRole('button', { name: '加入房间', exact: true }).click();
  await visible
    .poll(
      async () =>
        (await actor.page.getByRole('textbox', { name: '邀请链接', exact: true }).isVisible()) ||
        (await actor.page.locator('.stage canvas').isVisible()),
    )
    .toBe(true);
}
async function kickoff(a: Actor, b: Actor) {
  for (const actor of [a, b]) await actor.page.getByRole('button', { name: '准备比赛', exact: true }).click();
  for (const actor of [a, b]) await visible(actor.page.locator('.stage canvas')).toBeVisible();
  await visible.poll(() => state(a.page)).toBeTruthy();
  await visible.poll(() => state(b.page)).toBeTruthy();
}
async function pair(timing?: Partial<MatchTiming>) {
  const a = await pageIn({ width: 1280, height: 900 }),
    b = await pageIn({ touch: true });
  const restore = timing ? MatchRoom.useTiming(timing) : () => undefined;
  let code: string;
  try {
    code = await create(a);
  } finally {
    restore();
  }
  await join(b, code);
  await kickoff(a, b);
  return {
    a,
    b,
    code,
    async close() {
      await a.context.close();
      await b.context.close();
    },
  };
}
async function pull(page: Page, touch = false, waitForInput = true) {
  if (waitForInput) {
    await page.bringToFront();
    await visible.poll(() => canAim(page)).toBe(true);
    await page.waitForFunction(() => {
      const api = (
        window as unknown as {
          __pz: Automation & {
            portraits(): { complete: boolean }[];
            resources(): { assets: { cache?: { inFlight: number } } };
          };
        }
      ).__pz;
      return (
        api.portraits().length > 0 &&
        api.portraits().every((entry) => entry.complete) &&
        api.resources().assets.cache?.inFlight === 0
      );
    });
  }
  const coords = await page.evaluate(() => {
    const api = (window as unknown as { __pz: Automation }).__pz;
    const current = api.state();
    const piece = current.pieces.find((entry) => entry.side === current.turn && entry.out === 0 && entry.frozen === 0)!;
    const start = api.screenOf(piece.x, piece.y);
    return {
      start,
      end: api.screenOf(piece.x + 0.6, piece.y + 0.8),
      touch: [
        [0, 0],
        [-0.15, 0.3],
        [-0.2, 0.6],
        [0, 1.1],
      ].map(([x, y]) => api.screenOf(piece.x + x, piece.y + y)),
      hit: document.elementFromPoint(start.x, start.y)?.tagName,
      visibility: document.visibilityState,
      canAim: api.canAim(),
    };
  });
  if (!touch) {
    await page.mouse.move(coords.start.x, coords.start.y);
    await page.mouse.down();
    await page.mouse.move(coords.end.x, coords.end.y, { steps: 6 });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const curve = await page.evaluate(() => (window as unknown as { __pz: Automation }).__pz.curve());
    if (!curve && waitForInput)
      console.warn('Mouse input diagnostic', coords, await page.locator('.turn').textContent());
    await page.mouse.up();
    return curve;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const point = (x: number, y: number) => ({ x, y, id: 1, radiusX: 2, radiusY: 2, force: 0.5 });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point(coords.touch[0].x, coords.touch[0].y)],
  });
  for (const entry of coords.touch.slice(1))
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(entry.x, entry.y)] });
  const curve = await page.evaluate(() => (window as unknown as { __pz: Automation }).__pz.curve());
  if (!curve && waitForInput) console.warn('Touch input diagnostic', coords, await page.locator('.turn').textContent());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  return curve;
}

test('anonymous invitation survives login reconciliation and malformed codes never request tickets', async () => {
  const actor = await pageIn({ anonymous: true });
  let requests = 0;
  actor.page.on('request', (request) => {
    if (request.url().endsWith('/matches/tickets')) requests++;
  });
  try {
    await actor.page.goto(`${origin}/room/ABCD23`);
    await visible(actor.page).toHaveURL(`${origin}/login`);
    await seed(actor.context);
    await actor.page.reload();
    await visible(actor.page.getByRole('textbox', { name: '房间码', exact: true })).toHaveValue('ABCD23');
    expect(requests).toBe(0);
    await actor.page.goto(`${origin}/room/INVALID`);
    await visible(actor.page.getByRole('heading', { name: '房间码无效' })).toBeVisible();
    expect(requests).toBe(0);
  } finally {
    await actor.context.close();
  }
});

test('double create sends one ticket request, invitation has no secrets, and ready can be cancelled', async () => {
  const a = await pageIn(),
    b = await pageIn();
  let requests = 0;
  a.page.on('request', (request) => {
    if (request.url().endsWith('/matches/tickets')) requests++;
  });
  try {
    await a.page.goto(`${origin}/room`);
    const button = a.page.getByRole('button', { name: '创建房间', exact: true });
    await visible(button).toBeEnabled();
    await button.evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
    const invite = a.page.getByRole('textbox', { name: '邀请链接', exact: true });
    await visible(invite).toBeVisible();
    expect(requests).toBe(1);
    const link = await invite.inputValue();
    expect(link).toMatch(new RegExp(`^${origin}/room/[A-Z2-9]{6}$`));
    expect(new URL(link).search).toBe('');
    expect(new URL(link).hash).toBe('');
    await a.page.getByRole('button', { name: '准备比赛', exact: true }).click();
    await visible(a.page.getByRole('button', { name: '取消准备', exact: true })).toBeEnabled();
    await a.page.getByRole('button', { name: '取消准备', exact: true }).click();
    await visible(a.page.getByRole('button', { name: '准备比赛', exact: true })).toBeEnabled();
    await join(b, link.split('/').at(-1)!);
    await visible(a.page.getByText('双方就位，准备后开局。', { exact: true })).toBeVisible();
    await kickoff(a, b);
    expect(await a.page.evaluate(() => (window as unknown as { __pz: Automation }).__pz.mySides())).toEqual([0]);
    expect(await b.page.evaluate(() => (window as unknown as { __pz: Automation }).__pz.mySides())).toEqual([1]);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('both real browser views shoot mouse/touch curves; pending/playback/opponent states prevent duplicate shots', async () => {
  const a = await pageIn({ width: 1280, height: 900 }),
    b = await pageIn({ touch: true });
  let hold = false;
  const queued: Array<() => void> = [];
  try {
    const code = await create(a);
    await join(b, code);
    await kickoff(a, b);
    const firstSide = (await state(a.page))!.turn;
    const first = firstSide === 0 ? a : b,
      second = firstSide === 0 ? b : a;
    const peer = room(code).clients[firstSide];
    peer.raw = new Proxy(peer.raw, {
      apply(send, receiver, args) {
        const forward = () => Reflect.apply(send, receiver, args);
        if (hold) queued.push(forward);
        else forward();
      },
    });
    await first.page.bringToFront();
    await visible.poll(() => canAim(first.page)).toBe(true);
    expect(await canAim(second.page)).toBe(false);
    hold = true;
    expect(Math.abs(await pull(first.page, first === b))).toBeGreaterThan(0);
    await visible(first.page.locator('.turn')).toContainText('待确认');
    await pull(first.page, first === b, false);
    expect(room(code).inspect().acceptedShots).toBe(1);
    expect(await canAim(first.page)).toBe(false);
    hold = false;
    queued.splice(0).forEach((forward) => forward());
    await visible.poll(() => state(a.page).then((current) => current?.shotNo), { timeout: 20000 }).toBe(1);
    await second.page.bringToFront();
    await visible.poll(() => canAim(second.page), { timeout: 20000 }).toBe(true);
    expect(await canAim(first.page)).toBe(false);
    expect(Math.abs(await pull(second.page, second === b))).toBeGreaterThan(0);
    await visible.poll(() => state(a.page).then((current) => current?.shotNo), { timeout: 20000 }).toBe(2);
    await visible.poll(() => state(b.page).then((current) => current?.shotNo), { timeout: 20000 }).toBe(2);
    expect(room(code).inspect().acceptedShots).toBe(2);
    await a.page.screenshot({ path: path.join(screenshots, 'match-desktop.png') });
    await b.page.screenshot({ path: path.join(screenshots, 'match-mobile.png') });
  } finally {
    await a.context.close();
    await b.context.close();
  }
}, 60000);

test('server timeout advances both clients even when one display clock is frozen', async () => {
  const game = await pair({ turnMs: 1500 });
  try {
    await game.a.page.evaluate(() => {
      const frozen = Date.now();
      Date.now = () => frozen;
    });
    await visible
      .poll(() => state(game.a.page).then((current) => current?.shotNo), { timeout: 8000 })
      .toBeGreaterThanOrEqual(1);
    await visible
      .poll(() => state(game.b.page).then((current) => current?.shotNo), { timeout: 8000 })
      .toBeGreaterThanOrEqual(1);
    expect(room(game.code).inspect().acceptedShots).toBe(0);
    expect(room(game.code).inspect().match?.shotNo).toBeGreaterThanOrEqual(1);
  } finally {
    await game.close();
  }
});

test('surrender is server-confirmed, volume persists, and cancelled exit keeps the same match', async () => {
  const game = await pair();
  try {
    await game.a.page.locator('.menu-btn').click();
    await visible(game.a.page.locator('.menu .close')).toBeFocused();
    await game.a.page.keyboard.press('Tab');
    await visible(game.a.page.locator('.menu .skin')).toBeFocused();
    await game.a.page.keyboard.press('Shift+Tab');
    await visible(game.a.page.locator('.menu .close')).toBeFocused();
    await game.a.page.keyboard.press('Escape');
    await visible(game.a.page.locator('.menu')).toBeHidden();
    await visible(game.a.page.locator('.menu-btn')).toBeFocused();
    await game.a.page.locator('.menu-btn').click();
    await game.a.page.getByRole('slider', { name: '比赛音量' }).fill('25');
    expect(await game.a.page.evaluate(() => localStorage.getItem('pz_volume'))).toBe('0.25');
    game.a.page.once('dialog', (dialog) => dialog.dismiss());
    await game.a.page.locator('.menu .exit').click();
    await visible(game.a.page.locator('.stage canvas')).toBeVisible();
    expect(room(game.code).inspect().phase).toBe('playing');
    game.a.page.once('dialog', (dialog) => dialog.accept());
    await game.a.page.locator('.menu .surrender').click();
    await visible.poll(() => state(game.b.page).then((current) => current?.over)).toBe(true);
    expect(room(game.code).inspect().match?.endReason).toBe('surrender');
    expect(
      (
        await db.query("SELECT balance::text FROM wallets WHERE user_id = $1 AND currency = 'coins'", [
          game.a.account!.userId,
        ])
      ).rows[0].balance,
    ).toBe('300');
    await game.a.page.locator('.result .back').click();
    await visible(game.a.page).toHaveURL(`${origin}/`);
    expect(await game.a.page.evaluate(() => '__pz' in window)).toBe(false);
  } finally {
    await game.close();
  }
});

test('a dropped account connection disables input and reconnects with a fresh ticket to the original seat', async () => {
  const game = await pair();
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  await game.a.page.route('**/api/v1/matches/tickets', async (route) => {
    await gate;
    await route.continue();
  });
  try {
    const before = room(game.code).inspect().matchId;
    const ticketsBefore = (
      await db.query('SELECT nonce_hash FROM match_tickets WHERE user_id = $1', [game.a.account!.userId])
    ).rows.length;
    room(game.code).clients[0].leave(1012);
    await visible(game.a.page.locator('.turn')).toContainText('恢复');
    expect(await canAim(game.a.page)).toBe(false);
    await visible(game.b.page.locator('.turn')).toContainText('对手断线');
    resume();
    await visible
      .poll(() => game.a.page.getByText('账号好友赛 · 服务端计时', { exact: true }).isVisible(), { timeout: 10000 })
      .toBe(true);
    expect(await game.a.page.evaluate(() => (window as unknown as { __pz: Automation }).__pz.mySides())).toEqual([0]);
    expect(room(game.code).inspect().matchId).toBe(before);
    expect(
      (await db.query('SELECT nonce_hash FROM match_tickets WHERE user_id = $1', [game.a.account!.userId])).rows.length,
    ).toBe(ticketsBefore + 1);
  } finally {
    resume();
    await game.close();
  }
});

test('ban while disconnected rejects re-entry and leaves gameplay disabled', async () => {
  const game = await pair();
  try {
    await new AccountRepository(db).transitionStatus(game.a.account!.userId, 'banned');
    room(game.code).clients[0].leave(1012);
    await visible(game.a.page.getByRole('heading', { name: '连接已断开' })).toBeVisible({ timeout: 12000 });
    expect(await canAim(game.a.page)).toBe(false);
  } finally {
    await game.close();
  }
});

test('cancelling a delayed entry never joins after navigating back to the lobby', async () => {
  const actor = await pageIn();
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let entered = false;
  await actor.page.route('**/api/v1/matches/tickets', async (route) => {
    entered = true;
    await gate;
    await route.continue();
  });
  try {
    await actor.page.goto(`${origin}/room`);
    await actor.page.getByRole('button', { name: '创建房间', exact: true }).click();
    await visible.poll(() => entered).toBe(true);
    actor.page.once('dialog', (dialog) => dialog.accept());
    await actor.page.getByRole('button', { name: '取消连接', exact: true }).click();
    resume();
    await visible(actor.page).toHaveURL(`${origin}/`);
    await visible
      .poll(
        async () =>
          (await db.query('SELECT room_code FROM match_tickets WHERE user_id = $1', [actor.account!.userId])).rows
            .length,
      )
      .toBe(1);
    const code = (await db.query('SELECT room_code FROM match_tickets WHERE user_id = $1', [actor.account!.userId]))
      .rows[0].room_code;
    expect(room(code)?.clients.length ?? 0).toBe(0);
    expect(await actor.page.locator('.stage canvas').count()).toBe(0);
  } finally {
    resume();
    await actor.context.close();
  }
});

test('account switch closes the old view and cannot claim that account’s playing seat', async () => {
  const game = await pair();
  try {
    const next = await seed(game.a.context);
    await game.a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await visible(game.a.page.getByRole('button', { name: '加入房间', exact: true })).toBeEnabled();
    expect(await game.a.page.locator('.stage canvas').count()).toBe(0);
    await game.a.page.getByRole('button', { name: '加入房间', exact: true }).click();
    await visible(game.a.page.getByRole('alert')).toContainText('房间');
    expect(
      (await db.query('SELECT nonce_hash FROM match_tickets WHERE user_id = $1', [next.userId])).rows,
    ).toHaveLength(0);
  } finally {
    await game.close();
  }
});

test('320/768/1440 room views scroll without horizontal overflow and gameplay controls avoid pieces', async () => {
  const actor = await pageIn();
  try {
    await actor.page.goto(`${origin}/room`);
    await visible(actor.page.getByRole('button', { name: '创建房间', exact: true })).toBeEnabled();
    for (const width of [320, 768, 1440]) {
      await actor.page.setViewportSize({ width, height: 800 });
      expect(await actor.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await actor.page.getByRole('button', { name: '创建房间', exact: true }).scrollIntoViewIfNeeded();
      await visible(actor.page.getByRole('button', { name: '创建房间', exact: true })).toBeInViewport();
    }
    await actor.page.screenshot({ path: path.join(screenshots, 'room-desktop.png') });
    await actor.page.setViewportSize({ width: 320, height: 740 });
    await actor.page.screenshot({ path: path.join(screenshots, 'room-mobile.png') });
  } finally {
    await actor.context.close();
  }
  const game = await pair();
  try {
    for (const player of [game.a, game.b]) {
      await player.page.bringToFront();
      for (const width of [320, 768, 1440]) {
        await player.page.setViewportSize({ width, height: 800 });
        await player.page.evaluate(
          () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const blocked = await player.page.evaluate(() => {
          const api = (window as unknown as { __pz: Automation }).__pz;
          const canvas = document.querySelector('.stage canvas');
          return api
            .state()
            .pieces.filter((piece) => piece.out === 0)
            .filter((piece) => {
              const point = api.screenOf(piece.x, piece.y);
              return document.elementFromPoint(point.x, point.y) !== canvas;
            })
            .map((piece) => piece.id);
        });
        expect(blocked).toEqual([]);
      }
    }
    await game.b.page.setViewportSize({ width: 390, height: 844 });
    await game.b.page.screenshot({ path: path.join(screenshots, 'match-mobile.png') });
  } finally {
    await game.close();
  }
});

test('known-room re-entry in a new page mounts the resumed match and replaces only the same account connection', async () => {
  const game = await pair();
  try {
    const matchId = room(game.code).inspect().matchId;
    const replacement = await game.a.context.newPage();
    replacement.on('pageerror', (error) => errors.push(error.message));
    await join({ ...game.a, page: replacement }, game.code);
    await visible(replacement.locator('.stage canvas')).toBeVisible();
    await visible.poll(() => state(replacement)).toBeTruthy();
    expect(await replacement.evaluate(() => (window as unknown as { __pz: Automation }).__pz.mySides())).toEqual([0]);
    expect(room(game.code).inspect().matchId).toBe(matchId);
    expect(await canAim(game.a.page)).toBe(false);
  } finally {
    await game.close();
  }
});

test('a public maintenance announcement does not freeze input in an already authenticated running match', async () => {
  const game = await pair();
  try {
    const actor = (await state(game.a.page))!.turn === 0 ? game.a : game.b;
    await actor.page.route('**/api/v1/config/manifest', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.data.maintenance = true;
      body.data.availableModes = ['practice'];
      await route.fulfill({ response, json: body });
    });
    const refreshed = actor.page.waitForResponse((response) => response.url().endsWith('/config/manifest'));
    await actor.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await refreshed;
    await visible(actor.page.getByText('服务维护中 · 本场继续计时', { exact: true })).toBeVisible();
    await visible.poll(() => canAim(actor.page)).toBe(true);
    expect(room(game.code).inspect().phase).toBe('playing');
  } finally {
    await game.close();
  }
});

test('refresh recovery uses the original match despite a newer lineup and obtains a new ticket after a network drop', async () => {
  const game = await pair();
  try {
    const matchId = room(game.code).inspect().matchId,
      before = room(game.code).inspect().seq;
    await db.query('UPDATE lineups SET revision=revision+1 WHERE user_id=$1', [game.a.account!.userId]);
    const requests: unknown[] = [];
    game.a.page.on('request', (request) => {
      if (request.url().endsWith(`/${matchId}/reentry`)) requests.push(request.postDataJSON());
    });
    game.a.page.once('dialog', (dialog) => void dialog.accept());
    await game.a.page.reload();
    await visible(game.a.page.getByRole('button', { name: '恢复对局', exact: true })).toBeEnabled();
    await game.a.page.getByRole('button', { name: '恢复对局', exact: true }).click();
    await visible(game.a.page.locator('.stage canvas')).toBeVisible();
    await visible.poll(() => state(game.a.page)).toBeTruthy();
    expect(room(game.code).inspect()).toMatchObject({ matchId, seq: before });
    expect(requests).toEqual([{ protocol: 2 }]);
    expect(new URL(game.a.page.url()).search).toBe('');
    const active = room(game.code) as unknown as {
      seats: { account?: { userId: string }; client?: { leave(code: number): void } }[];
    };
    active.seats.find((seat) => seat.account?.userId === game.a.account!.userId)!.client!.leave(1012);
    await visible.poll(() => requests.length).toBeGreaterThan(1);
    await visible.poll(() => game.a.page.getByText('账号好友赛 · 服务端计时', { exact: true }).isVisible()).toBe(true);
    expect(room(game.code).inspect().matchId).toBe(matchId);
    expect(requests.every((body) => JSON.stringify(body) === '{"protocol":2}')).toBe(true);
  } finally {
    await game.close();
  }
});

test('a killed browser process recovers its own match from a fresh process using login cookies alone', async () => {
  const previousServer = await chromium.launchServer({ headless: true });
  let nextServer: Awaited<ReturnType<typeof chromium.launchServer>> | undefined;
  let killed = false;
  const partner = await pageIn();
  try {
    const previous = await chromium.connect(previousServer.wsEndpoint());
    const context = await previous.newContext({ viewport: { width: 390, height: 844 } });
    const account = await seed(context),
      page = await context.newPage();
    observe(page);
    const actor = { context, page, account };
    const code = await create(actor);
    await join(partner, code);
    await kickoff(actor, partner);
    const matchId = room(code).inspect().matchId,
      seq = room(code).inspect().seq;
    const cookies = (await context.storageState()).cookies;
    const oldPid = previousServer.process().pid;
    await previousServer.kill();
    killed = true;
    nextServer = await chromium.launchServer({ headless: true });
    expect(nextServer.process().pid).not.toBe(oldPid);
    const next = await chromium.connect(nextServer.wsEndpoint());
    const clean = await next.newContext({
      storageState: { cookies, origins: [] },
      viewport: { width: 390, height: 844 },
    });
    const fresh = await clean.newPage();
    observe(fresh);
    await fresh.goto(origin);
    await visible(fresh.getByRole('link', { name: '继续对局', exact: true })).toBeVisible();
    await fresh.getByRole('link', { name: '继续对局', exact: true }).click();
    await visible(fresh.getByRole('button', { name: '恢复对局', exact: true })).toBeEnabled();
    await fresh.setViewportSize({ width: 320, height: 700 });
    expect(
      await fresh.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
    await fresh.screenshot({ path: path.join(screenshots, 'net03-recovery-prompt.png') });
    await fresh.getByRole('button', { name: '恢复对局', exact: true }).click();
    await visible(fresh.locator('.stage canvas')).toBeVisible();
    await visible.poll(() => state(fresh)).toBeTruthy();
    expect(await fresh.evaluate(() => (window as unknown as { __pz: Automation }).__pz.mySides())).toEqual([0]);
    expect(room(code).inspect()).toMatchObject({ matchId, seq });
    expect(
      await fresh.evaluate(() => Object.keys(localStorage).some((key) => /ticket|seatToken|active.?match/i.test(key))),
    ).toBe(false);
    await fresh.screenshot({ path: path.join(screenshots, 'net03-new-process-recovery.png') });
    await clean.close();
  } finally {
    await nextServer?.close();
    if (!killed) await previousServer.close();
    await partner.context.close();
  }
}, 60000);

test('room browser runtime has no unexpected console or page errors', () => {
  expect(errors).toEqual([]);
});
