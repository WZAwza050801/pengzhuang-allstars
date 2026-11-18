import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { matchMaker } from 'colyseus';
import { ACCOUNT_ROOM_NAME } from '../../shared/protocol';
import { AccountRoomJoinSchema } from '../../packages/contracts/src/match-tickets';
import { MatchRoom, allocateRoomCode, type MatchSimulator } from '../rooms/MatchRoom';
import { netError } from '../auth';
import { ApiError } from '../api/http';
import type { MatchTickets, AccountRooms, AccountRoomTarget, AccountMode } from './tickets';
import type { GameData } from '../../shared/data';
import type { ServerClock } from '../clock';
import type { MatchOutcomes, SettlementReceipt } from './outcomes';
import type { OutcomeIntent } from '../../packages/contracts/src/match-results';
import { RecoveryJournal } from './recovery-journal';
import { LiveCheckpoints } from './live-checkpoints';
import type { MatchCheckpoints, CheckpointLease } from './checkpoint-store';
import type { AccountCheckpoint, AccountCheckpointDraft } from './checkpoint';
import { AccountRestorer, type RestoredAccountRoom } from './account-restorer';
import { buildOwnedLineupCards } from '../../packages/game-core/src/lineups';
import { freezeSnapshot } from '../../packages/game-core/src/snapshot';
import type { OwnedLineupSnapshot } from './tickets';

/** A bounded runtime directory backed by epoch-fenced account checkpoints and the original journal volume. */
export function createAccountRooms(tickets: MatchTickets, outcomes: MatchOutcomes, clock: ServerClock, options: { maxRooms?: number; simulateShot?: MatchSimulator } = {}) {
  type Setup = { code: string; data: GameData; mode: AccountMode; restore?: RestoredAccountRoom & { store: MatchCheckpoints } };
  const grants = new Map<string, Setup>();
  const rooms = new Map<string, AccountMatchRoom>();
  const reserved = new Set<string>();
  const journal = new RecoveryJournal(path.join(outcomes.journalDirectory, 'account-recovery'));
  let storePromise: Promise<MatchCheckpoints> | undefined;
  const checkpointStore = () => storePromise ??= journal.open().then(id => tickets.recovery.checkpointStore(id)).catch(error => { storePromise = undefined; throw error; });
  const pending = new Set<Promise<unknown>>();
  function track<T>(job: Promise<T>): Promise<T> {
    pending.add(job); void job.finally(() => pending.delete(job)).catch(() => undefined); return job;
  }
  class AccountMatchRoom extends MatchRoom {
    protected override simulateShot(...args: Parameters<MatchSimulator>) { return options.simulateShot ? options.simulateShot(...args) : super.simulateShot(...args); }
    private lifetime: NodeJS.Timeout | undefined;
    private checkpoints: LiveCheckpoints | undefined;
    private ending = false;
    hasAuthority() { return !this.checkpoints || this.checkpoints.active(); }
    private bindCheckpoints(store: MatchCheckpoints, lease: CheckpointLease, record: AccountCheckpoint, requestedAt: number) {
      this.checkpoints = new LiveCheckpoints(store, journal, outcomes, clock, () => { void this.disconnect().catch(() => console.error('[AccountRoom] ownership shutdown failed')); });
      this.checkpoints.bind(lease, record, requestedAt);
    }
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
      let configurationHash = setup.restore?.record.configurationHash ?? '';
      let restored: { record: AccountCheckpoint; selections: [OwnedLineupSnapshot, OwnedLineupSnapshot] } | undefined;
      if (setup.restore) {
        const { store, lease, record, requestedAt, configuration } = setup.restore;
        this.bindCheckpoints(store, lease, record, requestedAt);
        const selection = (side: 0 | 1): OwnedLineupSnapshot => {
          const seat = record.seats[side];
          return freezeSnapshot({ schemaVersion: 1, userId: seat.userId, lineupId: seat.lineupId, revision: seat.lineupRevision, rules: configuration.rules,
            cards: buildOwnedLineupCards(configuration.data, configuration.rules, seat.cards.map(card => ({ id: card.ownedCardId, playerDefId: card.playerDefId, level: card.ownedLevel, version: card.cardVersion, status: 'active' }))),
          });
        };
        restored = { record, selections: [selection(0), selection(1)] };
      }
      return {
        ...setup,
        rules: setup.restore?.configuration.rules,
        restored,
        recordStart: (input: Parameters<typeof tickets.recovery.started>[0], draft: AccountCheckpointDraft) => track((async () => {
          const store = await checkpointStore(), requestedAt = clock.nowMs();
          let lease: CheckpointLease | undefined, record: AccountCheckpoint | undefined;
          await tickets.recovery.started(input, async tx => {
            configurationHash = await outcomes.openInTransaction(tx, input.matchId, setup.data, input.rules);
            record = { ...draft, configurationHash }; lease = await store.initialize(tx, record);
          });
          if (!lease || !record) throw new ApiError('UNAVAILABLE', 503, true);
          if (this.ending) { await store.release(lease); return configurationHash; }
          this.bindCheckpoints(store, lease, record, requestedAt);
          return configurationHash;
        })()),
        saveCheckpoint: (draft: AccountCheckpointDraft, event: Parameters<LiveCheckpoints['save']>[1]) => track((async () => {
          if (!this.checkpoints) throw new ApiError('UNAVAILABLE', 503, true);
          await this.checkpoints.save({ ...draft, configurationHash }, event);
        })()),
        recordClose: (matchId: string, reason: 'ended' | 'abandoned' | 'expired') => track(tickets.recovery.closed(matchId, reason)),
        recordOutcome: (input: OutcomeIntent, draft: AccountCheckpointDraft) => track((async () => {
          if (!this.checkpoints || !draft.terminal || draft.terminal.matchId !== input.matchId) throw new ApiError('UNAVAILABLE', 503, true);
          return this.checkpoints.recordTerminal({ ...draft, configurationHash });
        })()),
        subscribeOutcome: (matchId: string, listener: (receipt: SettlementReceipt) => void) => outcomes.subscribe(matchId, receipt => listener(
          this.checkpoints?.hasDurableTerminal() ? { ...receipt, recoverable: true } : receipt)),
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
      this.ending = true;
      clearTimeout(this.lifetime);
      rooms.delete(this.roomId);
      reserved.delete(this.roomId);
      super.onDispose();
      if (this.checkpoints) void track(this.checkpoints.close()).catch(() => console.error('[AccountRoom] ownership release failed'));
    }
  }
  const directory: AccountRooms = {
    reserve(data, mode) {
      if (reserved.size >= (options.maxRooms ?? 128)) throw new ApiError('RATE_LIMITED', 429, true);
      const code = allocateRoomCode(reserved);
      const key = randomUUID();
      const setup = { code, data, mode };
      grants.set(key, setup);
      const pending: AccountRoomTarget = { ...setup, selection: () => undefined, canEnter: () => true, recovery: () => undefined };
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
      const room = rooms.get(code); return room?.hasAuthority() ? room.accountTarget() : undefined;
    },
  };
  const restorer = new AccountRestorer(checkpointStore, journal, outcomes, clock, {
    has: code => rooms.has(code),
    async install(input) {
      if (reserved.has(input.record.code) || reserved.size >= (options.maxRooms ?? 128)) throw new ApiError('UNAVAILABLE', 503, true);
      const mode = input.configuration.rules.mode;
      if (mode === 'practice') throw new ApiError('CONFLICT', 409);
      const key = randomUUID(); reserved.add(input.record.code);
      grants.set(key, { code: input.record.code, data: input.configuration.data, mode, restore: { ...input, store: await checkpointStore() } });
      try { await matchMaker.createRoom(ACCOUNT_ROOM_NAME, { creationKey: key }); }
      catch (error) { reserved.delete(input.record.code); throw error; }
      finally { grants.delete(key); }
    },
  });
  return { directory, roomClass: AccountMatchRoom, restore: () => restorer.start(), stop: () => restorer.stop(), async close() { await restorer.close(); while (pending.size) await Promise.allSettled([...pending]); } };
}
