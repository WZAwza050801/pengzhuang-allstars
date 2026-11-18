import { randomUUID } from 'node:crypto';
import { matchMaker } from 'colyseus';
import { ACCOUNT_ROOM_NAME } from '../../shared/protocol';
import { AccountRoomJoinSchema } from '../../packages/contracts/src/match-tickets';
import { MatchRoom, allocateRoomCode } from '../rooms/MatchRoom';
import { netError } from '../auth';
import { ApiError } from '../api/http';
import type { MatchTickets, AccountRooms, AccountRoomTarget, AccountMode } from './tickets';
import type { GameData } from '../../shared/data';
import type { ServerClock } from '../clock';

/** A bounded, in-process room directory. Cross-process discovery/recovery is deliberately deferred to NET-03/05. */
export function createAccountRooms(tickets: MatchTickets, clock: ServerClock, maxRooms = 128) {
  type Setup = { code: string; data: GameData; mode: AccountMode };
  const grants = new Map<string, Setup>();
  const rooms = new Map<string, AccountMatchRoom>();
  const reserved = new Set<string>();
  class AccountMatchRoom extends MatchRoom {
    private lifetime: NodeJS.Timeout | undefined;
    protected override resolveClock() {
      return clock;
    }
    protected override resolveStore() {
      return null;
    }
    protected override accountCreation(raw: unknown) {
      const key = raw && typeof raw === 'object' && 'creationKey' in raw ? raw.creationKey : undefined;
      const setup = typeof key === 'string' ? grants.get(key) : undefined;
      if (!setup) throw netError('forbidden');
      grants.delete(key as string);
      return {
        ...setup,
        admit: async (options: unknown) => {
          const input = AccountRoomJoinSchema.safeParse(options);
          if (!input.success) throw netError('unauthenticated');
          const target = this.accountTarget();
          if (!target) throw netError('forbidden');
          try {
            return await tickets.consume(input.data.ticket, target);
          } catch (error) {
            throw netError(
              error instanceof ApiError && error.code === 'FORBIDDEN'
                ? 'forbidden'
                : error instanceof ApiError && error.code === 'UNAVAILABLE'
                  ? 'unavailable'
                  : 'unauthenticated',
            );
          }
        },
      };
    }
    override async onCreate(raw: unknown) {
      await super.onCreate(raw);
      // Two player seats plus one transient authentication slot to replace an existing live connection.
      // The shared room still admits only two distinct accounts; third identities fail ticket consumption.
      this.maxClients = 3;
      this.autoDispose = false;
      rooms.set(this.roomId, this);
      // Unused reservations cannot retain empty rooms forever. Lobby sessions also have a finite lifetime.
      this.lifetime = setTimeout(() => {
        if (this.inspect().phase === 'lobby')
          void this.disconnect().catch(() => console.error('[AccountRoom] expiry cleanup failed'));
      }, 10 * 60_000);
      this.lifetime.unref();
    }
    override onDispose() {
      clearTimeout(this.lifetime);
      rooms.delete(this.roomId);
      reserved.delete(this.roomId);
      super.onDispose();
    }
  }
  const directory: AccountRooms = {
    reserve(data, mode) {
      if (reserved.size >= maxRooms) throw new ApiError('RATE_LIMITED', 429, true);
      const code = allocateRoomCode(reserved);
      const key = randomUUID();
      const setup = { code, data, mode };
      grants.set(key, setup);
      const pending: AccountRoomTarget = { ...setup, selection: () => undefined, canEnter: () => true };
      return {
        target: pending,
        async create() {
          try {
            await matchMaker.createRoom(ACCOUNT_ROOM_NAME, { creationKey: key });
          } finally {
            grants.delete(key);
          }
        },
        async release() {
          grants.delete(key);
          reserved.delete(code);
          await rooms.get(code)?.disconnect();
        },
      };
    },
    find(code) {
      return rooms.get(code)?.accountTarget();
    },
  };
  return { directory, roomClass: AccountMatchRoom };
}
