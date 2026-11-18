import { randomUUID } from 'node:crypto';
import type { Database, SqlExecutor } from '../../packages/persistence/src/database';
import { AssetRepository } from '../../packages/persistence/src/assets';
import { UserDataRepository, MatchDataRepository } from '../../packages/persistence/src/user-data';
import { retryTransaction } from '../../packages/persistence/src/transactions';
import { MoneySchema } from '../../packages/contracts/src/money';
import { MatchOutcomeRepository } from '../../packages/persistence/src/match-outcomes';
import type { Assets } from '../accounts/assets';
import { ApiError } from '../api/http';
import { readUserAudit, type UserAudit } from './audit';
import { readOnly, fingerprint } from './snapshot';
import { readMatchAudit, type MatchAudit } from './match-audit';
import {
  RepairCommandSchema,
  RepairPlanSchema,
  parseMaintenance,
  repairHash,
  type RepairCommand,
  type RepairPlan,
  type WalletRepairCommand,
  type WalletRepairPreview,
  type SettlementRepairPreview,
} from './repair-plan';

export interface RepairReceipt {
  id: string;
  kind: RepairCommand['kind'];
  caseId: string;
  target: string;
  database: string;
  sessionUser: string;
  effectiveRole: string;
  recordedAt: string;
  effect: RepairPlan['preview'] & { ledgerIds: string[]; operationId?: string; queued?: true };
}
const target = (command: RepairCommand) =>
  command.kind === 'retry-settlement' ? command.matchId : `${command.userId}:${command.currency}`;
function preview(command: WalletRepairCommand, state: UserAudit): WalletRepairPreview {
  if (
    !state.initialized ||
    state.wallets.length !== 2 ||
    state.findings.some((finding) => finding.code !== 'wallet-balance-mismatch')
  )
    throw new ApiError('CONFLICT', 409);
  const wallet = state.wallets.find((entry) => entry.currency === command.currency);
  if (!wallet) throw new ApiError('CONFLICT', 409);
  if (command.kind === 'compensate' && (state.status !== 'active' || state.findings.length))
    throw new ApiError('CONFLICT', 409);
  if (command.kind === 'restore-wallet' && wallet.balance === wallet.ledgerTotal) throw new ApiError('CONFLICT', 409);
  const after =
    command.kind === 'restore-wallet' ? BigInt(wallet.ledgerTotal) : BigInt(wallet.balance) + BigInt(command.delta);
  if (after < 0n) throw new ApiError('INSUFFICIENT_FUNDS', 409);
  if (!MoneySchema.safeParse(after.toString()).success) throw new ApiError('INVALID_REQUEST', 400);
  return {
    type: 'wallet',
    beforeBalance: wallet.balance,
    afterBalance: after.toString(),
    beforeRevision: wallet.revision,
    afterRevision: wallet.revision + 1,
    adjustmentDelta: (after - BigInt(wallet.balance)).toString(),
    ledgerDelta: command.kind === 'restore-wallet' ? '0' : command.delta,
  };
}
function settlementPreview(state: MatchAudit): SettlementRepairPreview {
  if (
    state.protocol !== 2 ||
    state.mode === 'practice' ||
    state.status !== 'settlement-pending' ||
    state.settledAt ||
    !state.payloadHash ||
    !state.event ||
    state.event.processedAt ||
    state.event.attempts < 1 ||
    state.findings.some((finding) => finding.code !== 'settlement-exhausted')
  )
    throw new ApiError('CONFLICT', 409);
  return {
    type: 'settlement',
    eventId: state.event.id,
    beforeAttempts: state.event.attempts,
    afterAttempts: 0,
    payloadHash: state.payloadHash,
  };
}
/** Internal SQL maintenance capability. Never mount it as a player API or accept a claimed role from a plan. */
export class DataRepairs {
  constructor(
    private readonly db: Database,
    private readonly assets: Assets,
  ) {}
  async prepare(value: unknown) {
    const command = parseMaintenance(RepairCommandSchema, value);
    return readOnly(this.db, async (tx) => {
      await this.unusedCase(tx, command);
      const state =
        command.kind === 'retry-settlement'
          ? await readMatchAudit(tx, command.matchId)
          : await readUserAudit(tx, command.userId);
      const plan = parseMaintenance(RepairPlanSchema, {
        format: 1,
        id: randomUUID(),
        database: state.database,
        createdAt: new Date().toISOString(),
        command,
        expectedFingerprint: state.fingerprint,
        preview:
          command.kind === 'retry-settlement'
            ? settlementPreview(state as MatchAudit)
            : preview(command, state as UserAudit),
      });
      return { plan, sha256: repairHash(plan) };
    });
  }
  private async unusedCase(tx: SqlExecutor, command: RepairCommand) {
    if (
      (
        await tx.query('SELECT id FROM data_repair_receipts WHERE kind=$1 AND case_id=$2 AND target_key=$3', [
          command.kind,
          command.caseId,
          target(command),
        ])
      ).rowCount
    )
      throw new ApiError('CONFLICT', 409);
  }
  async apply(value: unknown, reviewedHash: string): Promise<RepairReceipt> {
    const plan = parseMaintenance(RepairPlanSchema, value),
      digest = repairHash(plan);
    if (!/^[a-f0-9]{64}$/.test(reviewedHash) || digest !== reviewedHash) throw new ApiError('INVALID_REQUEST', 400);
    return retryTransaction(this.db, async (tx) => {
      await tx.query("SET LOCAL lock_timeout='2s'");
      const identity = (
        await tx.query<{ database: string; sessionUser: string; effectiveRole: string }>(
          'SELECT current_database() AS database,session_user::text AS "sessionUser",current_user::text AS "effectiveRole"',
        )
      ).rows[0];
      if (identity.database !== plan.database) throw new ApiError('CONFLICT', 409);
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`data-repair-id:${plan.id}`]);
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `data-repair-case:${plan.command.kind}:${plan.command.caseId}:${target(plan.command)}`,
      ]);
      const prior = (
        await tx.query<{ payload_hash: string; receipt: RepairReceipt }>(
          'SELECT payload_hash,receipt FROM data_repair_receipts WHERE id=$1',
          [plan.id],
        )
      ).rows[0];
      if (prior) {
        if (prior.payload_hash !== digest) throw new ApiError('CONFLICT', 409);
        return prior.receipt;
      }
      await this.unusedCase(tx, plan.command);
      if (plan.command.kind === 'retry-settlement') return this.retrySettlement(tx, plan, digest, identity);
      if (plan.preview.type !== 'wallet') throw new ApiError('INVALID_REQUEST', 400);
      const command = plan.command;
      const repo = new AssetRepository(tx);
      await repo.lockUser(plan.command.userId);
      await repo.lockWallets(plan.command.userId);
      const state = await readUserAudit(tx, plan.command.userId);
      if (
        state.fingerprint !== plan.expectedFingerprint ||
        fingerprint(preview(plan.command, state)) !== fingerprint(plan.preview)
      )
        throw new ApiError('CONFLICT', 409);
      let ledgerIds: string[], operationId: string | undefined;
      if (plan.command.kind === 'restore-wallet') {
        const changed = await tx.query(
          `UPDATE wallets SET balance=$3,version=version+1 WHERE user_id=$1 AND currency=$2 AND balance=$4 AND version=$5 RETURNING version`,
          [
            plan.command.userId,
            plan.command.currency,
            plan.preview.afterBalance,
            plan.preview.beforeBalance,
            plan.preview.beforeRevision,
          ],
        );
        if (changed.rowCount !== 1) throw new ApiError('CONFLICT', 409);
        const entry = await new UserDataRepository(tx).appendLedger({
          userId: plan.command.userId,
          currency: plan.command.currency,
          delta: 0n,
          balanceAfter: BigInt(plan.preview.afterBalance),
          reason: 'data.reconcile',
          sourceId: `repair:${plan.id}`,
          idempotencyKey: plan.id,
          payloadHash: digest,
        });
        ledgerIds = [entry.id];
      } else {
        const common = {
          userId: plan.command.userId,
          operationId: plan.id,
          sourceId: `repair:${plan.command.caseId}:${plan.command.currency}`,
          reason: 'admin.correction',
        };
        const delta = BigInt(plan.command.delta);
        const operation =
          delta > 0n
            ? await this.assets.grantInTransaction(tx, {
                ...common,
                coins: plan.command.currency === 'coins' ? delta.toString() : '0',
                fragments: plan.command.currency === 'fragments' ? delta.toString() : '0',
                playerDefIds: [],
              })
            : await this.assets.debitInTransaction(tx, {
                ...common,
                currency: plan.command.currency,
                amount: (-delta).toString(),
              });
        const wallet = operation.wallets.find((entry) => entry.currency === command.currency);
        if (
          !wallet ||
          wallet.balance !== plan.preview.afterBalance ||
          wallet.version !== plan.preview.afterRevision ||
          !operation.ledgerIds.length
        )
          throw new ApiError('CONFLICT', 409);
        ledgerIds = operation.ledgerIds;
        operationId = operation.operationId;
      }
      const receipt: RepairReceipt = {
        id: plan.id,
        kind: plan.command.kind,
        caseId: plan.command.caseId,
        target: target(plan.command),
        ...identity,
        recordedAt: new Date().toISOString(),
        effect: { ...plan.preview, ledgerIds, ...(operationId ? { operationId } : {}) },
      };
      return this.record(tx, plan, digest, receipt);
    });
  }
  private async retrySettlement(
    tx: SqlExecutor,
    plan: RepairPlan,
    digest: string,
    identity: Pick<RepairReceipt, 'database' | 'sessionUser' | 'effectiveRole'>,
  ) {
    if (plan.command.kind !== 'retry-settlement' || plan.preview.type !== 'settlement')
      throw new ApiError('INVALID_REQUEST', 400);
    const command = plan.command;
    const locked = await tx.query(
      "SELECT id FROM outbox_events WHERE id=$1 AND type='match.settle' AND aggregate_id=$2 FOR UPDATE",
      [plan.preview.eventId, command.matchId],
    );
    if (locked.rowCount !== 1) throw new ApiError('CONFLICT', 409);
    const repo = new MatchOutcomeRepository(tx);
    await repo.lockMatch(command.matchId);
    await repo.outcome(command.matchId, true);
    const state = await readMatchAudit(tx, command.matchId);
    if (
      state.fingerprint !== plan.expectedFingerprint ||
      fingerprint(settlementPreview(state)) !== fingerprint(plan.preview)
    )
      throw new ApiError('CONFLICT', 409);
    const changed = await tx.query(
      'UPDATE outbox_events SET attempts=0,error_code=NULL,next_attempt_at=clock_timestamp() WHERE id=$1 AND processed_at IS NULL AND attempts=$2',
      [plan.preview.eventId, plan.preview.beforeAttempts],
    );
    if (changed.rowCount !== 1) throw new ApiError('CONFLICT', 409);
    const receipt: RepairReceipt = {
      id: plan.id,
      kind: command.kind,
      caseId: command.caseId,
      target: target(command),
      ...identity,
      recordedAt: new Date().toISOString(),
      effect: { ...plan.preview, ledgerIds: [], queued: true },
    };
    return this.record(tx, plan, digest, receipt);
  }
  private async record(tx: SqlExecutor, plan: RepairPlan, digest: string, receipt: RepairReceipt) {
    const command = plan.command,
      matchId = command.kind === 'retry-settlement' ? command.matchId : null,
      userId = command.kind === 'retry-settlement' ? null : command.userId;
    await tx.query(
      'INSERT INTO data_repair_receipts(id,kind,case_id,target_key,user_id,match_id,payload_hash,plan,receipt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        plan.id,
        command.kind,
        command.caseId,
        target(command),
        userId,
        matchId,
        digest,
        JSON.stringify(plan),
        JSON.stringify(receipt),
      ],
    );
    await new MatchDataRepository(tx).enqueue({
      type: 'data.repaired',
      aggregateId: userId ?? matchId!,
      payload: { repairId: plan.id, kind: command.kind, caseId: command.caseId },
    });
    return receipt;
  }
}
