import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Database, type SqlExecutor } from '../../packages/persistence/src/database';
import { AssetRepository } from '../../packages/persistence/src/assets';
import { retryTransaction, sqlState } from '../../packages/persistence/src/transactions';
import { UserDataRepository, MatchDataRepository, type Wallet, type OwnedCard, type Currency } from '../../packages/persistence/src/user-data';
import { AssetOperationSchema, TrustedGrantSchema, TrustedDebitSchema, type AssetOperation } from '../../packages/contracts/src/economy-operations';
import { ChronologicalCursorSchema } from '../../packages/contracts/src/pagination';
import { UpgradeSchema, CraftSchema } from '../../packages/contracts/src/http';
import type { EconomyPolicy } from '../../packages/contracts/src/economy';
import { quoteUpgrade, quoteCraft, upgradeCard, craftCard, grantCard, changeWallet, economyAvailable, EconomyRuleError, type EconomyProjection } from '../../packages/game-core/src/economy';
import { canonicalJson, freezeSnapshot } from '../../packages/game-core/src/snapshot';
import type { GameData } from '../../shared/data';
import type { Principal } from './access-tokens';
import type { InitializeAccount } from './player-data';
import { requireActivePrincipal } from './authorization';
import { ApiError } from '../api/http';

export interface AssetContext { policy: EconomyPolicy; data: GameData }
interface Mutation {
  tx: SqlExecutor; repo: AssetRepository; userId: string; operationId: string; payloadHash: string;
  wallets: Map<Currency, Wallet>; ledgerIds: string[]; changedCards: Map<string, OwnedCard>; context: AssetContext;
}
const cardView = ({ userId: _userId, ...card }: OwnedCard) => card;
const walletView = ({ userId: _userId, ...wallet }: Wallet) => wallet;
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError('INVALID_REQUEST', 400);
  return result.data;
}

export class Assets {
  constructor(private readonly db: Database, private readonly initialize: InitializeAccount, private readonly resolveCurrent: () => AssetContext) {}
  private capture(context: AssetContext) { return Object.freeze({ policy: freezeSnapshot(context.policy), data: freezeSnapshot(context.data) }); }
  private async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    try { return await retryTransaction(this.db, work); }
    catch (error) {
      if (error instanceof EconomyRuleError) {
        if (error.code === 'INSUFFICIENT_FUNDS') throw new ApiError('INSUFFICIENT_FUNDS', 409);
        if (['INVALID_AMOUNT', 'OVERFLOW'].includes(error.code)) throw new ApiError('INVALID_REQUEST', 400);
        throw new ApiError('CONFLICT', 409);
      }
      const code = sqlState(error) ?? '';
      if (['40P01', '40001', '57014', '55P03', 'ECONNRESET', 'ETIMEDOUT'].includes(code) || code.startsWith('08')) throw new ApiError('UNAVAILABLE', 503, true);
      throw error;
    }
  }
  private async authorize(tx: SqlExecutor, userId: string, principal: Principal | null) {
    if (principal) await requireActivePrincipal(tx, principal);
    else if ((await new AssetRepository(tx).lockUser(userId))?.status !== 'active') throw new ApiError('UNAUTHENTICATED', 401);
    await this.initialize(tx, userId);
  }
  private async wallets(repo: AssetRepository, userId: string) {
    const rows = await repo.lockWallets(userId);
    if (rows.length !== 2 || !rows.some((row) => row.currency === 'coins') || !rows.some((row) => row.currency === 'fragments')) throw new ApiError('CONFLICT', 409);
    return new Map(rows.map((row) => [row.currency, row]));
  }
  private balances(wallets: Map<Currency, Wallet>) { return { coins: BigInt(wallets.get('coins')!.balance), fragments: BigInt(wallets.get('fragments')!.balance) }; }
  private async delta(state: Mutation, currency: Currency, delta: bigint, reason: string, sourceId: string) {
    if (delta === 0n) return;
    const balance = changeWallet(this.balances(state.wallets), { [currency]: delta })[currency];
    state.wallets.set(currency, await state.repo.wallet(state.userId, currency, balance));
    const ledger = await new UserDataRepository(state.tx).appendLedger({ userId: state.userId, currency, delta, balanceAfter: balance, reason, sourceId, idempotencyKey: state.operationId, payloadHash: state.payloadHash });
    state.ledgerIds.push(ledger.id);
  }
  private async perform(tx: SqlExecutor, principal: Principal | null, userId: string, operationId: string, kind: AssetOperation['kind'], reason: string, sourceId: string, payload: unknown, work: (state: Mutation) => Promise<void>, pinned?: AssetContext): Promise<AssetOperation> {
    await this.authorize(tx, userId, principal);
    const repo = new AssetRepository(tx);
    const payloadHash = createHash('sha256').update(canonicalJson({ kind, payload, pinnedEconomy: pinned?.policy.version ?? null, pinnedData: pinned?.data.version ?? null })).digest('hex');
    const previous = await repo.operation(userId, operationId);
    if (previous) {
      if (previous.payload_hash !== payloadHash) throw new ApiError('CONFLICT', 409);
      return AssetOperationSchema.parse(previous.result);
    }
    if ((kind === 'grant' || kind === 'debit') && await repo.sourceExists(userId, kind, reason, sourceId)) throw new ApiError('CONFLICT', 409);
    const state: Mutation = { tx, repo, userId, operationId, payloadHash, context: pinned ?? this.capture(this.resolveCurrent()), wallets: await this.wallets(repo, userId), ledgerIds: [], changedCards: new Map() };
    await work(state);
    const result = AssetOperationSchema.parse({ operationId, kind, economyVersion: state.context.policy.version, wallets: [...state.wallets.values()].map(walletView), cards: [...state.changedCards.values()].map(cardView), ledgerIds: state.ledgerIds });
    await repo.record(userId, operationId, kind, reason, sourceId, payloadHash, result);
    await new MatchDataRepository(tx).enqueue({ type: 'asset.changed', aggregateId: userId, payload: { operationId, kind, reason, sourceId, economyVersion: result.economyVersion, ownedCardIds: result.cards.map((card) => card.id) } });
    return result;
  }
  private price(context: AssetContext, expected: string) { if (context.policy.version !== expected) throw new ApiError('CONFLICT', 409); }
  private async owned(repo: AssetRepository, userId: string, id: string, context: AssetContext) {
    const card = await repo.lockCard(userId, id);
    if (!card) throw new ApiError('NOT_FOUND', 404);
    if (card.status !== 'active' || !economyAvailable(context.data.players[card.playerDefId], context.data)) throw new ApiError('CONFLICT', 409);
    return card;
  }
  upgrade(principal: Principal, cardId: string, operationId: string, body: unknown) {
    input(z.uuid(), cardId); input(z.uuid(), operationId); const command = input(UpgradeSchema, body);
    return this.transaction((tx) => this.perform(tx, principal, principal.userId, operationId, 'upgrade', 'card.upgrade', cardId, { cardId, ...command }, async (state) => {
      this.price(state.context, command.expectedEconomyVersion);
      const card = await this.owned(state.repo, principal.userId, cardId, state.context);
      if (card.version !== command.expectedRevision) throw new ApiError('CONFLICT', 409);
      const before = this.balances(state.wallets);
      const next = upgradeCard(state.context.policy, state.context.data, { wallet: before, cards: [card] }, card.playerDefId);
      await this.delta(state, 'coins', next.wallet.coins - before.coins, 'card.upgrade', cardId);
      const changed = await state.repo.upgrade(principal.userId, cardId, command.expectedRevision);
      if (!changed) throw new ApiError('CONFLICT', 409);
      state.changedCards.set(changed.id, changed);
    }));
  }
  craft(principal: Principal, operationId: string, body: unknown) {
    input(z.uuid(), operationId); const command = input(CraftSchema, body);
    return this.transaction((tx) => this.perform(tx, principal, principal.userId, operationId, 'craft', 'card.craft', command.playerDefId, command, async (state) => {
      this.price(state.context, command.expectedEconomyVersion);
      if (state.wallets.get('fragments')!.version !== command.expectedRevision) throw new ApiError('CONFLICT', 409);
      if ((await state.repo.lockDefinitions(principal.userId, [command.playerDefId])).length) throw new ApiError('CONFLICT', 409);
      const before = this.balances(state.wallets);
      const next = craftCard(state.context.policy, state.context.data, { wallet: before, cards: [] }, command.playerDefId);
      await this.delta(state, 'fragments', next.wallet.fragments - before.fragments, 'card.craft', command.playerDefId);
      await new UserDataRepository(tx).registerPlayerDefinitions([command.playerDefId]);
      const card = await new UserDataRepository(tx).createCard({ userId: principal.userId, playerDefId: command.playerDefId });
      state.changedCards.set(card.id, card);
    }));
  }
  /** Caller must be a trusted game/mail/mission/admin service; never bind this port directly to player JSON. */
  async grantInTransaction(tx: SqlExecutor, value: unknown, pinned?: AssetContext) {
    const command = input(TrustedGrantSchema, value);
    const frozen = pinned ? this.capture(pinned) : undefined;
    return this.perform(tx, null, command.userId, command.operationId, 'grant', command.reason, command.sourceId, command, async (state) => {
      const stored = new Map((await state.repo.lockDefinitions(command.userId, command.playerDefIds)).map((card) => [card.playerDefId, card]));
      const before = this.balances(state.wallets);
      let projection: EconomyProjection = { wallet: changeWallet(before, { coins: BigInt(command.coins), fragments: BigInt(command.fragments) }), cards: [...stored.values()] };
      for (const id of command.playerDefIds) projection = grantCard(state.context.policy, state.context.data, projection, id).state;
      const converted = projection.wallet.fragments - before.fragments - BigInt(command.fragments);
      await this.delta(state, 'coins', BigInt(command.coins), command.reason, command.sourceId);
      await this.delta(state, 'fragments', BigInt(command.fragments), command.reason, command.sourceId);
      await this.delta(state, 'fragments', converted, 'card.duplicate', command.sourceId);
      await new UserDataRepository(tx).registerPlayerDefinitions(command.playerDefIds);
      for (const id of new Set(command.playerDefIds)) {
        const card = stored.get(id) ?? await new UserDataRepository(tx).createCard({ userId: command.userId, playerDefId: id });
        state.changedCards.set(card.id, card);
      }
    }, frozen);
  }
  async grantTrusted(value: unknown, pinned?: AssetContext) { const command = input(TrustedGrantSchema, value); const frozen = pinned ? this.capture(pinned) : undefined; return this.transaction((tx) => this.grantInTransaction(tx, command, frozen)); }
  async debitInTransaction(tx: SqlExecutor, value: unknown) {
    const command = input(TrustedDebitSchema, value);
    return this.perform(tx, null, command.userId, command.operationId, 'debit', command.reason, command.sourceId, command, async (state) => { await this.delta(state, command.currency, -BigInt(command.amount), command.reason, command.sourceId); });
  }
  async debitTrusted(value: unknown) { const command = input(TrustedDebitSchema, value); return this.transaction((tx) => this.debitInTransaction(tx, command)); }
  private read<T>(principal: Principal, work: (tx: SqlExecutor, repo: AssetRepository, context: AssetContext) => Promise<T>) {
    return this.transaction(async (tx) => { await this.authorize(tx, principal.userId, principal); return work(tx, new AssetRepository(tx), this.capture(this.resolveCurrent())); });
  }
  upgradeQuote(principal: Principal, cardId: string) {
    input(z.uuid(), cardId);
    return this.read(principal, async (_tx, repo, context) => {
      const card = await this.owned(repo, principal.userId, cardId, context); const quote = quoteUpgrade(context.policy, card.level);
      return { ownedCardId: cardId, playerDefId: card.playerDefId, currentLevel: quote.currentLevel, nextLevel: quote.nextLevel, coins: quote.coins.toString(), expectedRevision: card.version, economyVersion: context.policy.version };
    });
  }
  craftQuote(principal: Principal, playerDefId: string) {
    return this.read(principal, async (_tx, repo, context) => {
      const wallets = await this.wallets(repo, principal.userId);
      if ((await repo.lockDefinitions(principal.userId, [playerDefId])).length) throw new ApiError('CONFLICT', 409);
      const quote = quoteCraft(context.policy, context.data, playerDefId);
      return { playerDefId, fragments: quote.fragments.toString(), expectedRevision: wallets.get('fragments')!.version, economyVersion: context.policy.version };
    });
  }
  ledger(principal: Principal, query: { limit?: string; cursor?: string }) {
    let cursor: z.infer<typeof ChronologicalCursorSchema> | undefined;
    if (query.cursor) { try { cursor = ChronologicalCursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))); } catch { throw new ApiError('INVALID_REQUEST', 400); } }
    const limit = Number(query.limit ?? 20);
    return this.read(principal, async (_tx, repo) => {
      const rows = await repo.ledger(principal.userId, limit + 1, cursor); const page = rows.slice(0, limit); const last = page.at(-1);
      return { entries: page.map(({ created_at, cursor_time: _cursor, ...row }) => ({ ...row, createdAt: created_at.toISOString() })), nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ createdAt: last.cursor_time, id: last.id })).toString('base64url') : null };
    });
  }
}
