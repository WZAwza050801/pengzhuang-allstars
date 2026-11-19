import { authenticateJoin } from './auth';
import { MatchRoom } from './rooms/MatchRoom';
import type { GameData } from '../shared/data';
import type { SqlExecutor } from '../packages/persistence/src/database';
import type { RoomStore } from './roomStore';
import type { SettlementReceipt } from './matches/outcomes';

import type { ServerClock } from './clock';
export { systemClock } from './clock';
/** Trusted server-side command port. No HTTP route exposes this port. */
export interface OutcomeSink<T = unknown> { record(outcome: T): Promise<SettlementReceipt> }
export interface ServiceDependencies {
  repository: SqlExecutor | null;
  clock: ServerClock;
  resolveData(version?: string, serverCohort?: string): GameData;
  roomStore: RoomStore | null;
  outcomeSink: OutcomeSink | null;
}

/** Existing guest authentication is kept separate from future persistent ACC account services. */
export function createAccountService() { return { authenticateGuest: authenticateJoin }; }
export function createAssetService(deps: Pick<ServiceDependencies, 'resolveData'>) {
  return {
    catalog() {
      const data = deps.resolveData();
      return { dataVersion: data.version, geometry: data.geometry, players: data.players };
    },
  };
}
export function createMatchService(deps: ServiceDependencies) {
  return {
    resolveData: deps.resolveData,
    async restoreRooms(): Promise<{ total: number; restored: number; failed: number }> {
      const records = deps.roomStore?.loadAll(deps.resolveData().version) ?? [];
      let restored = 0;
      for (const rec of records) {
        try { await MatchRoom.restore(rec); restored++; }
        catch {
          // Keep the failed record for explicit investigation; do not silently delete recovery evidence.
        }
      }
      return { total: records.length, restored, failed: records.length - restored };
    },
  };
}
export function createServices(deps: ServiceDependencies) {
  return { accounts: createAccountService(), assets: createAssetService(deps), matches: createMatchService(deps) };
}
export type Services = ReturnType<typeof createServices>;
