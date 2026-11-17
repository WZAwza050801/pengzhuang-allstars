import { createHash } from 'node:crypto';
import { Database } from '../../packages/persistence/src/database';
import { AssetRepository } from '../../packages/persistence/src/assets';
import { retryTransaction } from '../../packages/persistence/src/transactions';
import { LocalImportCommandSchema, LocalImportReceiptSchema, type LocalImportReceipt } from '../../packages/contracts/src/local-import';
import { canonicalJson } from '../../packages/game-core/src/snapshot';
import { validateOwnedFormation, InvalidOwnedLineup } from '../../packages/game-core/src/lineups';
import type { GameData } from '../../shared/data';
import type { Principal } from './access-tokens';
import type { InitializeAccount } from './player-data';
import { requireActivePrincipal } from './authorization';
import { ApiError } from '../api/http';

export class LocalImports {
  constructor(private readonly db: Database, private readonly initialize: InitializeAccount, private readonly resolveData: () => GameData) {}
  get(principal: Principal) {
    return this.db.transaction(async (tx) => {
      await requireActivePrincipal(tx, principal);
      const row = (await tx.query<{ result: unknown }>('SELECT result FROM account_local_imports WHERE user_id = $1', [principal.userId])).rows[0];
      return { receipt: row ? LocalImportReceiptSchema.parse(row.result) : null };
    });
  }
  async import(principal: Principal, value: unknown) {
    const parsed = LocalImportCommandSchema.safeParse(value);
    if (!parsed.success) throw new ApiError('INVALID_REQUEST', 400);
    const command = parsed.data;
    const hash = createHash('sha256').update(canonicalJson(command)).digest('hex');
    return retryTransaction(this.db, async (tx) => {
      await requireActivePrincipal(tx, principal);
      const previous = (await tx.query<{ payload_hash: string; result: unknown }>('SELECT payload_hash,result FROM account_local_imports WHERE user_id = $1', [principal.userId])).rows[0];
      if (previous) {
        if (previous.payload_hash !== hash) throw new ApiError('CONFLICT', 409);
        return LocalImportReceiptSchema.parse(previous.result);
      }
      await this.initialize(tx, principal.userId);
      const cards = await new AssetRepository(tx).lockDefinitions(principal.userId, command.lineups.flatMap((set) => set.playerDefIds));
      const owned = new Map(cards.map((card) => [card.playerDefId, card]));
      const lineups: LocalImportReceipt['lineups'] = [];
      const skippedLineups: number[] = [];
      const data = this.resolveData();
      for (const set of command.lineups) {
        const selected = set.playerDefIds.map((id) => owned.get(id));
        try {
          if (selected.some((card) => !card)) throw new InvalidOwnedLineup();
          const complete = selected.filter((card) => card !== undefined);
          validateOwnedFormation(data, complete);
          lineups.push({ slot: set.slot, ownedCardIds: complete.map((card) => card.id) });
        } catch (error) { if (!(error instanceof InvalidOwnedLineup)) throw error; skippedLineups.push(set.slot); }
      }
      const receipt = LocalImportReceiptSchema.parse({ version: command.version, migratedAt: new Date().toISOString(), settings: command.settings, nicknameDraft: command.nicknameDraft, lineups, skippedLineups, activeLineup: lineups.some((set) => set.slot === command.activeLineup) ? command.activeLineup : null });
      await tx.query('INSERT INTO account_local_imports(user_id,payload_hash,result) VALUES ($1,$2,$3::jsonb)', [principal.userId, hash, JSON.stringify(receipt)]);
      return receipt;
    });
  }
}
