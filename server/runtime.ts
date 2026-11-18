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
import { createBundledEconomyConfiguration } from '../config/economy';
import { PlayerData } from './accounts/player-data';
import { playerDataModule } from './api/player-data';
import { Lineups } from './accounts/lineups';
import { lineupModule } from './api/lineups';
import { Assets } from './accounts/assets';
import { assetModule } from './api/assets';
import { LocalImports } from './accounts/local-import';
import { localImportModule } from './api/local-import';
import { MatchTickets } from './matches/tickets';
import path from 'node:path';
import { MatchOutcomes } from './matches/outcomes';
import { OutcomeJournal } from './matches/outcome-journal';

/** One Colyseus runtime per process (the framework uses a process-global matchMaker). */
export async function startRuntime(config: RuntimeConfig, port = config.port) {
  const gameConfiguration = createBundledGameConfiguration();
  const database = config.databaseUrl ? new Database({ connectionString: config.databaseUrl }) : null;
  const passwords = new Passwords();
  const economy = database ? createBundledEconomyConfiguration() : null;
  const players = database && economy ? new PlayerData(database, economy.policy, gameConfiguration.resolveData()) : null;
  const assets = database && players && economy ? new Assets(database, players.initialize, () => ({ policy: economy.registry.get(), data: gameConfiguration.resolveData() })) : null;
  const lineups = database && players ? new Lineups(database, players.initialize, gameConfiguration.resolveData) : null;
  const localImports = database && players ? new LocalImports(database, players.initialize, gameConfiguration.resolveData) : null;
  const emailAccounts = database && config.emailProvider !== 'disabled'
    ? new EmailAccounts(database, createAccountMail(config), config.sessionSigningKey!, passwords, players?.initialize) : null;
  const web = database && config.sessionSigningKey
    ? new WebSessions(new Sessions(database, config.sessionSigningKey, new URL(config.publicOrigin).origin, players?.initialize), config, config.sessionSigningKey) : null;
  const wechat = database && config.wechatEnabled
    ? new WechatAccounts(database, new WechatProvider({ appId: config.wechatAppId!, secret: config.wechatSecret! }), config.sessionSigningKey!, players?.initialize) : null;
  const lifecycle = database && web ? new AccountLifecycle(database, passwords, { enabled: config.accountDeletionEnabled, graceHours: config.accountDeletionGraceHours, version: config.accountRetentionPolicy }, emailAccounts, wechat) : null;
  const tickets = database && web && lineups ? new MatchTickets(database, lineups, gameConfiguration.resolveData) : null;
  const outcomes = database && assets && economy ? new MatchOutcomes({ db: database, assets, policy: () => economy.registry.get(), journal: new OutcomeJournal(path.join(config.roomStoreDir, 'pending-outcomes')) }) : null;
  const server = createGameServer({
    accountRooms: tickets && web && outcomes ? { tickets, web, outcomes } : undefined,
    lobbyMaintenance: config.lobbyMaintenance,
    modules: [authOptionsModule(!!emailAccounts, !!wechat, web, !!(web && players && lineups && assets), !!tickets), ...(web ? [web.module(), currentUserModule(web), ...(players ? [playerDataModule(players, web)] : []), ...(lineups ? [lineupModule(lineups, web)] : []), ...(assets ? [assetModule(assets, web)] : []), ...(localImports ? [localImportModule(localImports, web)] : []), ...(lifecycle ? lifecycleModules(lifecycle, web) : []), ...(emailAccounts ? [emailAuthModule(emailAccounts, web)] : []), ...(wechat ? [wechatAuthModule(wechat, web)] : [])] : [])],
    repository: database, resolveData: gameConfiguration.resolveData,
    roomStore: createRoomStore(config.roomStoreDir), closeResources: database ? [() => database.close(), ...(emailAccounts ? [() => emailAccounts.close()] : []), ...(lifecycle ? [() => lifecycle.close()] : []), ...(outcomes ? [() => outcomes.close()] : [])] : [],
    onError: (event) => console.error(JSON.stringify({ event: 'http_error', ...event })),
  });
  try {
    if (database) await database.query('SELECT 1');
    await outcomes?.start();
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
