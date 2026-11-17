import type { SqlExecutor } from './database';

export class MetadataRepository {
  constructor(private readonly sql: SqlExecutor) {}
  async get(key: string): Promise<{ key: string; value: unknown } | null> {
    const result = await this.sql.query<{ key: string; value: unknown }>(
      'SELECT key, value FROM service_metadata WHERE key = $1',
      [key],
    );
    return result.rows[0] ?? null;
  }
  async set(key: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error('Metadata value must be JSON');
    await this.sql.query(
      'INSERT INTO service_metadata(key,value) VALUES ($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value',
      [key, json],
    );
  }
}
