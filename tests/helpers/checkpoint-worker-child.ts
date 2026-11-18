import { writeSync } from 'node:fs';
import { Database, type SqlExecutor } from '../../packages/persistence/src/database';
import { MatchCheckpoints, type CheckpointLease } from '../../server/matches/checkpoint-store';
import type { AccountCheckpoint } from '../../server/matches/checkpoint';

function halt(stage: string): never {
  writeSync(1, JSON.stringify({ stage }) + '\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error('Unexpected checkpoint fixture wake-up');
}
process.once(
  'message',
  async (input: {
    action: 'before-commit' | 'after-commit';
    databaseUrl: string;
    lease: CheckpointLease;
    record: AccountCheckpoint;
  }) => {
    class CrashDatabase extends Database {
      override transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
        return super.transaction(async (tx) => {
          const result = await work(tx);
          if (input.action === 'before-commit') halt(input.action);
          return result;
        });
      }
    }
    const db = new CrashDatabase({ connectionString: input.databaseUrl });
    try {
      await new MatchCheckpoints(db, {
        ownerId: input.lease.ownerId,
        storageId: input.lease.storageId,
        leaseMs: 5000,
      }).write(input.lease, input.record, 'update');
      halt('after-commit');
    } catch {
      writeSync(2, 'Checkpoint worker fixture failed\n');
      process.exitCode = 1;
    } finally {
      await db.close();
    }
  },
);
