import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  AccountRepository,
  Database,
  MatchDataRepository,
  UserDataRepository,
  migrateDatabase,
} from '@pengzhuang/persistence';
import { readRuntimeConfig } from '../config/runtime';

describe('user business schema on PostgreSQL', () => {
  let db: Database;
  let userId: string;
  beforeAll(async () => {
    const config = readRuntimeConfig({ ...process.env, APP_ENV: 'test' });
    if (!config.databaseUrl) throw new Error('Real isolated PostgreSQL required');
    db = new Database({ connectionString: config.databaseUrl });
    await migrateDatabase(db);
    userId = (await new AccountRepository(db).createUser()).id;
    await db.query("INSERT INTO player_definitions(id) VALUES ('p01'), ('p02') ON CONFLICT DO NOTHING");
  });
  afterAll(async () => {
    await db?.close();
  });

  test('preserves exact bigint amounts and rejects negative balances and overflow', async () => {
    await db.query("INSERT INTO wallets(user_id, currency, balance) VALUES ($1, 'coins', $2)", [
      userId,
      '9007199254740993',
    ]);
    expect((await db.query('SELECT balance FROM wallets WHERE user_id = $1', [userId])).rows[0].balance).toBe(
      '9007199254740993',
    );
    await expect(db.query('UPDATE wallets SET balance = -1 WHERE user_id = $1', [userId])).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      db.query("UPDATE wallets SET balance = '9223372036854775808' WHERE user_id = $1", [userId]),
    ).rejects.toMatchObject({ code: '22003' });
  });

  test('separates static definitions, card instances and users with foreign keys and BAL-05 uniqueness', async () => {
    const card = (
      await db.query("INSERT INTO owned_cards(user_id, player_def_id) VALUES ($1, 'p01') RETURNING id", [userId])
    ).rows[0];
    expect(card.id).not.toBe('p01');
    expect(card.id).not.toBe(userId);
    await expect(
      db.query("INSERT INTO owned_cards(user_id, player_def_id) VALUES ($1, 'p01')", [userId]),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db.query("INSERT INTO owned_cards(user_id, player_def_id) VALUES ($1, 'p9999')", [userId]),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      db.query("INSERT INTO owned_cards(user_id, player_def_id) VALUES ($1, 'p01')", [randomUUID()]),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(db.query('UPDATE owned_cards SET level = 11 WHERE id = $1', [card.id])).rejects.toMatchObject({
      code: '23514',
    });
  });

  test('composite foreign keys block cross-user lineup cards and duplicate slot/card assignments', async () => {
    const other = (await new AccountRepository(db).createUser()).id;
    const foreign = (
      await db.query("INSERT INTO owned_cards(user_id, player_def_id) VALUES ($1, 'p02') RETURNING id", [other])
    ).rows[0].id;
    const lineup = (await db.query("INSERT INTO lineups(user_id, name) VALUES ($1, '主力') RETURNING id", [userId]))
      .rows[0].id;
    const card = (await db.query('SELECT id FROM owned_cards WHERE user_id = $1', [userId])).rows[0].id;
    await expect(
      db.query('INSERT INTO lineup_slots(lineup_id, user_id, slot, owned_card_id) VALUES ($1, $2, 0, $3)', [
        lineup,
        userId,
        foreign,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
    await db.query('INSERT INTO lineup_slots(lineup_id, user_id, slot, owned_card_id) VALUES ($1, $2, 0, $3)', [
      lineup,
      userId,
      card,
    ]);
    await expect(
      db.query('INSERT INTO lineup_slots(lineup_id, user_id, slot, owned_card_id) VALUES ($1, $2, 1, $3)', [
        lineup,
        userId,
        card,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db.query('INSERT INTO lineup_slots(lineup_id, user_id, slot, owned_card_id) VALUES ($1, $2, 5, $3)', [
        lineup,
        userId,
        card,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('repository projections serialize bigint as strings and page cards within the requested user', async () => {
    const user = (await new AccountRepository(db).createUser()).id;
    const repository = new UserDataRepository(db);
    await repository.registerPlayerDefinitions(['p01', 'p02']);
    const profile = await repository.createProfile({ userId: user, nickname: "x';--", avatarAssetId: 'avatar_1' });
    expect(profile.exp).toBe('0');
    expect(await repository.getProfile(user)).toEqual(profile);
    expect(await repository.getProfile(randomUUID())).toBeNull();
    await repository.createCard({ userId: user, playerDefId: 'p01' });
    await repository.createCard({ userId: user, playerDefId: 'p02' });
    const first = await repository.listCards(user, { limit: 1 });
    const second = await repository.listCards(user, { afterId: first[0].id, limit: 1 });
    expect(first[0].id).not.toBe(second[0].id);
    expect(await repository.listCards(randomUUID())).toEqual([]);
    await expect(repository.listCards(user, { limit: 101 })).rejects.toThrow('limit');
    const lineup = await repository.createLineup(user, '主力');
    await repository.addLineupSlot({ lineupId: lineup.id, userId: user, slot: 0, ownedCardId: first[0].id });
    const wallet = await repository.createWallet(user, 'coins', 9223372036854775807n);
    expect(wallet.balance).toBe('9223372036854775807');
    expect(await repository.getWallets(user)).toEqual([wallet]);
    expect(JSON.parse(JSON.stringify({ profile, wallet, cards: first })).wallet.balance).toBe('9223372036854775807');
    await expect(
      repository.createWallet(user, 'fragments', Number.MAX_SAFE_INTEGER as unknown as bigint),
    ).rejects.toThrow('exact');
  });

  test('ledger preserves signed bigint values and rejects repeated business intents', async () => {
    const user = (await new AccountRepository(db).createUser()).id;
    const repository = new UserDataRepository(db);
    await repository.createWallet(user, 'coins');
    const input = {
      userId: user,
      currency: 'coins' as const,
      delta: -9007199254740993n,
      balanceAfter: 0n,
      reason: 'test.debit',
      sourceId: 'test-source',
      idempotencyKey: 'intent-1',
      payloadHash: 'a'.repeat(64),
    };
    const entry = await repository.appendLedger(input);
    expect(entry.delta).toBe('-9007199254740993');
    expect(JSON.parse(JSON.stringify(entry)).balanceAfter).toBe('0');
    await expect(repository.appendLedger(input)).rejects.toMatchObject({ code: '23505' });
    await expect(repository.appendLedger({ ...input, payloadHash: 'b'.repeat(64) })).rejects.toMatchObject({
      code: '23505',
    });
  });

  test('wallet, ledger and outbox repositories participate in one all-or-nothing transaction', async () => {
    const user = (await new AccountRepository(db).createUser()).id;
    await new UserDataRepository(db).createWallet(user, 'coins', 100n);
    const aggregateId = randomUUID();
    await expect(
      db.transaction(async (tx) => {
        await tx.query("UPDATE wallets SET balance = balance - 10 WHERE user_id = $1 AND currency = 'coins'", [user]);
        await new UserDataRepository(tx).appendLedger({
          userId: user,
          currency: 'coins',
          delta: -10n,
          balanceAfter: 90n,
          reason: 'test.rollback',
          sourceId: aggregateId,
          idempotencyKey: 'rollback',
          payloadHash: 'a'.repeat(64),
        });
        await new MatchDataRepository(tx).enqueue({ type: 'test.rollback', aggregateId, payload: { userId: user } });
        throw new Error('injected after outbox');
      }),
    ).rejects.toThrow('injected after outbox');
    expect((await new UserDataRepository(db).getWallets(user))[0].balance).toBe('100');
    expect((await db.query('SELECT id FROM asset_ledger WHERE user_id = $1', [user])).rows).toEqual([]);
    expect((await db.query('SELECT id FROM outbox_events WHERE aggregate_id = $1', [aggregateId])).rows).toEqual([]);
  });

  test('matches retain versioned five-card snapshots and enforce participant/side uniqueness', async () => {
    const repository = new MatchDataRepository(db);
    const match = await repository.createMatch({ mode: 'friend', configVersion: 'test-config-1', protocolVersion: 1 });
    expect(match.status).toBe('created');
    const lineupSnapshot = Array.from({ length: 5 }, (_, slot) => ({
      ownedCardId: randomUUID(),
      playerDefId: 'p01',
      pieceId: slot,
      level: 5,
    }));
    await repository.addParticipant({ matchId: match.id, userId, side: 0, lineupSnapshot });
    expect(
      (await db.query('SELECT lineup_snapshot FROM match_participants WHERE match_id = $1', [match.id])).rows[0]
        .lineup_snapshot,
    ).toEqual(lineupSnapshot);
    await expect(
      repository.addParticipant({ matchId: match.id, userId, side: 1, lineupSnapshot }),
    ).rejects.toMatchObject({ code: '23505' });
    const other = (await new AccountRepository(db).createUser()).id;
    await expect(
      repository.addParticipant({ matchId: match.id, userId: other, side: 0, lineupSnapshot }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      repository.addParticipant({ matchId: match.id, userId: other, side: 1, lineupSnapshot: lineupSnapshot.slice(1) }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('outbox due queries exclude processed/future events and use the pending index', async () => {
    const repository = new MatchDataRepository(db);
    const ready = await repository.enqueue({
      type: 'test.ready',
      aggregateId: 'ready',
      payload: { value: '9007199254740993' },
    });
    const future = await repository.enqueue({ type: 'test.future', aggregateId: 'future', payload: {} });
    const done = await repository.enqueue({ type: 'test.done', aggregateId: 'done', payload: {} });
    // Other suites leave real events in this disposable cluster; prioritize this fixture within the bounded page.
    await db.query("UPDATE outbox_events SET next_attempt_at = '1900-01-01T00:00:00Z' WHERE id = $1", [ready]);
    await db.query("UPDATE outbox_events SET next_attempt_at = now() + interval '1 day' WHERE id = $1", [future]);
    await db.query('UPDATE outbox_events SET processed_at = now() WHERE id = $1', [done]);
    const pending = await repository.pendingOutbox();
    expect(pending.map((entry) => entry.id)).toContain(ready);
    expect(pending.map((entry) => entry.id)).not.toContain(future);
    expect(pending.map((entry) => entry.id)).not.toContain(done);
    await db.transaction(async (tx) => {
      await tx.query('SET LOCAL enable_seqscan = off');
      const plan = await tx.query(
        'EXPLAIN SELECT id FROM outbox_events WHERE processed_at IS NULL AND next_attempt_at <= now() ORDER BY next_attempt_at, id LIMIT 50',
      );
      expect(JSON.stringify(plan.rows)).toContain('outbox_pending_idx');
    });
    const indexes = (await db.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")).rows.map(
      (row) => row.indexname,
    );
    expect(indexes).toEqual(
      expect.arrayContaining([
        'lineups_user_idx',
        'owned_cards_user_id_player_def_id_key',
        'asset_ledger_user_created_idx',
        'match_participants_user_created_idx',
        'outbox_pending_idx',
      ]),
    );
  });
});
