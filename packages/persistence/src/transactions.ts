import type { Database, SqlExecutor } from './database';

export function sqlState(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}
/** Retry the complete SQL-only callback, at most three attempts. Callbacks must not send mail/network messages. */
export async function retryTransaction<T>(
  db: Pick<Database, 'transaction'>,
  work: (tx: SqlExecutor) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(work);
    } catch (error) {
      if (!['40P01', '40001'].includes(sqlState(error) ?? '') || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
