import { randomBytes, randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { build } from 'vite';
import { chromium, expect as browserExpect, type Browser, type Page, type BrowserContext } from 'playwright/test';
import { beforeAll, afterAll, test, expect } from 'vitest';
import { AccountRepository, Database, migrateDatabase } from '@pengzhuang/persistence';
import { readRuntimeConfig } from '../config/runtime';
import { createGameServer } from '../server/app';
import { EmailAccounts } from '../server/accounts/email-accounts';
import { createAccountMail } from '../server/accounts/mail';
import { Passwords } from '../server/accounts/passwords';
import { Sessions } from '../server/accounts/sessions';
import { AccountLifecycle } from '../server/accounts/lifecycle';
import { WebSessions } from '../server/api/web-sessions';
import { authOptionsModule } from '../server/api/auth-options';
import { emailAuthModule } from '../server/api/email-auth';
import { currentUserModule } from '../server/api/current-user';
import { lifecycleModules } from '../server/api/lifecycle';
import { LocalImports } from '../server/accounts/local-import';
import { localImportModule } from '../server/api/local-import';
import { PlayerData } from '../server/accounts/player-data';
import { playerDataModule } from '../server/api/player-data';
import { Assets } from '../server/accounts/assets';
import type { LobbyContent } from '../packages/contracts/src/lobby';
import { DEFAULT_DATA } from '../shared/data';
import { createBundledEconomyConfiguration } from '../config/economy';
import { freePort, startMailpit } from './helpers/mailpit';
import { jsonRequest } from './helpers/json-http';

let db: Database;
let mailpit: Awaited<ReturnType<typeof startMailpit>>;
let server: ReturnType<typeof createGameServer>;
let mail: EmailAccounts;
let browser: Browser;
let origin: string;
let assets: Assets;
let lobbyContent: LobbyContent = { version: 'lobby-test-1', announcements: [] };
let seedUnboundBrowser: (context: BrowserContext) => Promise<void>;
const password = '真实浏览器-123456789';
const errors: string[] = [];
const screenshotDirectory = path.resolve('work/acc07-browser');
beforeAll(async () => {
  if (!process.env.PG_TEST_TMP_DIR) throw new Error('Isolated fixture directory required');
  db = new Database({ connectionString: readRuntimeConfig({ ...process.env, APP_ENV: 'test' }).databaseUrl! });
  await migrateDatabase(db);
  await db.query('DELETE FROM auth_rate_limits');
  mailpit = await startMailpit('account-pages-mailpit');
  origin = `http://127.0.0.1:${await freePort()}`;
  const key = randomBytes(32).toString('base64url');
  const config = readRuntimeConfig({
    ...process.env,
    APP_ENV: 'test',
    PUBLIC_ORIGIN: origin,
    ALLOWED_ORIGINS: origin,
    SESSION_SIGNING_KEY: key,
    EMAIL_PROVIDER: 'mailpit',
    SMTP_URL: `smtp://127.0.0.1:${mailpit.smtpPort}`,
  });
  const passwords = new Passwords();
  const players = new PlayerData(db, createBundledEconomyConfiguration().policy, DEFAULT_DATA);
  assets = new Assets(db, players.initialize, () => ({
    policy: createBundledEconomyConfiguration().policy,
    data: DEFAULT_DATA,
  }));
  mail = new EmailAccounts(db, createAccountMail(config), key, passwords, players.initialize);
  const sessions = new Sessions(db, key, origin, players.initialize);
  const web = new WebSessions(sessions, config, key);
  // Trusted fixture only; this does not claim a real WeChat platform exchange.
  seedUnboundBrowser = async (context) => {
    const repo = new AccountRepository(db);
    const user = await repo.createUser();
    await repo.linkIdentity({
      userId: user.id,
      provider: 'wechat',
      providerAppId: 'fixture',
      providerSubject: randomUUID(),
    });
    await repo.setPasswordCredential({ userId: user.id, passwordHash: await passwords.hash(password) });
    const csrf = (await jsonRequest(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
    const credentials = await db.transaction((tx) => sessions.issue(tx, user.id, csrf, 'desktop'));
    await context.addCookies([
      { name: 'pz_csrf', value: csrf, url: origin },
      { name: 'pz_access', value: credentials.accessToken, url: origin, httpOnly: true },
      { name: 'pz_refresh', value: credentials.refreshToken, url: origin, httpOnly: true },
    ]);
  };
  const lifecycle = new AccountLifecycle(
    db,
    passwords,
    { enabled: true, graceHours: 168, version: 'browser-test-v1' },
    mail,
    null,
  );
  const directory = path.join(process.env.PG_TEST_TMP_DIR, 'account-pages-client');
  await build({ configFile: path.resolve('client/vite.config.ts'), logLevel: 'silent', build: { outDir: directory } });
  server = createGameServer({
    readLobbyContent: () => lobbyContent,
    repository: db,
    clientDirectory: directory,
    modules: [
      authOptionsModule(true, false, web),
      web.module(),
      currentUserModule(web),
      playerDataModule(players, web),
      localImportModule(new LocalImports(db, players.initialize, () => DEFAULT_DATA), web),
      ...lifecycleModules(lifecycle, web),
      emailAuthModule(mail, web),
    ],
  });
  await server.gameServer.listen(Number(new URL(origin).port));
  mail.startMailDelivery();
  browser = await chromium.launch({ headless: true });
  mkdirSync(screenshotDirectory, { recursive: true });
}, 90000);
afterAll(async () => {
  await browser?.close();
  await mail?.close();
  await server?.close();
  await db?.close();
  await mailpit?.close();
});
async function pageIn(context?: BrowserContext, expectedTransportFailure = false) {
  const ctx = context ?? (await browser.newContext({ viewport: { width: 390, height: 844 } }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !/Failed to load resource:.*(?:400|401|403|409|429)/.test(message.text()) &&
      !(
        expectedTransportFailure &&
        /net::ERR_(?:FAILED|INTERNET_DISCONNECTED)|Failed to load resource:.*(?:500|503)/.test(message.text())
      )
    )
      errors.push(message.text());
  });
  return { page, context: ctx };
}
async function register(page: Page) {
  const email = `browser-${randomUUID()}@example.test`;
  await page.goto(`${origin}/account/register`);
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('新密码', { exact: true }).fill(password);
  await page.getByLabel('昵称', { exact: true }).fill('球');
  await page.getByRole('button', { name: '注册并发送验证邮件', exact: true }).click();
  await browserExpect(page.getByText('申请已收到。', { exact: false })).toBeVisible();
  const token = await mailpit.token(email, 'verify');
  await page.goto(`${origin}/account/verify#${token}`);
  await browserExpect(page.getByRole('button', { name: '验证邮箱', exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await page.getByRole('button', { name: '验证邮箱', exact: true }).click();
  await browserExpect(page.getByText('邮箱已验证，可以登录。', { exact: false })).toBeVisible();
  return email;
}
async function login(page: Page, email: string, secret = password) {
  await page.goto(`${origin}/login`);
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(secret);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await browserExpect(page.getByRole('heading', { name: '我的账号', exact: true })).toBeVisible();
  await browserExpect(page.getByText('电脑浏览器 · 当前设备', { exact: true })).toBeVisible();
}
test('real UI registers, verifies via SMTP, follows the login guard and logs out without storing credentials', async () => {
  const { page, context } = await pageIn();
  try {
    const email = await register(page);
    await page.goto(`${origin}/profile`);
    await page.waitForURL('**/login');
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    let attempts = 0;
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/api/v1/auth/login') attempts++;
    });
    await page.getByRole('button', { name: '登录', exact: true }).dblclick();
    await browserExpect(page.getByRole('heading', { name: '我的账号', exact: true })).toBeVisible();
    expect(attempts).toBe(1);
    await browserExpect(page.getByText('邮箱：已绑定', { exact: false })).toBeVisible();
    expect(
      await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })),
    ).toEqual({ local: [], session: [] });
    const cookies = await context.cookies();
    expect(
      cookies
        .filter((cookie) => cookie.name === 'pz_access' || cookie.name === 'pz_refresh')
        .every((cookie) => cookie.httpOnly),
    ).toBe(true);
    await page.screenshot({ path: path.join(screenshotDirectory, 'profile-mobile.png') });
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.waitForURL('**/login');
    await page.getByRole('link', { name: '先练习', exact: true }).click();
    await page.waitForSelector('.game canvas');
  } finally {
    await context.close();
  }
}, 60000);

test('forgot-password email resets the real password and revokes the already logged-in browser', async () => {
  const { page, context } = await pageIn();
  try {
    const email = await register(page);
    await login(page, email);
    const other = await pageIn(context);
    await other.page.goto(`${origin}/account/forgot`);
    await other.page.getByLabel('邮箱', { exact: true }).fill(email);
    await other.page.getByRole('button', { name: '发送邮件', exact: true }).click();
    await browserExpect(other.page.getByText('申请已收到，请查收邮件', { exact: false })).toBeVisible();
    const token = await mailpit.token(email, 'reset');
    await other.page.goto(`${origin}/account/reset#${token}`);
    await other.page.getByLabel('新密码', { exact: true }).fill(`${password}-new`);
    await other.page.getByRole('button', { name: '重设密码', exact: true }).click();
    await browserExpect(other.page.getByText('其他设备已退出', { exact: false })).toBeVisible();
    await page.waitForURL('**/login');
    await login(other.page, email, `${password}-new`);
    await other.page.goto(`${origin}/account/reset#${token}`);
    await other.page.getByLabel('新密码', { exact: true }).fill(`${password}-again`);
    await other.page.getByRole('button', { name: '重设密码', exact: true }).click();
    await browserExpect(other.page.getByText('邮件链接可能已失效', { exact: false })).toBeVisible();
  } finally {
    await context.close();
  }
}, 60000);

test('another tab logout invalidates the visible account and a successful refresh is bounded', async () => {
  const { page, context } = await pageIn();
  try {
    const email = await register(page);
    await login(page, email);
    await context.clearCookies({ name: 'pz_access' });
    let refreshes = 0;
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/api/v1/auth/refresh') refreshes++;
    });
    await page.reload();
    await browserExpect(page.getByRole('heading', { name: '我的账号', exact: true })).toBeVisible();
    await browserExpect(page.getByText('电脑浏览器 · 当前设备', { exact: true })).toBeVisible();
    expect(refreshes).toBe(1);
    const second = await pageIn(context);
    await second.page.goto(`${origin}/profile`);
    await second.page.getByRole('button', { name: '退出全部设备', exact: true }).click();
    await page.waitForURL('**/login');
    await second.page.waitForURL('**/login');
  } finally {
    await context.close();
  }
}, 60000);

test('logout with a lost response remains pending and explicitly retries the same committed receipt', async () => {
  const { page, context } = await pageIn(undefined, true);
  try {
    const email = await register(page);
    await login(page, email);
    const keys: string[] = [];
    await page.route('**/api/v1/auth/logout', async (route) => {
      keys.push(route.request().headers()['idempotency-key']);
      await route.fetch();
      await route.abort('failed');
    });
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await browserExpect(page.getByText('退出结果尚未确认。', { exact: false })).toBeVisible();
    await page.unroute('**/api/v1/auth/logout');
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/api/v1/auth/logout') keys.push(req.headers()['idempotency-key']);
    });
    await page.getByRole('button', { name: '重试退出', exact: true }).click();
    await page.waitForURL('**/login');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  } finally {
    await context.close();
  }
}, 60000);

test('UI deletion requires proof/confirmation and can be queried/cancelled with fresh credentials', async () => {
  const { page, context } = await pageIn();
  try {
    const email = await register(page);
    await login(page, email);
    await page.getByLabel('当前账号密码', { exact: true }).fill(password);
    await page.getByLabel('输入 DELETE 确认注销', { exact: true }).fill('DELETE');
    await page.getByRole('button', { name: '申请注销并退出', exact: true }).click();
    await page.waitForURL('**/account/deletion');
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '查询注销状态', exact: true }).click();
    await browserExpect(page.getByText('等待注销，计划于', { exact: false })).toBeVisible();
    await page.getByLabel('我希望取消待执行的注销').check();
    await page.getByRole('button', { name: '确认取消注销', exact: true }).click();
    await browserExpect(page.getByText('注销已取消，请重新登录。', { exact: true })).toBeVisible();
    await login(page, email);
  } finally {
    await context.close();
  }
}, 60000);

test('rate limiting and invalid links show fixed user messages without exposing server details', async () => {
  const { page, context } = await pageIn();
  try {
    const email = `limited-${randomUUID()}@example.test`;
    const digest = createHash('sha256').update(`login:email:${email}`).digest('hex');
    await db.query(
      'INSERT INTO auth_rate_limits(key_hash, bucket_start, attempts) VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / 900) * 900), 10)',
      [digest],
    );
    await page.goto(`${origin}/login`);
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await browserExpect(page.getByText('操作太频繁，请稍后再试。', { exact: true })).toBeVisible();
    await page.goto(`${origin}/account/verify#not-a-valid-token`);
    await browserExpect(page.getByText('邮件链接无效', { exact: false })).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
    expect(await page.locator('body').innerText()).not.toMatch(/password_hash|stack|postgresql:/);
  } finally {
    await context.close();
  }
});

test('account forms remain accessible at small widths, large text and a keyboard-sized viewport', async () => {
  const { page, context } = await pageIn();
  try {
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 420 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/login`);
      await browserExpect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled();
      await page.getByLabel('邮箱', { exact: true }).focus();
      await page.keyboard.press('Tab');
      await browserExpect(page.getByLabel('密码', { exact: true })).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: '登录', exact: true }).scrollIntoViewIfNeeded();
      if (viewport.width === 320) await page.screenshot({ path: path.join(screenshotDirectory, 'login-320.png') });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.style.setProperty('--web-font-scale', '1.4'));
    expect(
      await page.getByLabel('邮箱', { exact: true }).evaluate((input) => parseFloat(getComputedStyle(input).fontSize)),
    ).toBeGreaterThanOrEqual(22);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await context.close();
  }
});

test('the binding UI uses current proof and a real mailbox before enabling the new email login', async () => {
  const { page, context } = await pageIn();
  try {
    await seedUnboundBrowser(context);
    await page.goto(`${origin}/profile`);
    const email = `bound-${randomUUID()}@example.test`;
    await page.getByLabel('要绑定的邮箱', { exact: true }).fill(email);
    await page.getByLabel('当前账号密码', { exact: true }).first().fill(password);
    await page.getByLabel('新密码', { exact: true }).fill(`${password}-bound`);
    await page.getByRole('button', { name: '验证并发送绑定邮件', exact: true }).click();
    await browserExpect(page.getByText('请在当前浏览器打开绑定邮件', { exact: false })).toBeVisible();
    const token = await mailpit.token(email, 'link');
    await page.goto(`${origin}/account/link#${token}`);
    await page.getByLabel('原账号密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '确认邮箱绑定', exact: true }).click();
    await browserExpect(page.getByText('邮箱已绑定。', { exact: false })).toBeVisible();
    await page.getByRole('link', { name: '返回我的', exact: true }).click();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await login(page, email, `${password}-bound`);
  } finally {
    await context.close();
  }
}, 60000);

test('real browser previews an old save, retries a lost import response, and retains only safe preferences', async () => {
  const { page, context } = await pageIn(undefined, true);
  try {
    await seedUnboundBrowser(context);
    await page.goto(`${origin}/profile`);
    await page.evaluate(
      (team) => {
        localStorage.setItem('pz_nick', '旧球员');
        localStorage.setItem('pz_skin', 'classic');
        localStorage.setItem('pz_muted', '1');
        localStorage.setItem('pz_lineups', JSON.stringify({ active: 0, sets: [team] }));
        localStorage.setItem('pz_profile', JSON.stringify({ cash: 999999999, diamond: 99999, level: 10 }));
        localStorage.setItem('pz_card_level', '10');
      },
      [...DEFAULT_DATA.rules.defaultLineup],
    );
    await page.getByRole('button', { name: '检查旧本地存档', exact: true }).click();
    await browserExpect(page.getByText('昵称草稿：旧球员', { exact: true })).toBeVisible();
    let lost = false;
    await page.route('**/api/v1/me/local-import', async (route) => {
      if (route.request().method() === 'POST' && !lost) {
        lost = true;
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await page.getByRole('button', { name: '确认导入到当前账号', exact: true }).click();
    await browserExpect(page.getByText('可保留本次预览重试。', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '确认导入到当前账号', exact: true }).click();
    await browserExpect(page.getByText('当前账号已完成导入。', { exact: true })).toBeVisible();
    await browserExpect(page.getByText('已保存 1 套持有卡阵容偏好', { exact: false })).toBeVisible();
    const me = await context.request.get(`${origin}/api/v1/me`);
    expect(me.ok()).toBe(true);
    const userId = (await me.json()).data.userId;
    expect(
      (await db.query("SELECT balance::text FROM wallets WHERE user_id=$1 AND currency='coins'", [userId])).rows[0]
        .balance,
    ).toBe('300');
    expect(
      (await db.query('SELECT level FROM owned_cards WHERE user_id=$1', [userId])).rows.every((row) => row.level === 1),
    ).toBe(true);
    await page.evaluate(() => {
      localStorage.setItem('pz_skin', 'orig_2016');
      localStorage.setItem('pz_muted', '0');
    });
    await page.getByRole('button', { name: '在本机使用导入设置', exact: true }).click();
    expect(
      await page.evaluate(() => [
        localStorage.getItem('pz_skin'),
        localStorage.getItem('pz_muted'),
        JSON.parse(localStorage.getItem('pz_profile')!).cash,
      ]),
    ).toEqual(['classic', '1', 999999999]);
    await page.reload();
    await page.getByRole('button', { name: '检查旧本地存档', exact: true }).click();
    await browserExpect(page.getByText('当前账号已完成导入。', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(screenshotDirectory, 'local-import-mobile.png') });
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.waitForURL('**/login');
    await seedUnboundBrowser(context);
    await page.goto(`${origin}/profile`);
    await page.getByRole('button', { name: '检查旧本地存档', exact: true }).click();
    await browserExpect(page.getByRole('button', { name: '确认导入到当前账号', exact: true })).toBeVisible();
    await browserExpect(page.getByText('当前账号已完成导入。', { exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
test('browser explains corrupt and blocked local saves without submitting an import', async () => {
  const { page, context } = await pageIn();
  try {
    await seedUnboundBrowser(context);
    await page.goto(`${origin}/profile`);
    await page.evaluate(() => {
      localStorage.setItem('pz_lineups', '{broken');
      localStorage.setItem('pz_muted', 'invalid');
    });
    await page.getByRole('button', { name: '检查旧本地存档', exact: true }).click();
    await browserExpect(page.getByText('旧阵容存档损坏，已跳过。', { exact: true })).toBeVisible();
    await browserExpect(page.getByText('没有可导入的合法偏好。', { exact: false })).toBeVisible();
    await browserExpect(page.getByRole('button', { name: '确认导入到当前账号', exact: true })).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('blocked');
        },
      });
    });
    await page.getByRole('button', { name: '检查旧本地存档', exact: true }).click();
    await browserExpect(page.getByText('浏览器不允许读取本地存档。', { exact: false })).toBeVisible();
  } finally {
    await context.close();
  }
});
test('real email login returns to the lobby and refreshes exact server assets without losing the selected mode', async () => {
  const { page, context } = await pageIn();
  try {
    const email = await register(page);
    await page.evaluate(() => {
      localStorage.setItem('pz_profile', JSON.stringify({ cash: 999999999, level: 10 }));
    });
    await page.goto(`${origin}/`);
    await page.getByRole('button', { name: '登录账号', exact: true }).click();
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForURL(`${origin}/`);
    await browserExpect(page.locator('[data-wallet="coins"]')).toHaveText('300');
    await browserExpect(page.getByText('持有卡：5 张', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '均衡好友赛', exact: true }).click();
    await browserExpect(page.locator('[data-mode-summary]')).toContainText('统一 Lv5');
    const me = (await (await context.request.get(`${origin}/api/v1/me`)).json()).data;
    const operationId = randomUUID();
    await assets.grantTrusted({
      userId: me.userId,
      operationId,
      sourceId: operationId,
      reason: 'admin.correction',
      coins: '100',
    });
    await page.getByRole('button', { name: '刷新大厅数据', exact: true }).click();
    await browserExpect(page.locator('[data-wallet="coins"]')).toHaveText('400');
    await browserExpect(page.getByRole('button', { name: '均衡好友赛', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const exactId = randomUUID();
    await assets.grantTrusted({
      userId: me.userId,
      operationId: exactId,
      sourceId: exactId,
      reason: 'admin.correction',
      coins: '9007199254740593',
    });
    await page.getByRole('button', { name: '刷新大厅数据', exact: true }).click();
    await browserExpect(page.locator('[data-wallet="coins"]')).toHaveText('9,007,199,254,740,993');
    await page.locator('[data-wallet="coins"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshotDirectory, 'lobby-account-mobile.png') });
    await page.getByRole('link', { name: '账号资料与设备', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: '我的账号', exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
}, 60000);
test('slow, failed and empty lobby data never invent a zero balance and an expired session clears private data', async () => {
  const { page, context } = await pageIn(undefined, true);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let phase: 'slow' | 'failure' | 'empty' | 'ready' = 'slow';
  try {
    await seedUnboundBrowser(context);
    await page.route('**/api/v1/me/lobby', async (route) => {
      if (phase === 'slow') {
        await gate;
        await route.continue();
      } else if (phase === 'failure')
        await route.fulfill({
          status: 503,
          json: {
            ok: false,
            error: { code: 'UNAVAILABLE', message: 'Generic failure', retryable: true },
            requestId: randomUUID(),
          },
        });
      else if (phase === 'empty') {
        const response = await route.fetch();
        const body = await response.json();
        body.data = { ...body.data, profile: null, wallets: [], cardCount: 0, defaultLineup: null };
        await route.fulfill({ response, json: body });
      } else await route.continue();
    });
    await page.goto(`${origin}/`);
    await browserExpect(page.getByText('正在读取云端资产，余额尚未确认…', { exact: true })).toBeVisible();
    await browserExpect(page.locator('[data-wallet]')).toHaveCount(0);
    release();
    await browserExpect(page.locator('[data-wallet="coins"]')).toHaveText('300');
    phase = 'failure';
    await page.getByRole('button', { name: '刷新大厅数据', exact: true }).click();
    await browserExpect(page.getByText('未能读取资产，余额尚未确认。', { exact: true })).toBeVisible();
    await browserExpect(page.locator('[data-wallet]')).toHaveCount(0);
    phase = 'empty';
    await page.getByRole('button', { name: '刷新大厅数据', exact: true }).click();
    await browserExpect(page.locator('[data-wallet="coins"]')).toHaveText('尚未建立');
    await browserExpect(page.getByText('尚无云端阵容。', { exact: true })).toBeVisible();
    phase = 'ready';
    await page.getByRole('button', { name: '刷新大厅数据', exact: true }).click();
    await browserExpect(page.locator('[data-wallet="coins"]')).toHaveText('300');
    const me = (await (await context.request.get(`${origin}/api/v1/me`)).json()).data;
    await db.query("UPDATE users SET status='banned',banned_at=clock_timestamp() WHERE id=$1", [me.userId]);
    await page.getByRole('button', { name: '刷新大厅数据', exact: true }).click();
    await browserExpect(page.getByRole('button', { name: '登录账号', exact: true })).toBeVisible();
    await browserExpect(page.locator('[data-wallet]')).toHaveCount(0);
  } finally {
    release();
    await context.close();
  }
});
test('lobby displays real published text and explicit maintenance, outdated and offline states', async () => {
  const { page, context } = await pageIn(undefined, true);
  let state: 'maintenance' | 'outdated' | 'ready' = 'maintenance';
  lobbyContent = {
    version: 'lobby-test-2',
    announcements: [
      {
        id: 'test-notice',
        title: '维护说明',
        body: '<img src=x onerror=alert(1)>\n测试公告正文',
        publishedAt: new Date(Date.now() - 60000).toISOString(),
        expiresAt: null,
      },
    ],
  };
  try {
    await page.route('**/api/v1/config/manifest', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.data.maintenance = state === 'maintenance';
      if (state === 'outdated') body.data.protocolVersions = [999];
      await route.fulfill({ response, json: body });
    });
    await page.goto(`${origin}/`);
    await browserExpect(page.getByRole('heading', { name: '服务维护中', exact: true })).toBeVisible();
    await browserExpect(page.getByRole('heading', { name: '维护说明', exact: true })).toBeVisible();
    await browserExpect(page.locator('article')).toContainText('<img src=x onerror=alert(1)>');
    await browserExpect(page.locator('article img')).toHaveCount(0);
    state = 'outdated';
    await page.getByRole('button', { name: '重新检查服务', exact: true }).click();
    await browserExpect(page.getByRole('heading', { name: '客户端版本过旧', exact: true })).toBeVisible();
    await browserExpect(page.getByRole('button', { name: '刷新客户端', exact: true })).toBeVisible();
    state = 'ready';
    await page.reload();
    await browserExpect(page.getByRole('button', { name: '自由练习', exact: true })).toBeVisible();
    await context.setOffline(true);
    await browserExpect(page.getByRole('heading', { name: '当前离线', exact: true })).toBeVisible();
    await browserExpect(page.getByRole('button', { name: '开始练习', exact: true })).toBeDisabled();
    await context.setOffline(false);
    await page.getByRole('button', { name: '开始练习', exact: true }).click();
    await page.waitForSelector('.game canvas');
    await page.locator('.menu-btn').click();
    await page.locator('.menu .exit').click();
    await context.setOffline(true);
    await page.getByRole('button', { name: '开始练习', exact: true }).click();
    await page.waitForSelector('.game canvas');
  } finally {
    lobbyContent = { version: 'lobby-test-1', announcements: [] };
    await context.setOffline(false);
    await context.close();
  }
});
test('browser pages produce no unexpected console errors or unhandled exceptions', () => {
  expect(errors).toEqual([]);
});
