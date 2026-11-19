import type { z } from 'zod';
import { Database, type SqlExecutor } from '../../packages/persistence/src/database';
import { requireActivePrincipal } from './authorization';
import { LineupRepository, type StoredLineup } from '../../packages/persistence/src/lineups';
import { LineupSchema } from '../../packages/contracts/src/http';
import { LineupPageQuerySchema } from '../../packages/contracts/src/lineups';
import { ModeIdSchema, type ModeId } from '../../packages/contracts/src/modes';
import { validateOwnedFormation, buildOwnedLineupCards, InvalidOwnedLineup } from '../../packages/game-core/src/lineups';
import { freezeSnapshot } from '../../packages/game-core/src/snapshot';
import { rulesForMode } from '../../config/modes';
import type { GameData } from '../../shared/data';
import type { Principal } from './access-tokens';
import type { InitializeAccount } from './player-data';
import { ApiError } from '../api/http';

export class Lineups {
  constructor(private readonly db: Database, private readonly initialize: InitializeAccount, private readonly resolveData: () => GameData) {}
  private async active(tx: SqlExecutor, principal: Principal) {
    await requireActivePrincipal(tx, principal);
    await this.initialize(tx, principal.userId);
    return new LineupRepository(tx);
  }
  private async view(repo: LineupRepository, userId: string, rows: readonly StoredLineup[]) {
    const slots = await repo.slots(userId, rows.map((row) => row.id));
    return rows.map((row) => ({ ...row, ownedCardIds: slots.filter((slot) => slot.lineup_id === row.id).map((slot) => slot.owned_card_id) }));
  }
  list(principal: Principal, input: z.infer<typeof LineupPageQuerySchema>) {
    return this.db.transaction(async (tx) => {
      const repo = await this.active(tx, principal);
      const limit = Number(input.limit ?? 20);
      const rows = await repo.list(principal.userId, input.cursor, limit + 1);
      return { lineups: await this.view(repo, principal.userId, rows.slice(0, limit)), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
    });
  }
  get(principal: Principal, id: string) {
    return this.db.transaction(async (tx) => {
      const repo = await this.active(tx, principal); const lineup = await repo.lock(principal.userId, id);
      if (!lineup) throw new ApiError('NOT_FOUND', 404);
      return (await this.view(repo, principal.userId, [lineup]))[0];
    });
  }
  private async cards(repo: LineupRepository, userId: string, ids: readonly string[]) {
    const rows = await repo.lockCards(userId, ids);
    const cards = new Map(rows.map((row) => [row.id, row]));
    if (cards.size !== ids.length || new Set(ids).size !== ids.length) throw new InvalidOwnedLineup();
    return ids.map((id) => cards.get(id)!);
  }
  save(principal: Principal, id: string, input: z.infer<typeof LineupSchema>) {
    return this.db.transaction(async (tx) => {
      const repo = await this.active(tx, principal); const lineup = await repo.lock(principal.userId, id);
      if (!lineup) throw new ApiError('NOT_FOUND', 404);
      if (lineup.revision !== input.expectedRevision) throw new ApiError('CONFLICT', 409);
      try { validateOwnedFormation(this.resolveData(), await this.cards(repo, principal.userId, input.ownedCardIds)); }
      catch (error) { if (error instanceof InvalidOwnedLineup) throw new ApiError('INVALID_REQUEST', 400); throw error; }
      const updated = await repo.replace(principal.userId, id, input.expectedRevision, input.ownedCardIds);
      if (!updated) throw new ApiError('CONFLICT', 409);
      return { ...updated, ownedCardIds: [...input.ownedCardIds] };
    });
  }
  /** NET must use this same transaction to issue/persist a ticket; never trust a client-supplied snapshot. */
  async snapshotInTransaction(tx: SqlExecutor, principal: Principal, id: string, expectedRevision: number, mode: ModeId, data = this.resolveData()) {
    if (!ModeIdSchema.safeParse(mode).success) throw new ApiError('INVALID_REQUEST', 400);
    const repo = await this.active(tx, principal); const lineup = await repo.lock(principal.userId, id);
    if (!lineup) throw new ApiError('NOT_FOUND', 404);
    if (lineup.revision !== expectedRevision) throw new ApiError('CONFLICT', 409);
    const ids = (await repo.slots(principal.userId, [id])).map((slot) => slot.owned_card_id);
    const rules = rulesForMode(data, mode);
    try {
      const cards = buildOwnedLineupCards(data, rules, await this.cards(repo, principal.userId, ids));
      return freezeSnapshot({ schemaVersion: 1 as const, userId: principal.userId, lineupId: id, revision: lineup.revision, rules, cards });
    } catch (error) { if (error instanceof InvalidOwnedLineup) throw new ApiError('CONFLICT', 409); throw error; }
  }
  snapshot(principal: Principal, id: string, expectedRevision: number, mode: ModeId) {
    return this.db.transaction((tx) => this.snapshotInTransaction(tx, principal, id, expectedRevision, mode));
  }
}
