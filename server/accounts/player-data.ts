import { createHash } from 'node:crypto';
import { Database, type SqlExecutor } from '../../packages/persistence/src/database';
import { UserDataRepository, MatchDataRepository, type UserProfile } from '../../packages/persistence/src/user-data';
import { requireActivePrincipal } from './authorization';
import { grantStarter } from '../../packages/game-core/src/economy';
import { canonicalJson } from '../../packages/game-core/src/snapshot';
import { parseSetLineup, parseNickname } from '../../packages/contracts/src/game-validation';
import { DEFAULT_AVATAR_ASSET_ID } from '../../packages/contracts/src/player-data';
import type { EconomyPolicy } from '../../packages/contracts/src/economy';
import type { GameData } from '../../shared/data';
import type { Principal } from './access-tokens';
import { ApiError } from '../api/http';

export type InitializeAccount = (tx: SqlExecutor, userId: string) => Promise<void>;
const profileView = ({ userId: _userId, ...profile }: UserProfile) => profile;

export class PlayerData {
  constructor(private readonly db: Database, private readonly policy: EconomyPolicy, private readonly data: GameData) {
    const lineup = data.rules.defaultLineup;
    if (!parseSetLineup({ lineup, levels: lineup.map(() => 1) }, data).ok || lineup.some((id) => !policy.starter.playerDefIds.includes(id))) throw new Error('Invalid starter formation');
    grantStarter(policy, data, { wallet: { coins: 0n, fragments: 0n }, cards: [] });
  }
  readonly initialize: InitializeAccount = async (tx, userId) => {
    const user = (await tx.query<{ status: string; registration_nickname: string | null }>('SELECT status, registration_nickname FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    if (!user || user.status !== 'active') throw new ApiError('UNAUTHENTICATED', 401);
    if ((await tx.query('SELECT user_id FROM account_initializations WHERE user_id = $1', [userId])).rowCount) return;
    const existing = await tx.query(`SELECT 1 FROM profiles WHERE user_id = $1 UNION ALL SELECT 1 FROM wallets WHERE user_id = $1 UNION ALL SELECT 1 FROM owned_cards WHERE user_id = $1 UNION ALL SELECT 1 FROM lineups WHERE user_id = $1 LIMIT 1`, [userId]);
    if (existing.rowCount) throw new ApiError('CONFLICT', 409);
    const { grantId, state } = grantStarter(this.policy, this.data, { wallet: { coins: 0n, fragments: 0n }, cards: [] });
    const payloadHash = createHash('sha256').update(canonicalJson({ grantId, wallet: { coins: state.wallet.coins.toString(), fragments: state.wallet.fragments.toString() }, cards: state.cards, lineup: this.data.rules.defaultLineup })).digest('hex');
    const repo = new UserDataRepository(tx);
    const nickname = parseNickname(user.registration_nickname ?? '新球员');
    if (!nickname.ok) throw new ApiError('CONFLICT', 409);
    await repo.createProfile({ userId, nickname: nickname.value, avatarAssetId: DEFAULT_AVATAR_ASSET_ID });
    await repo.registerPlayerDefinitions(Object.keys(this.data.players));
    const cards = new Map<string, string>();
    for (const card of state.cards) cards.set(card.playerDefId, (await repo.createCard({ userId, ...card })).id);
    const lineup = await repo.createLineup(userId, '初始阵容');
    for (const [slot, id] of this.data.rules.defaultLineup.entries()) await repo.addLineupSlot({ userId, lineupId: lineup.id, slot, ownedCardId: cards.get(id)! });
    for (const currency of ['coins', 'fragments'] as const) {
      const amount = state.wallet[currency];
      await repo.createWallet(userId, currency, amount);
      await repo.appendLedger({ userId, currency, delta: amount, balanceAfter: amount, reason: 'account.starter', sourceId: grantId, idempotencyKey: grantId, payloadHash });
    }
    await tx.query('INSERT INTO account_initializations(user_id, grant_id, economy_version, data_version, payload_hash, default_lineup_id) VALUES ($1, $2, $3, $4, $5, $6)', [userId, grantId, this.policy.version, this.data.version, payloadHash, lineup.id]);
    await new MatchDataRepository(tx).enqueue({ type: 'account.initialized', aggregateId: userId, payload: { grantId, economyVersion: this.policy.version } });
  };
  private active<T>(principal: Principal, work: (tx: SqlExecutor, repo: UserDataRepository) => Promise<T>) {
    return this.db.transaction(async (tx) => {
      await requireActivePrincipal(tx, principal);
      await this.initialize(tx, principal.userId);
      return work(tx, new UserDataRepository(tx));
    });
  }
  profile(principal: Principal) { return this.active(principal, async (_tx, repo) => profileView((await repo.getProfile(principal.userId))!)); }
  updateProfile(principal: Principal, input: { nickname: string; avatarAssetId: string; expectedRevision: number }) {
    const nickname = parseNickname(input.nickname);
    if (input.avatarAssetId !== DEFAULT_AVATAR_ASSET_ID || !nickname.ok) throw new ApiError('INVALID_REQUEST', 400);
    return this.active(principal, async (_tx, repo) => {
      const profile = await repo.updateProfile(principal.userId, { ...input, nickname: nickname.value });
      if (!profile) throw new ApiError('CONFLICT', 409);
      return profileView(profile);
    });
  }
  cards(principal: Principal, input: { cursor?: string; limit?: string }) {
    return this.active(principal, async (_tx, repo) => {
      const limit = Number(input.limit ?? 20);
      const rows = await repo.listCards(principal.userId, { afterId: input.cursor, limit: limit + 1 });
      return { cards: rows.slice(0, limit).map(({ userId: _userId, ...card }) => card), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
    });
  }
  wallets(principal: Principal) { return this.active(principal, async (_tx, repo) => ({ wallets: (await repo.getWallets(principal.userId)).map(({ userId: _userId, ...wallet }) => wallet) })); }
}
