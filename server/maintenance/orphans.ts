import type { SqlExecutor } from '../../packages/persistence/src/database';

// Only constant SQL fragments enter this catalogue. User input is never an identifier or SQL expression.
const checks = [
  [
    'profile-user',
    'SELECT p.user_id::text AS id FROM profiles p LEFT JOIN users u ON u.id=p.user_id WHERE u.id IS NULL',
  ],
  [
    'wallet-user',
    "SELECT w.user_id::text||':'||w.currency AS id FROM wallets w LEFT JOIN users u ON u.id=w.user_id WHERE u.id IS NULL",
  ],
  [
    'card-owner-definition',
    'SELECT c.id::text AS id FROM owned_cards c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN player_definitions d ON d.id=c.player_def_id WHERE u.id IS NULL OR d.id IS NULL',
  ],
  ['lineup-owner', 'SELECT l.id::text AS id FROM lineups l LEFT JOIN users u ON u.id=l.user_id WHERE u.id IS NULL'],
  [
    'lineup-slot-owner',
    "SELECT s.lineup_id::text||':'||s.slot::text AS id FROM lineup_slots s LEFT JOIN lineups l ON l.id=s.lineup_id AND l.user_id=s.user_id LEFT JOIN owned_cards c ON c.id=s.owned_card_id AND c.user_id=s.user_id WHERE l.id IS NULL OR c.id IS NULL",
  ],
  [
    'initialization-lineup',
    'SELECT a.user_id::text AS id FROM account_initializations a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN lineups l ON l.id=a.default_lineup_id AND l.user_id=a.user_id WHERE u.id IS NULL OR l.id IS NULL',
  ],
  [
    'ledger-wallet',
    'SELECT l.id::text AS id FROM asset_ledger l LEFT JOIN wallets w ON w.user_id=l.user_id AND w.currency=l.currency WHERE w.user_id IS NULL',
  ],
  [
    'operation-user',
    "SELECT a.user_id::text||':'||a.operation_key AS id FROM asset_operations a LEFT JOIN users u ON u.id=a.user_id WHERE u.id IS NULL",
  ],
  [
    'match-participant',
    "SELECT p.match_id::text||':'||p.user_id::text AS id FROM match_participants p LEFT JOIN matches m ON m.id=p.match_id LEFT JOIN users u ON u.id=p.user_id WHERE m.id IS NULL OR u.id IS NULL",
  ],
  [
    'match-context',
    'SELECT c.match_id::text AS id FROM match_settlement_contexts c LEFT JOIN matches m ON m.id=c.match_id LEFT JOIN match_settlement_configurations g ON g.hash=c.configuration_hash WHERE m.id IS NULL OR g.hash IS NULL',
  ],
  [
    'match-outcome',
    'SELECT o.match_id::text AS id FROM match_outcomes o LEFT JOIN match_settlement_contexts c ON c.match_id=o.match_id WHERE c.match_id IS NULL',
  ],
  [
    'reward-participant',
    'SELECT r.match_id::text AS id FROM match_rewards r LEFT JOIN match_outcomes o ON o.match_id=r.match_id LEFT JOIN match_participants p ON p.match_id=r.match_id AND p.user_id=r.user_id LEFT JOIN users u ON u.id=r.user_id WHERE o.match_id IS NULL OR p.user_id IS NULL OR u.id IS NULL',
  ],
  [
    'reward-ledger',
    'SELECT DISTINCT r.match_id::text AS id FROM match_rewards r CROSS JOIN LATERAL unnest(r.ledger_ids) i(id) LEFT JOIN asset_ledger l ON l.id=i.id AND l.user_id=r.user_id AND l.source_id=r.match_id::text AND l.idempotency_key=r.operation_id::text WHERE l.id IS NULL',
  ],
  [
    'settlement-event',
    "SELECT e.id::text AS id FROM outbox_events e LEFT JOIN match_outcomes o ON o.match_id::text=e.aggregate_id WHERE e.type='match.settle' AND o.match_id IS NULL",
  ],
  [
    'repair-target',
    "SELECT r.id::text AS id FROM data_repair_receipts r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN matches m ON m.id=r.match_id WHERE (r.kind='retry-settlement' AND (r.match_id IS NULL OR m.id IS NULL)) OR (r.kind<>'retry-settlement' AND (r.user_id IS NULL OR u.id IS NULL))",
  ],
  [
    'repair-ledger',
    "SELECT DISTINCT r.id::text AS id FROM data_repair_receipts r CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.receipt->'effect'->'ledgerIds')='array' THEN r.receipt->'effect'->'ledgerIds' ELSE '[]'::jsonb END) i(id) LEFT JOIN asset_ledger l ON l.id::text=i.id AND l.user_id=r.user_id WHERE l.id IS NULL",
  ],
] as const;
export async function readOrphans(tx: SqlExecutor, limit: number) {
  const findings: { code: string; count: string; examples: string[] }[] = [];
  for (const [name, query] of checks) {
    const result = (
      await tx.query<{ count: string; examples: string[] }>(
        `WITH bad AS (${query}) SELECT count(*)::text AS count,
      (SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM (SELECT id FROM bad ORDER BY id LIMIT $1) sample) AS examples FROM bad`,
        [limit],
      )
    ).rows[0];
    if (result.count !== '0') findings.push({ code: `orphan-${name}`, ...result });
  }
  const info = (
    await tx.query<{ database: string; snapshotAt: string }>(
      'SELECT current_database() AS database,transaction_timestamp()::text AS "snapshotAt"',
    )
  ).rows[0];
  return { ...info, checked: checks.map(([name]) => name), exampleLimit: limit, findings };
}
