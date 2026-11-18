import { AccountRepository, type Database } from '@pengzhuang/persistence';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createBundledEconomyConfiguration } from '../../config/economy';
import { DEFAULT_DATA } from '../../shared/data';
import { PlayerData } from '../../server/accounts/player-data';
import { Assets } from '../../server/accounts/assets';
import { MatchOutcomes, type MatchRatings } from '../../server/matches/outcomes';
import { OutcomeJournal } from '../../server/matches/outcome-journal';
import { OutcomeIntentSchema } from '../../packages/contracts/src/match-results';
import { rulesForMode } from '../../config/modes';

/** The database and runner must share a per-run random marker before any fixture writes. */
export async function createDataFixture(db: Database) {
  if (!process.env.PG_TEST_TMP_DIR || !process.env.PG_TEST_RUN_ID) throw new Error('Isolated PostgreSQL required');
  const marker = (
    await db.query<{ name: string; runId: string | null }>(
      'SELECT current_database() AS name,current_setting(\'pengzhuang.fixture_id\',true) AS "runId"',
    )
  ).rows[0];
  if (marker.name !== 'pengzhuang_test' || marker.runId !== process.env.PG_TEST_RUN_ID)
    throw new Error('Refusing non-fixture database');
  const policy = createBundledEconomyConfiguration().policy;
  const players = new PlayerData(db, policy, DEFAULT_DATA);
  const assets = new Assets(db, players.initialize, () => ({ policy, data: DEFAULT_DATA }));
  const opened: MatchOutcomes[] = [];
  const events: { code: string; matchId?: string }[] = [];
  const factory = {
    db,
    policy,
    players,
    assets,
    events,
    async owner(initialized = true) {
      const user = await new AccountRepository(db).createUser();
      if (initialized) await db.transaction((tx) => players.initialize(tx, user.id));
      return user.id;
    },
    consumer(ratings?: MatchRatings) {
      const service = new MatchOutcomes({
        db,
        assets,
        policy: () => policy,
        ratings,
        journal: new OutcomeJournal(path.join(process.env.PG_TEST_TMP_DIR!, `dat06-outcomes-${randomUUID()}`)),
        onEvent: (event) => events.push(event),
      });
      opened.push(service);
      return service;
    },
    async outcome(mode: 'friend' | 'growth' = 'friend') {
      const owners = [await factory.owner(), await factory.owner()];
      const worker = factory.consumer(),
        matchId = randomUUID();
      const configurationHash = await db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO matches(id,mode,config_version,protocol_version,status) VALUES ($1,$2,$3,2,'playing')",
          [matchId, mode, DEFAULT_DATA.version],
        );
        for (const [side, userId] of owners.entries()) {
          const cards = (
            await tx.query('SELECT id,player_def_id,level FROM owned_cards WHERE user_id=$1 ORDER BY id LIMIT 5', [
              userId,
            ])
          ).rows;
          await tx.query('INSERT INTO match_participants(match_id,user_id,side,lineup_snapshot) VALUES ($1,$2,$3,$4)', [
            matchId,
            userId,
            side,
            JSON.stringify(cards),
          ]);
        }
        return worker.openInTransaction(tx, matchId, DEFAULT_DATA, rulesForMode(DEFAULT_DATA, mode));
      });
      const outcome = OutcomeIntentSchema.parse({
        schemaVersion: 1,
        protocol: 2,
        matchId,
        mode,
        configurationHash,
        configVersion: DEFAULT_DATA.version,
        finalSeq: 4,
        score: [1, 0],
        winner: 0,
        reason: 'time',
        elapsedSeconds: 180,
        endedAt: new Date().toISOString(),
        participants: owners.map((userId, side) => ({ userId, side, actions: 2 })),
      });
      return { outcome, worker, owners };
    },
    async close() {
      for (const worker of opened) await worker.close();
    },
  };
  return factory;
}
