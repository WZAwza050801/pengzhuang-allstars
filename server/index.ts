import path from 'node:path';
import { DEFAULT_DATA } from '../shared/data';
import { createGameServer } from './app';
import { MatchRoom } from './rooms/MatchRoom';
import { createRoomStore } from './roomStore';

const DEFAULT_PORT = 2567;

function readPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid PORT: ${raw}`);
  return port;
}

/** Where the running rooms are written. `ROOM_STORE_DIR` moves it (tests use a temp dir). */
function readStoreDir(): string {
  const raw = process.env.ROOM_STORE_DIR;
  if (raw !== undefined && raw !== '') return path.resolve(raw);
  return path.resolve(process.cwd(), 'data', 'rooms');
}

/**
 * Re-creates the rooms that were still running when the server went down.
 *
 * The clocks are frozen while the server is down, so a room that was interrupted mid-match comes back with the
 * time it had left. A record that no longer fits the running game data is rejected by the store, not by us.
 */
async function restoreRooms(): Promise<void> {
  const store = createRoomStore(readStoreDir());
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
  const port = readPort();
  const { gameServer } = createGameServer();
  await gameServer.listen(port);
  console.log(`[server] listening on port ${port}  (GET /healthz)`);

  // The restore runs after the listener is up so a restored room is reachable the moment the port is open.
  await restoreRooms();

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
