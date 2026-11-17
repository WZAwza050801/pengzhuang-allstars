import type { RuntimeConfig } from '../config/runtime';
import { createBundledGameConfiguration } from '../config/game';
import { Database } from '../packages/persistence/src/database';
import { createGameServer } from './app';
import { createRoomStore } from './roomStore';
import { EmailAccounts } from './accounts/email-accounts';
import { createAccountMail } from './accounts/mail';
import { emailAuthModule } from './api/email-auth';
import { Sessions } from './accounts/sessions';
import { WebSessions } from './api/web-sessions';
import { currentUserModule } from './api/current-user';
import { WechatProvider } from './accounts/wechat-provider';
import { WechatAccounts } from './accounts/wechat-accounts';
import { wechatAuthModule } from './api/wechat-auth';
import { AccountLifecycle } from './accounts/lifecycle';
import { Passwords } from './accounts/passwords';
import { lifecycleModules } from './api/lifecycle';
import { authOptionsModule } from './api/auth-options';

/** One Colyseus runtime per process (the framework uses a process-global matchMaker). */
export async function startRuntime(config: RuntimeConfig, port = config.port) {
  const gameConfiguration = createBundledGameConfiguration();
  const database = config.databaseUrl ? new Database({ connectionString: config.databaseUrl }) : null;
  const passwords = new Passwords();
  const emailAccounts = database && config.emailProvider !== 'disabled'
    ? new EmailAccounts(database, createAccountMail(config), config.sessionSigningKey!, passwords) : null;
  const web = database && config.sessionSigningKey
    ? new WebSessions(new Sessions(database, config.sessionSigningKey, new URL(config.publicOrigin).origin), config, config.sessionSigningKey) : null;
  const wechat = database && config.wechatEnabled
    ? new WechatAccounts(database, new WechatProvider({ appId: config.wechatAppId!, secret: config.wechatSecret! }), config.sessionSigningKey!) : null;
  const lifecycle = database && web ? new AccountLifecycle(database, passwords, { enabled: config.accountDeletionEnabled, graceHours: config.accountDeletionGraceHours, version: config.accountRetentionPolicy }, emailAccounts, wechat) : null;
  const server = createGameServer({
    modules: [authOptionsModule(!!emailAccounts, !!wechat, web), ...(web ? [web.module(), currentUserModule(web), ...(lifecycle ? lifecycleModules(lifecycle, web) : []), ...(emailAccounts ? [emailAuthModule(emailAccounts, web)] : []), ...(wechat ? [wechatAuthModule(wechat, web)] : [])] : [])],
    repository: database, resolveData: gameConfiguration.resolveData,
    roomStore: createRoomStore(config.roomStoreDir), closeResources: database ? [() => database.close(), ...(emailAccounts ? [() => emailAccounts.close()] : []), ...(lifecycle ? [() => lifecycle.close()] : [])] : [],
    onError: (event) => console.error(JSON.stringify({ event: 'http_error', ...event })),
  });
  try {
    if (database) await database.query('SELECT 1');
    await server.gameServer.listen(port);
    const recovery = await server.services.matches.restoreRooms();
    emailAccounts?.startMailDelivery();
    lifecycle?.start();
    return { ...server, recovery };
  } catch {
    await server.close().catch(() => undefined);
    throw new Error('Server startup failed');
  }
}
