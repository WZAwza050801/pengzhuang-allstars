import { readRuntimeConfig } from '../config/runtime';
import { Database, migrateDatabase } from '../packages/persistence/src';

const config = readRuntimeConfig();
if (!config.databaseUrl) throw new Error('Database configuration required');
const direction = process.argv.includes('--down') ? 'down' : 'up';
if (direction === 'down' && !['local', 'test'].includes(config.mode))
  throw new Error('Rollback is disabled outside local/test');
const db = new Database({ connectionString: config.databaseUrl });
try {
  const rows = await migrateDatabase(db, { direction, allowRollback: direction === 'down' });
  console.log(`Applied ${rows.length} migration(s), direction=${direction}`);
} finally {
  await db.close();
}
