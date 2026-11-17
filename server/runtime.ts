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

/** One Colyseus runtime per process (the framework uses a process-global matchMaker). */
export async function startRuntime(config: RuntimeConfig, port = config.port) {
  const gameConfiguration = createBundledGameConfiguration();
  const database = config.databaseUrl ? new Database({ connectionString: config.databaseUrl }) : null;
  const emailAccounts = database && config.emailProvider !== 'disabled'
    ? new EmailAccounts(database, createAccountMail(config), config.sessionSigningKey!) : null;
  const web = database && config.sessionSigningKey
    ? new WebSessions(new Sessions(database, config.sessionSigningKey, new URL(config.publicOrigin).origin), config, config.sessionSigningKey) : null;
  const server = createGameServer({
    modules: web ? [web.module(), currentUserModule(web), ...(emailAccounts ? [emailAuthModule(emailAccounts, web)] : [])] : [],
    repository: database, resolveData: gameConfiguration.resolveData,
    roomStore: createRoomStore(config.roomStoreDir), closeResources: database ? [() => database.close(), ...(emailAccounts ? [() => emailAccounts.close()] : [])] : [],
    onError: (event) => console.error(JSON.stringify({ event: 'http_error', ...event })),
  });
  try {
    if (database) await database.query('SELECT 1');
    await server.gameServer.listen(port);
    const recovery = await server.services.matches.restoreRooms();
    emailAccounts?.startMailDelivery();
    return { ...server, recovery };
  } catch {
    await server.close().catch(() => undefined);
    throw new Error('Server startup failed');
  }
}
