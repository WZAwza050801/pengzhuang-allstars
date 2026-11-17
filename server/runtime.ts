import type { RuntimeConfig } from '../config/runtime';
import { createBundledGameConfiguration } from '../config/game';
import { Database } from '../packages/persistence/src/database';
import { createGameServer } from './app';
import { createRoomStore } from './roomStore';

/** One Colyseus runtime per process (the framework uses a process-global matchMaker). */
export async function startRuntime(config: RuntimeConfig, port = config.port) {
  const gameConfiguration = createBundledGameConfiguration();
  const database = config.databaseUrl ? new Database({ connectionString: config.databaseUrl }) : null;
  const server = createGameServer({
    repository: database, resolveData: gameConfiguration.resolveData,
    roomStore: createRoomStore(config.roomStoreDir), closeResources: database ? [() => database.close()] : [],
    onError: (event) => console.error(JSON.stringify({ event: 'http_error', ...event })),
  });
  try {
    if (database) await database.query('SELECT 1');
    await server.gameServer.listen(port);
    const recovery = await server.services.matches.restoreRooms();
    return { ...server, recovery };
  } catch {
    await server.close().catch(() => undefined);
    throw new Error('Server startup failed');
  }
}
