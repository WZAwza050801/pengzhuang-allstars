type Command = { run(): void | Promise<void>; failed(error: unknown): void; control?: string };
/** One room's ordered command stream. Named clock/persistence signals bypass the network queue budget. */
export class RoomCommandQueue {
  private readonly pending: Command[] = [];
  private running = false;
  private closed = false;
  private clients = 0;
  private waiters: (() => void)[] = [];
  constructor(private readonly maxClients = 32) {}
  submit(
    run: Command['run'],
    failed: Command['failed'],
    control?: 'turn' | 'match' | 'window-0' | 'window-1' | 'persistence',
  ): boolean {
    if (this.closed) return false;
    if (control) {
      const prior = this.pending.find((job) => job.control === control);
      if (prior) {
        prior.run = run;
        prior.failed = failed;
        return true;
      }
    } else {
      if (this.clients >= this.maxClients) return false;
      this.clients++;
    }
    this.pending.push({ run, failed, control });
    if (!this.running) void this.drain();
    return true;
  }
  private async drain() {
    this.running = true;
    while (!this.closed && this.pending.length) {
      const job = this.pending.shift()!;
      try {
        await job.run();
      } catch (error) {
        try {
          job.failed(error);
        } catch {
          /* Error delivery cannot stop the room command stream. */
        }
      } finally {
        if (!job.control) this.clients--;
      }
    }
    this.running = false;
    for (const resolve of this.waiters) resolve();
    this.waiters = [];
  }
  idle(): Promise<void> {
    return this.running ? new Promise((resolve) => this.waiters.push(resolve)) : Promise.resolve();
  }
  close() {
    this.closed = true;
    this.pending.length = 0;
  }
}
