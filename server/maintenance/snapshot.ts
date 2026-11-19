import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Database, SqlExecutor } from '../../packages/persistence/src/database';
import { canonicalJson } from '../../packages/game-core/src/snapshot';
import { ApiError } from '../api/http';

export interface Finding {
  code: string;
  subject: string;
  expected?: string;
  actual?: string;
}
export const fingerprint = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export function identifier(value: unknown): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new ApiError('INVALID_REQUEST', 400);
  return parsed.data.toLowerCase();
}
export async function readOnly<T>(db: Database, work: (tx: SqlExecutor) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await tx.query("SET LOCAL statement_timeout='5s'");
    await tx.query("SET LOCAL lock_timeout='1s'");
    return work(tx);
  });
}
