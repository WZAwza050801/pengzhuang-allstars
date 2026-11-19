import { Database } from '../../packages/persistence/src/database';
import { createBundledEconomyConfiguration } from '../../config/economy';
import { DEFAULT_DATA } from '../../shared/data';
import { PlayerData } from '../../server/accounts/player-data';
import { Assets } from '../../server/accounts/assets';
import { MatchOutcomes, type MatchRatings } from '../../server/matches/outcomes';
import { OutcomeJournal } from '../../server/matches/outcome-journal';
import { writeSync } from 'node:fs';

// Owned subprocess fixture: halt at a real transaction boundary until the parent kills this process.
function halt(stage: string) {
  writeSync(1, JSON.stringify({ stage }) + '\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
process.once(
  'message',
  async (input: { action: string; databaseUrl: string; journal: string; outcome: unknown; matchId: string }) => {
    const db = new Database({ connectionString: input.databaseUrl });
    const policy = createBundledEconomyConfiguration().policy;
    const players = new PlayerData(db, policy, DEFAULT_DATA);
    const ratings: MatchRatings = {
      async applyInTransaction(tx, outcome) {
        await tx.query('INSERT INTO test_match_rating_effects(match_id,winner) VALUES ($1,$2)', [
          outcome.matchId,
          outcome.winner,
        ]);
        if (input.action === 'before-commit') {
          // Wait inside the transaction, after actual wallet/ledger/reward writes.
          await new Promise<void>(() => halt('before-commit'));
        }
      },
    };
    const service = new MatchOutcomes({
      db,
      policy: () => policy,
      assets: new Assets(db, players.initialize, () => ({ data: DEFAULT_DATA, policy })),
      journal: new OutcomeJournal(input.journal),
      ratings,
      onEvent: () => undefined,
    });
    if (input.action === 'journal-only') {
      const receipt = await service.record(input.outcome);
      if (receipt.status !== 'pending' || receipt.recorded || !receipt.recoverable)
        throw new Error('Expected durable journal only');
      halt('journal-only');
    } else {
      if (input.action === 'after-commit')
        service.subscribe(input.matchId, (receipt) => {
          if (receipt.status === 'settled') {
            // Block synchronously before MatchOutcomes can remove the file after notifying listeners.
            halt('after-commit');
          }
        });
      await service.drain();
    }
  },
);
