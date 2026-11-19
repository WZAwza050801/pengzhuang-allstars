import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const directory = fileURLToPath(new URL('../docs/productization/reports/workflow/', import.meta.url));
mkdirSync(directory, { recursive: true });
const server = await createServer({
  configFile: fileURLToPath(new URL('../client/vite.config.ts', import.meta.url)),
  server: { host: '127.0.0.1', port: 0, open: false },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch(),
  report = { views: [], errors: [], businessWrites: [] };
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({
        viewport: { width, height: width === 1280 ? 900 : 844 },
        deviceScaleFactor: width === 1280 ? 1 : 2,
      }),
      page = await context.newPage();
    page.on('pageerror', (e) => report.errors.push(e.message));
    page.on('console', (m) => {
      if (['error', 'warning'].includes(m.type())) report.errors.push(m.text());
    });
    page.on('request', (r) => {
      if (r.url().includes('/api/') && r.method() !== 'GET') report.businessWrites.push(r.url());
    });
    await page.goto(new URL('workflow-debug.html', server.resolvedUrls.local[0]).href);
    await page.waitForFunction(() => window.__workflowAudit?.page === 'lobby');
    const at = (target) => page.waitForFunction((value) => window.__workflowAudit.page === value, target);
    await page.getByRole('button', { name: '阵容', exact: true }).click();
    await at('login');
    assert.equal(await page.evaluate(() => window.__workflowAudit.resume), 'lineup');
    await page.getByRole('button', { name: '取消登录', exact: true }).click();
    await at('lobby');
    await page.getByRole('button', { name: '阵容', exact: true }).click();
    await page.getByRole('button', { name: '模拟登录失败', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__workflowAudit.resume), 'lineup');
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '模拟登录成功', exact: true }).click();
    await at('lineup');
    await page.getByRole('button', { name: '模拟读取失败', exact: true }).click();
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await at('lobby');
    await page.getByRole('button', { name: '开始均衡排位', exact: true }).click();
    await at('queue');
    await page.getByRole('button', { name: '取消排队', exact: true }).click();
    await at('lobby');
    await page.getByRole('button', { name: '开始均衡排位', exact: true }).click();
    await page.getByRole('button', { name: '模拟匹配成功', exact: true }).click();
    await at('match');
    await page.getByRole('button', { name: '模拟对局结束', exact: true }).click();
    await at('result');
    await page.getByRole('button', { name: '模拟查询失败', exact: true }).click();
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '模拟已入账', exact: true }).click();
    await page.getByText('已入账（演示状态，无虚构金额）', { exact: true }).waitFor();
    await page.getByRole('button', { name: '回到比赛入口', exact: true }).click();
    await page.getByRole('button', { name: '我的', exact: true }).click();
    await page.getByRole('button', { name: '模拟退出登录', exact: true }).click();
    await at('lobby');
    await page.getByRole('button', { name: '好友约战', exact: true }).click();
    await at('room');
    assert.equal(await page.evaluate(() => window.__workflowAudit.session), 'anonymous');
    await page.getByRole('button', { name: '模拟双方准备', exact: true }).click();
    await at('match');
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await at('match');
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('button', { name: '确认返回', exact: true }).click();
    await at('lobby');
    for (const value of ['maintenance', 'outdated']) {
      await page.selectOption('[name=service]', value);
      assert.equal(await page.getByRole('button', { name: /好友约战/ }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: '自由练习', exact: true }).isEnabled(), true);
    }
    await page.selectOption('[name=service]', 'ready');
    await page.selectOption('[name=network]', 'offline');
    assert.equal(await page.getByRole('button', { name: /开始均衡排位/ }).isDisabled(), true);
    await page.getByRole('button', { name: '自由练习', exact: true }).click();
    await page.getByRole('button', { name: '模拟对局结束', exact: true }).click();
    await page.getByText('无正式奖励，不计排位', { exact: true }).waitFor();
    await page.getByRole('button', { name: '回到比赛入口', exact: true }).click();
    await page.selectOption('[name=network]', 'online');
    await page.locator('[name=features]').uncheck();
    assert.equal(await page.getByRole('button', { name: /阵容/ }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${directory}lobby-${width}.png`, fullPage: true });
    report.views.push({
      width,
      loginResume: true,
      cancelAndRetry: true,
      queueResult: true,
      guestFriend: true,
      localOfflinePractice: true,
      maintenanceAndFlags: true,
      noOverflow: true,
    });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.businessWrites, []);
  writeFileSync(`${directory}browser.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(
    'Workflow: desktop/390/320 login resume, guest friend, queue/result, retry, offline practice, maintenance and flags passed; no business writes or console errors',
  );
} finally {
  await browser.close();
  await server.close();
}
