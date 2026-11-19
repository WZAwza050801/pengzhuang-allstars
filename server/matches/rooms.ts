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
import type { QueueAssignment } from './matchmaking';
import type { QueueRoomFactory } from './matchmaking-coordinator';

/** A bounded runtime directory backed by epoch-fenced account checkpoints and the original journal volume. */
export function createAccountRooms(tickets: MatchTickets, outcomes: MatchOutcomes, clock: ServerClock, options: { maxRooms?: number; simulateShot?: MatchSimulator } = {}) {
  type Setup = { code: string; data: GameData; mode: AccountMode; matched?:QueueAssignment; restore?: RestoredAccountRoom & { store: MatchCheckpoints } };
  const grants = new Map<string, Setup>();
  const rooms = new Map<string, AccountMatchRoom>();
  const reserved = new Set<string>();
  const reservationKeys=new Map<string,string>();
  function reserveCode(code?:string) {
    if(reserved.size>=(options.maxRooms??128) || (code && reserved.has(code))) throw new ApiError(code?'UNAVAILABLE':'RATE_LIMITED',code?503:429,true);
    if(!code) code=allocateRoomCode(reserved); else reserved.add(code);
    const key=randomUUID();reservationKeys.set(code,key);return {code,key};
  }
  async function releaseReservation(code:string,key:string) {
    if(reservationKeys.get(code)!==key) return;
    await rooms.get(code)?.disconnect();
    if(reservationKeys.get(code)===key) {reservationKeys.delete(code);reserved.delete(code);}
  }
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
    private matched:QueueAssignment|undefined;
    private reservationKey='';
    override accountTarget():AccountRoomTarget|undefined {
      const target=super.accountTarget(), matched=this.matched;
      if(!target || !matched) return target;
      return {...target,assignmentId:matched.id,
        canEnter:userId=>matched.selections.some(seat=>seat.userId===userId) && target.canEnter(userId),
        selection:userId=>target.selection(userId)??matched.selections.find(seat=>seat.userId===userId)};
    }
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
      this.reservationKey=key as string;
      this.matched=setup.matched;
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
        rules: setup.restore?.configuration.rules ?? setup.matched?.rules,
        restored,
        recordStart: (input: Parameters<typeof tickets.recovery.started>[0], draft: AccountCheckpointDraft) => track((async () => {
          const store = await checkpointStore(), requestedAt = clock.nowMs();
          let lease: CheckpointLease | undefined, record: AccountCheckpoint | undefined;
          await tickets.recovery.started({...input,...(setup.matched?{assignmentId:setup.matched.id}:{})}, async tx => {
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
      if(rooms.get(this.roomId)===this) rooms.delete(this.roomId);
      if(reservationKeys.get(this.roomId)===this.reservationKey) {reservationKeys.delete(this.roomId);reserved.delete(this.roomId);}
      super.onDispose();
      if (this.checkpoints) void track(this.checkpoints.close()).catch(() => console.error('[AccountRoom] ownership release failed'));
    }
  }
  const directory: AccountRooms = {
    reserve(data, mode) {
      const {code,key} = reserveCode();
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
          await releaseReservation(code,key);
        },
      };
    },
    find(code) {
      const room = rooms.get(code); return room?.hasAuthority() ? room.accountTarget() : undefined;
    },
  };
  const queueRooms:QueueRoomFactory={find:code=>directory.find(code),reserve(requestedCode) {
    const {code,key}=reserveCode(requestedCode);
    return {code,async create(assignment) {
      if(assignment.roomCode!==code || rooms.has(code)) throw new ApiError('CONFLICT',409);
      grants.set(key,{code,data:assignment.data,mode:assignment.mode,matched:assignment});
      try {await matchMaker.createRoom(ACCOUNT_ROOM_NAME,{creationKey:key});}
      finally {grants.delete(key);}
    },async release() {grants.delete(key);await releaseReservation(code,key);}};
  }};
  const restorer = new AccountRestorer(checkpointStore, journal, outcomes, clock, {
    has: code => rooms.has(code),
    async install(input) {
      const mode = input.configuration.rules.mode;
      if (mode === 'practice') throw new ApiError('CONFLICT', 409);
      const {key}=reserveCode(input.record.code);
      grants.set(key, { code: input.record.code, data: input.configuration.data, mode, restore: { ...input, store: await checkpointStore() } });
      try { await matchMaker.createRoom(ACCOUNT_ROOM_NAME, { creationKey: key }); }
      catch (error) { await releaseReservation(input.record.code,key); throw error; }
      finally { grants.delete(key); }
    },
  });
  return { directory, queueRooms, roomClass: AccountMatchRoom, restore: () => restorer.start(), stop: () => restorer.stop(), async close() { await restorer.close(); while (pending.size) await Promise.allSettled([...pending]); } };
}
