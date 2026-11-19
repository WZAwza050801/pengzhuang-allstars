import { z } from 'zod';
import type { Database, SqlExecutor } from '../../packages/persistence/src/database';
import { ApiError } from '../api/http';
import { fingerprint, identifier, readOnly, type Finding } from './snapshot';
import { readMatchAudit } from './match-audit';
import { readOrphans } from './orphans';
export interface WalletAudit {
  currency: string;
  balance: string;
  revision: number;
  ledgerTotal: string;
  ledgerCount: string;
  ledgerHash: string;
  chainErrors: string;
  ambiguousEntries: string;
  futureEntries: string;
}
export interface UserAudit {
  database: string;
  userId: string;
  status: string;
  initialized: boolean;
  wallets: WalletAudit[];
  references: { invalidLedgerLinks: string; invalidOperations: string };
  fingerprint: string;
  findings: Finding[];
}
/** No account initialization or repair is allowed on the read path. Amounts remain decimal strings. */
export async function readUserAudit(tx: SqlExecutor, userId: string): Promise<UserAudit> {
  const user = (
    await tx.query<{ database: string; id: string; status: string; initialized: boolean }>(
      'SELECT current_database() AS database,u.id,u.status,EXISTS(SELECT 1 FROM account_initializations a WHERE a.user_id=u.id) AS initialized FROM users u WHERE u.id=$1',
      [userId],
    )
  ).rows[0];
  if (!user) throw new ApiError('NOT_FOUND', 404);
  const wallets = (
    await tx.query<WalletAudit>(
      `WITH entries AS (
    SELECT *,sum(delta) OVER (PARTITION BY currency ORDER BY created_at,id ROWS UNBOUNDED PRECEDING) AS running,
      count(*) OVER (PARTITION BY currency,created_at) AS peers FROM asset_ledger WHERE user_id=$1
  ), totals AS (
    SELECT currency,sum(delta)::text AS total,count(*)::text AS n,
      count(*) FILTER (WHERE peers=1 AND balance_after<>running)::text AS errors,
      count(*) FILTER (WHERE peers>1)::text AS ambiguous,
      count(*) FILTER (WHERE created_at>statement_timestamp())::text AS future,
      encode(sha256(convert_to(string_agg(jsonb_build_array(id,currency,delta::text,balance_after::text,reason,source_id,idempotency_key,payload_hash,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,E'\n' ORDER BY created_at,id),'UTF8')),'hex') AS digest
      FROM entries GROUP BY currency
  ) SELECT w.currency,w.balance::text,w.version AS revision,COALESCE(t.total,'0') AS "ledgerTotal",COALESCE(t.n,'0') AS "ledgerCount",
    COALESCE(t.digest,encode(sha256(''::bytea),'hex')) AS "ledgerHash",COALESCE(t.errors,'0') AS "chainErrors",
    COALESCE(t.ambiguous,'0') AS "ambiguousEntries",COALESCE(t.future,'0') AS "futureEntries"
    FROM wallets w LEFT JOIN totals t ON t.currency=w.currency WHERE w.user_id=$1 ORDER BY w.currency`,
      [userId],
    )
  ).rows;
  const references = (
    await tx.query<{ invalidLedgerLinks: string; invalidOperations: string }>(
      `SELECT
    (SELECT count(*)::text FROM asset_ledger l
      LEFT JOIN account_initializations a ON a.user_id=l.user_id
      LEFT JOIN asset_operations o ON o.user_id=l.user_id AND o.operation_key=l.idempotency_key
      LEFT JOIN data_repair_receipts r ON r.id::text=l.idempotency_key AND r.user_id=l.user_id
      WHERE l.user_id=$1 AND CASE
        WHEN l.reason='account.starter' THEN a.user_id IS NULL OR l.payload_hash<>a.payload_hash OR l.source_id<>a.grant_id OR l.idempotency_key<>a.grant_id
        WHEN l.reason='data.reconcile' THEN r.id IS NULL OR r.kind<>'restore-wallet' OR r.payload_hash<>l.payload_hash OR l.delta<>0 OR l.source_id<>('repair:'||r.id::text)
          OR r.plan->'command'->>'currency' IS DISTINCT FROM l.currency OR (r.receipt->'effect'->'ledgerIds' @> jsonb_build_array(l.id::text)) IS DISTINCT FROM true
        ELSE o.operation_key IS NULL OR o.payload_hash<>l.payload_hash OR o.source_id<>l.source_id
          OR NOT (o.reason=l.reason OR (l.reason='card.duplicate' AND o.kind='grant'))
          OR (o.result->'ledgerIds' @> jsonb_build_array(l.id::text)) IS DISTINCT FROM true END) AS "invalidLedgerLinks",
    (SELECT count(*)::text FROM asset_operations o WHERE o.user_id=$1 AND (
      jsonb_typeof(o.result->'ledgerIds') IS DISTINCT FROM 'array' OR o.result->>'operationId' IS DISTINCT FROM o.operation_key OR o.result->>'kind' IS DISTINCT FROM o.kind
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.result->'ledgerIds')='array' THEN o.result->'ledgerIds' ELSE '[]'::jsonb END) i(id)
        LEFT JOIN asset_ledger l ON l.id::text=i.id AND l.user_id=o.user_id AND l.idempotency_key=o.operation_key AND l.payload_hash=o.payload_hash WHERE l.id IS NULL)
      OR (SELECT count(*)<>count(DISTINCT id) FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.result->'ledgerIds')='array' THEN o.result->'ledgerIds' ELSE '[]'::jsonb END) i(id))
    )) AS "invalidOperations"`,
      [userId],
    )
  ).rows[0];
  const findings: Finding[] = [];
  for (const [field, code] of [
    ['invalidLedgerLinks', 'ledger-reference-invalid'],
    ['invalidOperations', 'operation-reference-invalid'],
  ] as const)
    if (references[field] !== '0') findings.push({ code, subject: userId, expected: '0', actual: references[field] });
  if (
    user.initialized &&
    (wallets.length !== 2 ||
      !wallets.some((w) => w.currency === 'coins') ||
      !wallets.some((w) => w.currency === 'fragments'))
  )
    findings.push({ code: 'wallets-missing', subject: userId, expected: '2', actual: String(wallets.length) });
  if (!user.initialized && wallets.length) findings.push({ code: 'initialization-incomplete', subject: userId });
  for (const wallet of wallets) {
    const subject = `${userId}:${wallet.currency}`,
      total = BigInt(wallet.ledgerTotal);
    if (!['coins', 'fragments'].includes(wallet.currency)) findings.push({ code: 'wallet-currency-invalid', subject });
    if (total < 0n || total > 9223372036854775807n) findings.push({ code: 'ledger-total-invalid', subject });
    if (wallet.ledgerCount === '0') findings.push({ code: 'ledger-missing', subject });
    if (wallet.balance !== wallet.ledgerTotal)
      findings.push({ code: 'wallet-balance-mismatch', subject, expected: wallet.ledgerTotal, actual: wallet.balance });
    for (const [field, code] of [
      ['chainErrors', 'ledger-chain-mismatch'],
      ['ambiguousEntries', 'ledger-order-ambiguous'],
      ['futureEntries', 'ledger-future-time'],
    ] as const)
      if (wallet[field] !== '0') findings.push({ code, subject, expected: '0', actual: wallet[field] });
  }
  const body = {
    database: user.database,
    userId: user.id,
    status: user.status,
    initialized: user.initialized,
    wallets,
    references,
  };
  return { ...body, fingerprint: fingerprint(body), findings };
}
export class DataAudit {
  constructor(private readonly db: Database) {}
  users(options: unknown = {}) {
    return this.page('users', options, readUserAudit);
  }
  matches(options: unknown = {}) {
    return this.page('matches', options, readMatchAudit);
  }
  private page<T>(table: 'users' | 'matches', options: unknown, read: (tx: SqlExecutor, id: string) => Promise<T>) {
    const parsed = z
      .strictObject({ after: z.uuid().optional(), limit: z.number().int().min(1).max(100).default(20) })
      .safeParse(options);
    if (!parsed.success) throw new ApiError('INVALID_REQUEST', 400);
    const { after, limit } = parsed.data;
    return readOnly(this.db, async (tx) => {
      const metadata = (
        await tx.query<{ database: string; snapshotAt: string }>(
          `SELECT current_database() AS database,to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "snapshotAt"`,
        )
      ).rows[0];
      // Only the two internal constants can choose a table; caller values remain parameters.
      const ids = (
        await tx.query<{ id: string }>(
          table === 'users'
            ? 'SELECT id FROM users WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2'
            : 'SELECT id FROM matches WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2',
          [after ?? null, limit + 1],
        )
      ).rows;
      const selected = ids.slice(0, limit),
        items: T[] = [];
      for (const entry of selected) items.push(await read(tx, entry.id));
      return {
        ...metadata,
        scope: table,
        limit,
        after: after ?? null,
        nextCursor: ids.length > limit ? selected.at(-1)!.id : null,
        items,
      };
    });
  }
  user(value: unknown) {
    const userId = identifier(value);
    return readOnly(this.db, (tx) => readUserAudit(tx, userId));
  }
  match(value: unknown) {
    const matchId = identifier(value);
    return readOnly(this.db, (tx) => readMatchAudit(tx, matchId));
  }
  orphans(limit = 20) {
    if (!z.number().int().min(1).max(100).safeParse(limit).success) throw new ApiError('INVALID_REQUEST', 400);
    return readOnly(this.db, (tx) => readOrphans(tx, limit));
  }
}
