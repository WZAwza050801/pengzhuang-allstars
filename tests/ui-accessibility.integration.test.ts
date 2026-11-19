import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeAll, afterAll, expect, test, vi } from 'vitest';
import {
  chromium,
  firefox,
  webkit,
  expect as visible,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { AccountRepository, Database, migrateDatabase } from '@pengzhuang/persistence';
import { startRuntime } from '../server/runtime';
import { readRuntimeConfig } from '../config/runtime';
import { PlayerData } from '../server/accounts/player-data';
import { Sessions } from '../server/accounts/sessions';
import { createBundledEconomyConfiguration } from '../config/economy';
import { DEFAULT_DATA } from '../shared/data';
import { rulesForMode } from '../config/modes';
import { MatchOutcomes } from '../server/matches/outcomes';
import { OutcomeJournal } from '../server/matches/outcome-journal';
import { Assets } from '../server/accounts/assets';
import { OutcomeIntentSchema } from '../packages/contracts/src/match-results';
import { freePort, startMailpit } from './helpers/mailpit';
import { jsonRequest } from './helpers/json-http';

const engines = { chromium, firefox, webkit };
type Engine = keyof typeof engines;
const names = Object.keys(engines) as Engine[];
const browsers = new Map<Engine, Browser>();
const report: { browsers: Record<string, string>; scans: unknown[]; layouts: unknown[]; scenarios: string[] } = {
  browsers: {},
  scans: [],
  layouts: [],
  scenarios: [],
};
const directory = path.resolve('work/ui07-browser');
let db: Database,
  server: Awaited<ReturnType<typeof startRuntime>>,
  inbox: Awaited<ReturnType<typeof startMailpit>>,
  sessions: Sessions,
  players: PlayerData,
  outcomes: MatchOutcomes,
  origin: string;
beforeAll(async () => {
  if (!process.env.PG_TEST_TMP_DIR) throw new Error('Isolated PostgreSQL required');
  db = new Database({ connectionString: readRuntimeConfig({ ...process.env, APP_ENV: 'test' }).databaseUrl! });
  await migrateDatabase(db);
  await db.query('DELETE FROM auth_rate_limits');
  inbox = await startMailpit('ui07-mailpit');
  origin = `http://127.0.0.1:${await freePort()}`;
  const key = randomBytes(32).toString('base64url');
  const config = readRuntimeConfig({
    ...process.env,
    APP_ENV: 'test',
    PUBLIC_ORIGIN: origin,
    ALLOWED_ORIGINS: origin,
    SESSION_SIGNING_KEY: key,
    EMAIL_PROVIDER: 'mailpit',
    SMTP_URL: `smtp://127.0.0.1:${inbox.smtpPort}`,
    ROOM_STORE_DIR: path.join(process.env.PG_TEST_TMP_DIR, 'ui07-runtime'),
  });
  const policy = createBundledEconomyConfiguration().policy;
  players = new PlayerData(db, policy, DEFAULT_DATA);
  sessions = new Sessions(db, key, origin, players.initialize);
  outcomes = new MatchOutcomes({
    db,
    assets: new Assets(db, players.initialize, () => ({ data: DEFAULT_DATA, policy })),
    policy: () => policy,
    journal: new OutcomeJournal(path.join(process.env.PG_TEST_TMP_DIR, 'ui07-fixture-outcomes')),
    onEvent: () => undefined,
  });
  const clientDirectory = path.join(process.env.PG_TEST_TMP_DIR, 'ui07-production-client');
  await promisify(execFile)(
    process.execPath,
    [
      path.resolve('node_modules/vite/bin/vite.js'),
      'build',
      '--config',
      path.resolve('client/vite.config.ts'),
      '--mode',
      'production',
      '--outDir',
      clientDirectory,
    ],
    { env: { ...process.env, NODE_ENV: 'production' }, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  vi.stubEnv('CLIENT_DIR', clientDirectory);
  server = await startRuntime(config, Number(new URL(origin).port));
  for (const name of names) {
    const browser = await engines[name].launch({ headless: true });
    browsers.set(name, browser);
    report.browsers[name] = browser.version();
  }
  mkdirSync(directory, { recursive: true });
}, 120000);
afterAll(async () => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'audit.json'), JSON.stringify(report, null, 2) + '\n');
  for (const browser of browsers.values()) await browser.close();
  await outcomes?.close();
  await server?.close();
  await inbox?.close();
  await db?.close();
  vi.unstubAllEnvs();
});
async function seed(context: BrowserContext) {
  const user = await new AccountRepository(db).createUser(),
    csrf = (await jsonRequest(origin, '/api/v1/auth/csrf')).data.data.csrfToken;
  const credentials = await db.transaction(async (tx) => {
    await players.initialize(tx, user.id);
    return sessions.issue(tx, user.id, csrf, 'desktop');
  });
  await context.addCookies([
    { name: 'pz_csrf', value: csrf, url: origin },
    { name: 'pz_access', value: credentials.accessToken, httpOnly: true, url: origin },
    { name: 'pz_refresh', value: credentials.refreshToken, httpOnly: true, url: origin },
  ]);
  return user.id;
}
async function ended(userId: string) {
  const other = await new AccountRepository(db).createUser(),
    matchId = randomUUID();
  await db.transaction((tx) => players.initialize(tx, other.id));
  const owners = [userId, other.id];
  const configurationHash = await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO matches(id,mode,config_version,protocol_version,status) VALUES ($1,'friend',$2,2,'playing')",
      [matchId, DEFAULT_DATA.version],
    );
    for (const [side, id] of owners.entries())
      await tx.query('INSERT INTO match_participants(match_id,user_id,side,lineup_snapshot) VALUES ($1,$2,$3,$4)', [
        matchId,
        id,
        side,
        JSON.stringify(
          (await tx.query('SELECT id,player_def_id,level FROM owned_cards WHERE user_id=$1 ORDER BY id LIMIT 5', [id]))
            .rows,
        ),
      ]);
    return outcomes.openInTransaction(tx, matchId, DEFAULT_DATA, rulesForMode(DEFAULT_DATA, 'friend'));
  });
  await outcomes.record(
    OutcomeIntentSchema.parse({
      schemaVersion: 1,
      protocol: 2,
      matchId,
      mode: 'friend',
      configurationHash,
      configVersion: DEFAULT_DATA.version,
      finalSeq: 0,
      score: [0, 0],
      winner: 0,
      reason: 'surrender',
      elapsedSeconds: 1,
      endedAt: new Date().toISOString(),
      participants: owners.map((id, side) => ({ userId: id, side, actions: 0 })),
    }),
  );
  await outcomes.drain();
  return matchId;
}
const dimensions = [
  [320, 568, 1],
  [360, 800, 2],
  [390, 844, 3],
  [430, 932, 3],
  [768, 1024, 2],
  [1280, 720, 1],
  [1440, 900, 2],
  [1920, 1080, 1],
] as const;
async function ready(page: Page, route: string) {
  await page.goto(origin + route);
  await visible(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  if (route === '/lineup') await visible(page.getByRole('button', { name: '保存阵容', exact: true })).toBeEnabled();
  if (route === '/room') await visible(page.getByRole('button', { name: '创建房间', exact: true })).toBeEnabled();
  if (route === '/results') {
    await visible(page.getByRole('heading', { name: '比赛记录', exact: true })).toBeVisible();
    await visible(page.getByRole('region', { name: '本人比赛记录', exact: true })).toHaveAttribute(
      'aria-busy',
      'false',
    );
  }
  if (/^\/result\/[0-9a-f-]{36}/.test(route))
    await visible(page.getByRole('heading', { name: '结算已完成', exact: true })).toBeVisible();
  await page.waitForTimeout(80);
}
async function keyActivate(page: Page, target: ReturnType<Page['getByRole']>) {
  await target.focus();
  await page.keyboard.press('Enter');
}
async function layout(page: Page) {
  return page.evaluate(() => {
    const issues: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('document-overflow');
    for (const element of document.querySelectorAll<HTMLElement>('main,section,form,fieldset,[role=dialog] .panel'))
      if (
        element.getClientRects().length &&
        !element.classList.contains('pz-sr-only') &&
        element.scrollWidth > element.clientWidth + 1
      )
        issues.push(`overflow:${element.tagName}:${element.getAttribute('aria-label') ?? ''}`);
    for (const element of document.querySelectorAll<HTMLElement>(
      'button,a[href],input:not([type=hidden]),select,textarea',
    )) {
      if (
        !element.getClientRects().length ||
        element.closest('[inert]') ||
        element.matches(':disabled') ||
        element.classList.contains('pz-skip')
      )
        continue;
      const rect = element.getBoundingClientRect(),
        label = (element as HTMLInputElement).labels?.[0]?.getBoundingClientRect();
      const inline = element.tagName === 'A' && element.parentElement?.tagName === 'P';
      if (
        !inline &&
        (rect.width < 43.5 || rect.height < 43.5) &&
        !(label && label.width >= 43.5 && label.height >= 43.5)
      )
        issues.push(
          `target:${element.tagName}:${element.textContent?.trim().slice(0, 30) ?? element.getAttribute('name')}`,
        );
    }
    return [...new Set(issues)];
  });
}
async function scanRoute(context: BrowserContext, name: Engine, route: string) {
  // Each audit owns a page; app navigation is exercised separately without axe injection.
  const page = await context.newPage();
  try {
    await ready(page, route);
    const result = await inspectPage(page, name);
    const violations = result.violations.map((item) => ({
      id: item.id,
      impact: item.impact,
      targets: item.nodes.map((node) => ({
        target: node.target,
        failureSummary: node.failureSummary,
        checks: node.any.map((check) => ({ id: check.id, data: check.data })),
      })),
    }));
    const sample = {
      engine: name,
      method: result.method,
      page: route.startsWith('/result/') ? '/result/:id' : route,
      violations,
      incomplete: result.incomplete.map((item) => item.id),
    };
    report.scans.push(sample);
    return violations.length ? sample : null;
  } finally {
    await page.close();
  }
}
interface Inspection {
  method: string;
  violations: {
    id: string;
    impact?: string | null;
    nodes: { target: unknown; failureSummary?: string; any: { id: string; data: unknown }[] }[];
  }[];
  incomplete: { id: string }[];
}
async function inspectPage(page: Page, name: Engine): Promise<Inspection> {
  if (name !== 'firefox') {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    return { ...result, method: 'axe-core wcag2/21/22 A+AA' };
  }
  // Headless Firefox 159 on this workstation intermittently crashes inside axe,
  // including fresh pages/production builds. Native DOM checks are reported as
  // a distinct method, never as an axe pass; all engines retain interaction tests.
  const issues = await page.evaluate(() => {
    const found: { id: string; target: string }[] = [];
    if (!document.documentElement.lang) found.push({ id: 'native-language', target: 'html' });
    if (document.querySelectorAll('main').length !== 1) found.push({ id: 'native-main', target: 'main' });
    if (document.querySelectorAll('h1').length !== 1) found.push({ id: 'native-heading', target: 'h1' });
    const ids = new Set<string>();
    for (const element of document.querySelectorAll<HTMLElement>('[id]')) {
      if (ids.has(element.id)) found.push({ id: 'native-duplicate-id', target: element.tagName });
      ids.add(element.id);
    }
    for (const element of document.querySelectorAll<HTMLElement>(
      'button,a[href],input:not([type=hidden]),select,textarea,[role=img],img',
    )) {
      if (!element.getClientRects().length || element.closest('[inert]')) continue;
      const labels = (element as HTMLInputElement).labels;
      const name =
        element.getAttribute('aria-label') ||
        element.getAttribute('aria-labelledby') ||
        (labels?.length ? [...labels].map((label) => label.textContent).join('') : element.textContent) ||
        element.getAttribute('alt') ||
        element.getAttribute('title');
      if (!name?.trim() && !(element.tagName === 'IMG' && element.getAttribute('alt') === ''))
        found.push({ id: 'native-control-name', target: `${element.tagName}:${element.getAttribute('name') ?? ''}` });
    }
    return found;
  });
  return {
    method: 'native DOM semantics (Firefox axe injection unsupported here)',
    violations: issues.map((issue) => ({
      id: issue.id,
      impact: 'serious',
      nodes: [{ target: [issue.target], any: [] }],
    })),
    incomplete: [],
  };
}
for (const name of names)
  test(`UI-07 ${name} opened and guarded pages have accessible semantics`, async () => {
    const context = await browsers
      .get(name)!
      .newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const failures: unknown[] = [];
    try {
      for (const route of [
        '/',
        '/login',
        '/account/register',
        '/account/forgot',
        '/account/resend',
        '/account/verify',
        '/account/reset',
        '/account/link',
        '/account/deletion',
        '/settings',
        '/help',
      ]) {
        const issue = await scanRoute(context, name, route);
        if (issue) failures.push(issue);
      }
      const userId = await seed(context),
        id = await ended(userId);
      for (const route of [
        '/',
        '/profile',
        '/lineup',
        '/room',
        '/results',
        `/result/${id}?mode=friend`,
        '/growth',
        '/club',
        '/room/bad',
        '/result/bad',
      ]) {
        const issue = await scanRoute(context, name, route);
        if (issue) failures.push(issue);
      }
      expect(failures).toEqual([]);
    } finally {
      await context.close();
    }
  }, 180000);
for (const name of names)
  test(`UI-07 ${name} viewport matrix preserves touch targets and large-text reflow`, async () => {
    const failures: unknown[] = [];
    for (const [width, height, dpr] of dimensions) {
      const context = await browsers.get(name)!.newContext({
        viewport: { width, height },
        deviceScaleFactor: dpr,
        hasTouch: name !== 'firefox' && width <= 768,
      });
      try {
        const userId = await seed(context),
          id = await ended(userId),
          page = await context.newPage();
        for (const scale of ['1', '2']) {
          await ready(page, '/settings');
          await page.getByLabel('文字大小', { exact: true }).selectOption(scale);
          for (const route of ['/', '/profile', '/lineup', '/room', '/results', `/result/${id}?mode=friend`, '/help']) {
            await ready(page, route);
            const issues = await layout(page);
            const headingFontPx = await page
              .getByRole('heading', { level: 1 })
              .first()
              .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
            if (route === '/profile') expect(headingFontPx).toBe(28 * Number(scale));
            const sample = {
              engine: name,
              width,
              height,
              dpr,
              textScale: Number(scale),
              headingFontPx,
              page: route.startsWith('/result/') ? '/result/:id' : route,
              issues,
            };
            report.layouts.push(sample);
            if (issues.length) failures.push(sample);
          }
        }
      } finally {
        await context.close();
      }
    }
    expect(failures).toEqual([]);
  }, 240000);

for (const name of names)
  test(`UI-07 ${name} keyboard practice, dialogs and reduced motion use real shots`, async () => {
    const context = await browsers
      .get(name)!
      .newContext({ viewport: { width: 320, height: 568 }, reducedMotion: 'reduce' });
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    try {
      await ready(page, '/settings');
      await page.getByLabel('文字大小', { exact: true }).selectOption('2');
      await page.getByLabel('始终减少动画', { exact: true }).check();
      await page.reload();
      await visible(page.getByLabel('文字大小', { exact: true })).toHaveValue('2');
      await visible(page.getByLabel('始终减少动画', { exact: true })).toBeChecked();
      await keyActivate(page, page.getByRole('link', { name: '返回大厅', exact: true }));
      await keyActivate(page, page.getByRole('button', { name: '开始练习', exact: true }));
      await visible(page.locator('.stage canvas')).toBeVisible();
      await visible(page.getByRole('heading', { name: '本地练习赛' })).toBeFocused();
      await keyActivate(page, page.getByRole('button', { name: '菜单', exact: true }));
      const menu = page.getByRole('dialog', { name: '比赛菜单', exact: true });
      await visible(menu.getByRole('button', { name: '继续比赛', exact: true })).toBeFocused();
      expect(await layout(page)).toEqual([]);
      await page.keyboard.press('Tab');
      await visible(menu.getByLabel('场地外观', { exact: true })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await visible(menu.getByRole('button', { name: '继续比赛', exact: true })).toBeFocused();
      const menuScan = await inspectPage(page, name);
      report.scans.push({
        engine: name,
        page: 'practice/menu',
        method: menuScan.method,
        violations: menuScan.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
        incomplete: menuScan.incomplete.map((v) => v.id),
      });
      expect(menuScan.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))).toEqual([]);
      await page.screenshot({ path: path.join(directory, `${name}-practice-menu.png`) });
      await visible(menu.getByRole('button', { name: '键盘与辅助出手', exact: true })).toBeEnabled({ timeout: 20000 });
      await keyActivate(page, menu.getByRole('button', { name: '键盘与辅助出手', exact: true }));
      const assist = page.getByRole('dialog', { name: '键盘与辅助出手', exact: true });
      await visible(assist.locator('.assist-piece')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await visible(assist.getByRole('button', { name: '取消辅助出手', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await visible(assist.locator('.assist-piece')).toBeFocused();
      await assist.getByLabel('方向角度（度）', { exact: true }).fill('0');
      await assist.getByLabel('力度（%）', { exact: true }).fill('60');
      await assist.getByLabel('弧线（-1 到 1）', { exact: true }).fill('0.5');
      await page.screenshot({ path: path.join(directory, `${name}-assisted-shot.png`) });
      const scan = await inspectPage(page, name);
      report.scans.push({
        engine: name,
        page: 'practice/assist',
        method: scan.method,
        violations: scan.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
        incomplete: scan.incomplete.map((v) => v.id),
      });
      expect(scan.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))).toEqual([]);
      expect(await layout(page)).toEqual([]);
      await page.screenshot({ path: path.join(directory, `${name}-assisted-shot.png`) });
      const before = await page.locator('.turn-count').textContent();
      await keyActivate(page, assist.getByRole('button', { name: '确认出手', exact: true }));
      await visible(assist).toBeHidden();
      await visible.poll(() => page.locator('.turn-count').textContent()).not.toBe(before);
      await visible(page.getByRole('button', { name: '菜单', exact: true })).toBeFocused();
      await keyActivate(page, page.getByRole('button', { name: '菜单', exact: true }));
      await page.keyboard.press('Escape');
      await visible(menu).toBeHidden();
      await visible(page.getByRole('button', { name: '菜单', exact: true })).toBeFocused();
      await keyActivate(page, page.getByRole('button', { name: '菜单', exact: true }));
      page.once('dialog', (dialog) => void dialog.accept());
      await keyActivate(page, menu.getByRole('button', { name: '问题与反馈', exact: true }));
      await visible(page.getByRole('heading', { name: '问题与反馈', exact: true })).toBeFocused();
      expect(errors).toEqual([]);
      report.scenarios.push(
        `${name}: saved settings; OS/forced reduced motion; keyboard real practice shot; menu/assist focus trap/Escape/restore; game help exit`,
      );
    } finally {
      await context.close();
    }
  }, 90000);

test('UI-07 keyboard registration and verification through real SMTP, lineup save and recorded result', async () => {
  const context = await browsers.get('chromium')!.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage(),
    email = `ui07-${randomUUID()}@example.test`,
    password = 'UI07-keyboard-test-only!';
  try {
    await ready(page, '/account/register');
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('新密码', { exact: true }).fill(password);
    await page.getByLabel('昵称', { exact: true }).fill('键盘验收');
    await keyActivate(page, page.getByRole('button', { name: '注册并发送验证邮件', exact: true }));
    await visible(page.getByText('申请已收到。', { exact: false })).toBeFocused();
    const token = await inbox.token(email, 'verify');
    await ready(page, `/account/verify#${token}`);
    expect(new URL(page.url()).hash).toBe('');
    await keyActivate(page, page.getByRole('button', { name: '验证邮箱', exact: true }));
    await visible(page.getByText('邮箱已验证，可以登录。', { exact: false })).toBeVisible();
    await ready(page, '/login');
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByLabel('密码', { exact: true }).press('Enter');
    await visible(page.getByRole('heading', { name: '我的账号', exact: true })).toBeFocused();
    await keyActivate(page, page.getByRole('button', { name: '阵容', exact: true }));
    await visible(page.getByRole('heading', { name: '我的阵容与持有卡', exact: true })).toBeFocused();
    await visible(page.getByRole('button', { name: '保存阵容', exact: true })).toBeEnabled();
    await keyActivate(page, page.getByRole('button', { name: '保存阵容', exact: true }));
    await visible(page.getByRole('status').filter({ hasText: '已保存' }).first()).toBeVisible();
    const userId = (
      await db.query("SELECT user_id FROM auth_identities WHERE provider='email' AND provider_subject=$1", [email])
    ).rows[0]?.user_id;
    expect(typeof userId).toBe('string');
    const id = await ended(userId);
    await ready(page, '/results');
    await keyActivate(page, page.getByRole('link', { name: '查看本场结果', exact: true }));
    await visible(page.getByRole('heading', { level: 1 })).toBeFocused();
    await visible(page.getByRole('heading', { name: '结算已完成', exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/result/${id}`);
    await page.screenshot({ path: path.join(directory, 'keyboard-result-desktop.png') });
    report.scenarios.push(
      'chromium: keyboard real email registration/SMTP verification/login; lineup save; owner history/result',
    );
  } finally {
    await context.close();
  }
}, 90000);

test('UI-07 blocked storage and clipboard keep settings and an offline manual feedback draft', async () => {
  const context = await browsers.get('chromium')!.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true });
  await context.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Fixture storage blocked', 'SecurityError');
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new DOMException('Fixture clipboard blocked', 'NotAllowedError');
        },
      },
    });
  });
  const page = await context.newPage();
  try {
    await ready(page, '/settings');
    await page.getByLabel('文字大小', { exact: true }).selectOption('2');
    await page.getByLabel('始终减少动画', { exact: true }).check();
    await visible(page.getByRole('status').filter({ hasText: '浏览器未允许保存' })).toBeVisible();
    await page.getByRole('link', { name: '返回大厅', exact: true }).tap();
    await page.getByRole('button', { name: '我的', exact: true }).tap();
    // Client navigation preserves the in-memory preference even when persistence is refused.
    await page.getByRole('link', { name: '问题与反馈', exact: true }).first().tap();
    await visible(page.getByRole('heading', { name: '问题与反馈', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--web-font-scale'))).toBe('2');
    await page.getByLabel('复现步骤与期望', { exact: true }).fill('断网后仍能整理问题说明。');
    await context.setOffline(true);
    let writes = 0;
    page.on('request', (request) => {
      if (!['GET', 'HEAD'].includes(request.method())) writes++;
    });
    await page.getByRole('button', { name: '复制问题说明', exact: true }).tap();
    await visible(page.getByLabel('可手动复制的说明', { exact: true })).toBeFocused();
    const value = await page.getByLabel('可手动复制的说明', { exact: true }).inputValue();
    expect(value).toContain('断网后仍能整理问题说明。');
    expect(value).toContain('尚未发送');
    expect(value).not.toMatch(/pz_access|pz_refresh|example\.test|127\.0\.0\.1/);
    expect(writes).toBe(0);
    expect(await layout(page)).toEqual([]);
    await page.screenshot({ path: path.join(directory, 'feedback-offline-320-large.png') });
    report.scenarios.push(
      'chromium touch 320/200%: storage refused/in-memory preference; offline clipboard refused/manual draft, no write requests',
    );
  } finally {
    await context.close();
  }
}, 60000);

test('UI-07 account match keyboard/touch flow locks the connection bar and opens the original settlement', async () => {
  const browser = browsers.get('chromium')!;
  const a = await browser.newContext({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 3 });
  const b = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true });
  const first = await a.newPage(),
    second = await b.newPage(),
    errors: string[] = [];
  for (const page of [first, second]) {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
  }
  try {
    await seed(a);
    await seed(b);
    await ready(first, '/settings');
    await first.getByLabel('文字大小', { exact: true }).selectOption('2');
    await first.getByLabel('始终减少动画', { exact: true }).check();
    await ready(first, '/room');
    await keyActivate(first, first.getByRole('button', { name: '创建房间', exact: true }));
    const invite = first.getByRole('textbox', { name: '邀请链接', exact: true });
    await visible(invite).toBeVisible();
    const code = (await invite.inputValue()).split('/').at(-1)!;
    await ready(second, `/room/${code}`);
    await second.getByRole('button', { name: '加入房间', exact: true }).tap();
    await visible(second.getByRole('textbox', { name: '邀请链接', exact: true })).toBeVisible();
    await keyActivate(first, first.getByRole('button', { name: '准备比赛', exact: true }));
    await second.getByRole('button', { name: '准备比赛', exact: true }).tap();
    for (const page of [first, second]) await visible(page.locator('.stage canvas')).toBeVisible();
    expect(await first.evaluate(() => '__pz' in window)).toBe(false);
    await keyActivate(first, first.getByRole('button', { name: '菜单', exact: true }));
    await visible(first.locator('aside')).toHaveAttribute('inert', '');
    const menu = first.getByRole('dialog', { name: '比赛菜单', exact: true });
    await visible(menu.getByRole('button', { name: '键盘与辅助出手', exact: true })).toBeEnabled({ timeout: 30000 });
    await first.screenshot({ path: path.join(directory, 'account-menu-320-large.png') });
    await keyActivate(first, menu.getByRole('button', { name: '键盘与辅助出手', exact: true }));
    const assist = first.getByRole('dialog', { name: '键盘与辅助出手', exact: true });
    await assist.getByLabel('方向角度（度）', { exact: true }).fill('0');
    await assist.getByLabel('力度（%）', { exact: true }).fill('60');
    const before = await first.locator('.turn-count').textContent();
    await keyActivate(first, assist.getByRole('button', { name: '确认出手', exact: true }));
    await visible.poll(() => first.locator('.turn-count').textContent()).not.toBe(before);
    await visible(first.locator('aside')).not.toHaveAttribute('inert', '');
    await second.getByRole('button', { name: '菜单', exact: true }).tap();
    second.once('dialog', (dialog) => void dialog.accept());
    await second
      .getByRole('dialog', { name: '比赛菜单', exact: true })
      .getByRole('button', { name: '认输', exact: true })
      .tap();
    const result = first.getByRole('dialog', { name: '本场比赛结果', exact: true });
    await visible(result).toBeVisible();
    await visible(first.locator('aside')).toHaveAttribute('inert', '');
    await first.keyboard.press('Escape');
    await visible(first.getByRole('button', { name: '菜单', exact: true })).toBeFocused();
    await keyActivate(first, first.getByRole('button', { name: '菜单', exact: true }));
    await keyActivate(first, menu.getByRole('button', { name: '查看本场结果', exact: true }));
    await keyActivate(first, result.getByRole('button', { name: '查看本场结算', exact: true }));
    await visible(first.getByRole('heading', { name: '结算已完成', exact: true })).toBeVisible();
    expect(new URL(first.url()).pathname).toMatch(/^\/result\/[0-9a-f-]{36}$/);
    expect(errors).toEqual([]);
    report.scenarios.push(
      'chromium two real accounts: keyboard create/ready/shot at 320/200%; touch join/ready/surrender; outside connection toolbar inert/restore; Escape/reopen original settled result; no production debug handle',
    );
  } finally {
    await a.close();
    await b.close();
  }
}, 120000);

test('UI-07 initial and lazy chunk failures expose usable recovery actions', async () => {
  const context = await browsers.get('chromium')!.newContext(),
    page = await context.newPage();
  try {
    const initial = /\/assets\/webApp-[\w-]+\.js$/;
    await page.route(initial, (route) => route.abort('failed'));
    await page.goto(origin);
    await visible(page.getByRole('heading', { name: '页面资源暂未能加载', exact: true })).toBeFocused();
    await visible(page.getByRole('button', { name: '重新加载页面', exact: true })).toBeEnabled();
    await page.unroute(initial);
    await keyActivate(page, page.getByRole('button', { name: '重新加载页面', exact: true }));
    await visible(page.getByRole('heading', { name: '碰撞全明星', exact: true })).toBeVisible();
    await seed(context);
    await ready(page, '/');
    const lazy = /\/assets\/route-[\w-]+\.js$/;
    await page.route(lazy, (route) => route.abort('failed'));
    await keyActivate(page, page.getByRole('button', { name: '阵容', exact: true }));
    await visible(page.getByRole('heading', { name: '页面暂时未能显示', exact: true })).toBeFocused();
    await keyActivate(page, page.getByRole('link', { name: '返回大厅', exact: true }));
    await visible(page.getByRole('heading', { name: '碰撞全明星', exact: true })).toBeVisible();
    await page.unroute(lazy);
    await page.reload();
    await visible(
      page.getByRole('region', { name: '账号与资产', exact: true }).getByText('持有卡：5 张', { exact: true }),
    ).toBeVisible();
    await keyActivate(page, page.getByRole('button', { name: '阵容', exact: true }));
    await visible(page.getByRole('heading', { name: '我的阵容与持有卡', exact: true })).toBeVisible();
    report.scenarios.push(
      'chromium: failed webApp chunk → native recovery/reload; failed lazy inventory chunk → boundary/home/reload/re-entry',
    );
  } finally {
    await context.close();
  }
}, 60000);

test('UI-07 render fault is contained and diagnostics omit exception contents', async () => {
  const context = await browsers.get('chromium')!.newContext(),
    page = await context.newPage(),
    errors: string[] = [],
    messages: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => messages.push(message.text()));
  try {
    const id = await ended(await seed(context));
    await ready(page, '/results');
    await visible(page.getByRole('link', { name: '查看本场结果', exact: true })).toBeVisible();
    await page.evaluate(() => {
      Date.prototype.toLocaleString = () => {
        throw new Error('fixture-private-diagnostic');
      };
    });
    await keyActivate(page, page.getByRole('link', { name: '查看本场结果', exact: true }));
    await visible(page.getByRole('heading', { name: '页面暂时未能显示', exact: true })).toBeFocused();
    expect(await page.locator('body').innerText()).not.toContain('fixture-private-diagnostic');
    expect(messages.join('\n')).not.toContain('fixture-private-diagnostic');
    expect(messages).toContain('页面显示中断，已提供恢复入口。');
    expect(errors).toEqual([]);
    await keyActivate(page, page.getByRole('link', { name: '问题与反馈', exact: true }));
    await visible(page.getByRole('heading', { name: '问题与反馈', exact: true })).toBeVisible();
    await page.goto(`${origin}/result/${id}?mode=friend`);
    await visible(page.getByRole('heading', { name: '结算已完成', exact: true })).toBeVisible();
    report.scenarios.push(
      'chromium: real result render throws → focused recovery/help; redacted console; full reload restores original result',
    );
  } finally {
    await context.close();
  }
}, 60000);

test('UI-07 delayed reads, rapid navigation, empty/error states and offline recovery stay usable', async () => {
  const context = await browsers.get('chromium')!.newContext(),
    page = await context.newPage();
  try {
    await seed(context);
    await ready(page, '/results');
    await visible(page.getByText('暂无已记录的比赛结果。', { exact: true })).toBeVisible();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inventory = '**/api/v1/me/cards?*';
    await page.route(inventory, async (route) => {
      const response = await route.fetch();
      await held;
      await route.fulfill({ response });
    });
    await keyActivate(page, page.getByRole('button', { name: '阵容', exact: true }));
    await visible(page.getByText('正在读取持有卡与阵容…', { exact: true })).toBeVisible();
    for (const name of ['我的', '比赛', '阵容', '比赛'])
      await keyActivate(page, page.getByRole('button', { name, exact: true }));
    await visible(page.getByRole('heading', { name: '碰撞全明星', exact: true })).toBeFocused();
    release();
    await page.unroute(inventory);
    await visible(page.getByRole('heading', { name: '我的阵容与持有卡', exact: true })).toHaveCount(0);
    const history = '**/api/v1/me/matches*';
    await page.route(history, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: { code: 'UNAVAILABLE' } }),
      }),
    );
    await ready(page, '/results');
    await visible(page.getByRole('alert')).toBeVisible();
    await page.unroute(history);
    await keyActivate(page, page.getByRole('button', { name: '重新查询比赛记录', exact: true }));
    await visible(page.getByText('暂无已记录的比赛结果。', { exact: true })).toBeVisible();
    await context.setOffline(true);
    await visible(
      page.getByText('当前离线，仅显示本会话已读取的记录；联网后可继续查询。', { exact: true }),
    ).toBeVisible();
    await context.setOffline(false);
    await visible(page.getByRole('button', { name: '重新查询比赛记录', exact: true })).toBeEnabled();
    report.scenarios.push(
      'chromium: real delayed inventory read + four rapid route changes; empty history; injected HTTP503/retry; offline/online',
    );
  } finally {
    await context.close();
  }
}, 60000);
