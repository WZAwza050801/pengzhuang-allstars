import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

export interface SqlExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}
export class Database implements SqlExecutor {
  private readonly pool: Pool;
  private closing: Promise<void> | null = null;
  idleConnectionErrors = 0;
  constructor(options: { connectionString: string; max?: number }) {
    try {
      const url = new URL(options.connectionString);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2)
        throw new Error();
    } catch {
      throw new Error('Invalid database configuration');
    }
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.max ?? 10,
      connectionTimeoutMillis: 3000,
      statement_timeout: 10000,
      idle_in_transaction_session_timeout: 15000,
    });
    this.pool.on('error', () => {
      this.idleConnectionErrors++;
    });
  }
  async query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) {
    if (this.closing) throw new Error('Database closed');
    return this.pool.query<Row>(text, values ? [...values] : undefined);
  }
  async connection<T>(work: (client: PoolClient, discard: () => void) => Promise<T>): Promise<T> {
    if (this.closing) throw new Error('Database closed');
    const client = await this.pool.connect();
    let broken = false;
    try {
      return await work(client, () => {
        broken = true;
      });
    } finally {
      client.release(broken);
    }
  }
  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.connection(async (client, discard) => {
      try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discard();
        }
        throw error;
      }
    });
  }
  close(): Promise<void> {
    return (this.closing ??= this.pool.end());
  }
}
