import { readRuntimeConfig } from '../config/runtime';
import { DEFAULT_DATA } from '../shared/data';
import { createGameServer } from './app';
import { MatchRoom } from './rooms/MatchRoom';
import { createRoomStore } from './roomStore';

/**
 * Re-creates the rooms that were still running when the server went down.
 *
 * The clocks are frozen while the server is down, so a room that was interrupted mid-match comes back with the
 * time it had left. A record that no longer fits the running game data is rejected by the store, not by us.
 */
async function restoreRooms(storeDir: string): Promise<void> {
  const store = createRoomStore(storeDir);
  MatchRoom.useStore(store);
  const records = store.loadAll(DEFAULT_DATA.version);
  if (records.length === 0) {
    console.log(`[server] no stored rooms to restore in ${store.dir}`);
    return;
  }
  let restored = 0;
  for (const rec of records) {
    try {
      await MatchRoom.restore(rec);
      restored += 1;
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      console.error(`[server] could not restore room ${rec.code}: ${why}`);
      // The room cannot come back, so its file must not stay around to be retried on every restart.
      store.remove(rec.code);
    }
  }
  console.log(`[server] restored ${restored}/${records.length} room(s) from ${store.dir}`);
}

async function main(): Promise<void> {
  const config = readRuntimeConfig();
  const port = config.port;
  const { gameServer } = createGameServer();
  await gameServer.listen(port);
  console.log(`[server] listening on port ${port}  (GET /healthz)`);

  // The restore runs after the listener is up so a restored room is reachable the moment the port is open.
  await restoreRooms(config.roomStoreDir);

  const shutdown = (signal: string): void => {
    console.log(`[server] ${signal} received, shutting down`);
    gameServer.gracefullyShutdown(false).finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
