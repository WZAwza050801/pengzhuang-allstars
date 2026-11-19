import type { SqlExecutor } from './database';

export class WechatRepository {
  constructor(private readonly sql: SqlExecutor) {}
  async claim(appId: string, codeHash: string): Promise<boolean> {
    return (
      (
        await this.sql.query(
          `WITH timing AS (SELECT clock_timestamp() AS issued)
       INSERT INTO wechat_code_attempts(app_id, code_hash, created_at, expires_at)
       SELECT $1, $2, issued, issued + interval '5 minutes' FROM timing
       ON CONFLICT DO NOTHING RETURNING code_hash`,
          [appId, codeHash],
        )
      ).rowCount === 1
    );
  }
  async succeed(appId: string, codeHash: string, userId: string): Promise<boolean> {
    return (
      (
        await this.sql.query(
          `UPDATE wechat_code_attempts SET status = 'succeeded', user_id = $3, completed_at = clock_timestamp()
       WHERE app_id = $1 AND code_hash = $2 AND status = 'pending' AND expires_at > clock_timestamp()`,
          [appId, codeHash, userId],
        )
      ).rowCount === 1
    );
  }
  async fail(appId: string, codeHash: string): Promise<void> {
    await this.sql.query(
      `UPDATE wechat_code_attempts SET status = 'failed', completed_at = clock_timestamp()
       WHERE app_id = $1 AND code_hash = $2 AND status = 'pending'`,
      [appId, codeHash],
    );
  }
}
