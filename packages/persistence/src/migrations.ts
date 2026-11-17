import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Database } from './database';

export async function migrateDatabase(
  db: Database,
  options: { direction?: 'up' | 'down'; allowRollback?: boolean; directory?: string; table?: string } = {},
) {
  const direction = options.direction ?? 'up';
  if (direction === 'down' && !options.allowRollback)
    throw new Error('Rollback requires explicit local/test authorization');
  const table = options.table ?? 'pgmigrations';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(table)) throw new Error('Invalid migration table');
  return db.connection(async (client, discard) => {
    try {
      return await runner({
        dbClient: client,
        migrationsTable: table,
        dir: options.directory ?? fileURLToPath(new URL('../migrations/', import.meta.url)),
        direction,
        ...(direction === 'down' ? { count: 1 } : {}),
        checkOrder: true,
        singleTransaction: true,
        advisoryLockMode: 'wait',
        log: () => undefined,
      });
    } catch (error) {
      discard();
      throw error;
    }
  });
}
