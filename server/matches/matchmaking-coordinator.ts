import type { AccountRoomTarget } from './tickets';
import type { MatchmakingQueue, QueueAssignment } from './matchmaking';
import { ApiError } from '../api/http';

export interface QueuedRoomLease {
  code: string;
  create(assignment: QueueAssignment): Promise<void>;
  release(): Promise<void>;
}
export interface QueueRoomFactory {
  reserve(code?: string): QueuedRoomLease;
  find(code: string): AccountRoomTarget | undefined;
}
/** Database pairing precedes physical room creation. Retry the same reservation if SQL's reply is uncertain. */
export class MatchmakingCoordinator {
  private readonly reservations = new Map<string, { lease: QueuedRoomLease; assignment?: QueueAssignment }>();
  private running: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private closing = false;
  private lastError = 0;
  constructor(
    private readonly queue: MatchmakingQueue,
    private readonly rooms: QueueRoomFactory,
  ) {}
  private report() {
    if (Date.now() - this.lastError < 10000) return;
    this.lastError = Date.now();
    console.error(JSON.stringify({ event: 'matchmaking', code: 'room-coordination-unavailable' }));
  }
  start() {
    if (!this.timer && !this.closing) {
      this.timer = setInterval(() => {
        void this.pump().catch(() => this.report());
      }, 1000);
      this.timer.unref();
    }
    return this.pump();
  }
  pump(): Promise<void> {
    if (this.closing) return Promise.resolve();
    return (this.running ??= this.work().finally(() => {
      this.running = undefined;
    }));
  }
  private async release(code: string) {
    const reservation = this.reservations.get(code);
    if (!reservation) return;
    await reservation.lease.release();
    this.reservations.delete(code);
  }
  private async pair(code: string) {
    try {
      return await this.queue.pair(code);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        await this.release(code);
        return null;
      }
      throw error;
    }
  }
  private async materialize(pair: QueueAssignment) {
    let reservation = this.reservations.get(pair.roomCode);
    if (!reservation) {
      reservation = { lease: this.rooms.reserve(pair.roomCode), assignment: pair };
      this.reservations.set(pair.roomCode, reservation);
    }
    reservation.assignment = pair;
    try {
      const current = this.rooms.find(pair.roomCode);
      if (current && current.assignmentId !== pair.id) throw new ApiError('CONFLICT', 409);
      if (!current) await reservation.lease.create(pair);
      await this.queue.ready(pair.id);
    } catch (error) {
      if (this.rooms.find(pair.roomCode)?.assignmentId === pair.id) {
        this.report();
        return;
      }
      await this.queue.fail(pair.id);
      await this.release(pair.roomCode);
      if (!(error instanceof ApiError)) this.report();
    }
  }
  private async work() {
    const known = [...this.reservations.values()].flatMap((value) => (value.assignment ? [value.assignment.id] : []));
    const states = await this.queue.assignmentStates(known);
    for (const [code, value] of this.reservations) {
      if (this.closing) return;
      if (!value.assignment) {
        const pair = await this.pair(code);
        if (pair) await this.materialize(pair);
        else await this.release(code);
        continue;
      }
      const state = states.find((valueState) => valueState.id === value.assignment!.id);
      if (!state || state.state === 'failed' || state.state === 'completed') {
        const current = this.rooms.find(code);
        // SQL result publication can precede the room's final durable notification.
        if (
          state?.state === 'completed' &&
          current &&
          !value.assignment.selections.some((seat) => current.recovery(seat.userId)?.phase === 'ended')
        )
          continue;
        await this.release(code);
      }
    }
    for (const pair of await this.queue.assignments()) {
      if (this.closing) return;
      await this.materialize(pair);
    }
    for (let count = 0; count < 4 && !this.closing; count++) {
      let lease: QueuedRoomLease;
      try {
        lease = this.rooms.reserve();
      } catch (error) {
        if (error instanceof ApiError && (error.code === 'RATE_LIMITED' || error.code === 'UNAVAILABLE')) break;
        throw error;
      }
      this.reservations.set(lease.code, { lease });
      const pair = await this.pair(lease.code);
      if (!pair) {
        await this.release(lease.code);
        break;
      }
      await this.materialize(pair);
    }
  }
  stop() {
    this.closing = true;
    clearInterval(this.timer);
  }
  async close() {
    this.stop();
    await this.running;
    await this.queue.stopHost();
    for (const [code, value] of this.reservations) if (!value.assignment) await this.release(code);
    this.reservations.clear();
  }
}
