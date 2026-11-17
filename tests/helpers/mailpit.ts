import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { jsonRequest } from './json-http';

export async function freePort() {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}
export async function startMailpit(name: string) {
  if (!process.env.PG_TEST_TMP_DIR) throw new Error('Isolated fixture directory required');
  const smtpPort = await freePort();
  const inbox = `http://127.0.0.1:${await freePort()}`;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('MP_')) delete env[key];
  const child = spawn(
    process.env.MAILPIT_TEST_BIN ?? 'mailpit',
    [
      '--smtp',
      `127.0.0.1:${smtpPort}`,
      '--listen',
      new URL(inbox).host,
      '--database',
      path.join(process.env.PG_TEST_TMP_DIR, `${name}.db`),
      '--disable-version-check',
      '--quiet',
    ],
    { env, stdio: 'ignore', windowsHide: true },
  );
  let failed = false;
  child.on('error', () => {
    failed = true;
  });
  async function close() {
    if (child.exitCode === null && child.pid) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
  }
  try {
    let ready = false;
    for (let index = 0; index < 100; index++) {
      if (failed || child.exitCode !== null) throw new Error('Real Mailpit binary required; delivery cannot be mocked');
      try {
        ready = (await jsonRequest(inbox, '/api/v1/messages')).status === 200;
      } catch {
        /* Startup wait. */
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error('Mailpit startup timeout');
  } catch (error) {
    await close();
    throw error;
  }
  return {
    smtpPort,
    inbox,
    close,
    async token(email: string, purpose: 'verify' | 'reset' | 'link', exclude?: string) {
      for (let index = 0; index < 100; index++) {
        const list = (await jsonRequest(inbox, '/api/v1/messages')).data;
        for (const item of list.messages ?? []) {
          if (!item.To?.some((to: { Address: string }) => to.Address === email)) continue;
          const message = (await jsonRequest(inbox, `/api/v1/message/${item.ID}`)).data;
          const token = String(message.Text).match(new RegExp(`/account/${purpose}#([A-Za-z0-9_-]{43})`))?.[1];
          if (token && token !== exclude) return token;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Expected real SMTP message was not received');
    },
  };
}
