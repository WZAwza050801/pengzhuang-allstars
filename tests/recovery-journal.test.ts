import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RecoveryJournal, terminalEntryHash, type TerminalEntry } from '../server/matches/recovery-journal';
import { DEFAULT_DATA } from '../shared/data';
import { createMatch, beginTurn, forfeit } from '../shared/match';
import { parseSkin } from '../server/validation';

const directories: string[] = [];
async function directory() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pz-recovery-journal-'));
  directories.push(root);
  return root;
}
afterEach(async () => {
  for (const root of directories.splice(0)) {
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^pz-recovery-journal-/);
    await rm(root, { recursive: true, force: true });
  }
});
function entry(storageId: string): TerminalEntry {
  const matchId = randomUUID(),
    owners = [randomUUID(), randomUUID()];
  const match = createMatch(DEFAULT_DATA, [DEFAULT_DATA.rules.defaultLineup, DEFAULT_DATA.rules.defaultLineup], {
    seed: 123,
  });
  beginTurn(match, DEFAULT_DATA);
  forfeit(match, 0, 'surrender');
  const skin = parseSkin(undefined);
  if (!skin.ok) throw new Error('Default skin missing');
  return {
    format: 1,
    base: { matchId, ownerId: randomUUID(), storageId, epoch: '1', checkpoint: '0', payloadHash: 'b'.repeat(64) },
    record: {
      format: 1,
      engine: 'shared-match-v1',
      identity: 'account',
      protocol: 2,
      clockPolicy: 'freeze-v1',
      code: 'ABCDEF',
      matchId,
      configVersion: DEFAULT_DATA.version,
      configurationHash: 'a'.repeat(64),
      skin: skin.value,
      seed: 123,
      seq: 0,
      revision: 1,
      match,
      seats: [0, 1].map((side) => ({
        userId: owners[side],
        lineupId: randomUUID(),
        lineupRevision: 0,
        cards: DEFAULT_DATA.rules.defaultLineup.map((playerDefId, slot) => ({
          slot,
          playerDefId,
          ownedCardId: randomUUID(),
          cardVersion: 0,
          ownedLevel: 1,
          level: DEFAULT_DATA.rules.levels.uniformLevel,
        })),
      })) as TerminalEntry['record']['seats'],
      receipts: [],
      clocks: { matchMs: 0, turnMs: null, elapsedMs: 10000, playbackMs: 0, reconnectMs: [null, null] },
      savedAt: Date.now(),
      terminal: {
        schemaVersion: 1,
        protocol: 2,
        matchId,
        mode: 'friend',
        configVersion: DEFAULT_DATA.version,
        configurationHash: 'a'.repeat(64),
        finalSeq: 0,
        score: match.score,
        winner: match.winner,
        reason: 'surrender',
        elapsedSeconds: 10,
        endedAt: new Date().toISOString(),
        participants: [
          { userId: owners[0], side: 0, actions: 0 },
          { userId: owners[1], side: 1, actions: 0 },
        ],
      },
    },
  };
}
test('concurrent asynchronous journal initialization publishes one persistent storage identity', async () => {
  const root = await directory(),
    a = new RecoveryJournal(root),
    b = new RecoveryJournal(root);
  const identities = await Promise.all([a.open(), b.open(), a.open(), new RecoveryJournal(root).open()]);
  expect(new Set(identities).size).toBe(1);
  expect(identities[0]).toMatch(/^[a-f0-9-]{36}$/);
});
test('a published terminal snapshot survives a fresh instance and conflicting intent cannot overwrite it', async () => {
  const root = await directory(),
    journal = new RecoveryJournal(root),
    value = entry(await journal.open());
  expect(await journal.put(value)).toBe('stored');
  expect(await journal.put(value)).toBe('already-stored');
  const saved = await new RecoveryJournal(root).read(value.record.matchId);
  expect(terminalEntryHash(saved)).toBe(terminalEntryHash(value));
  expect(await journal.ids()).toEqual([value.record.matchId]);
  await expect(
    journal.put({ ...value, record: { ...value.record, savedAt: value.record.savedAt + 1 } }),
  ).rejects.toThrow('conflict');
  expect(terminalEntryHash(await journal.read(value.record.matchId))).toBe(terminalEntryHash(value));
  await expect(journal.remove(value.record.matchId, '0'.repeat(64))).rejects.toThrow('conflict');
  await journal.remove(value.record.matchId, terminalEntryHash(value));
  expect(await journal.ids()).toEqual([]);
});
test('the journal rejects a foreign volume, nonterminal body and corrupt checksum without exposing or deleting evidence', async () => {
  const root = await directory(),
    journal = new RecoveryJournal(root),
    value = entry(await journal.open());
  await expect(journal.put({ ...value, base: { ...value.base, storageId: randomUUID() } })).rejects.toThrow();
  await expect(journal.put({ ...value, record: { ...value.record, terminal: null } })).rejects.toThrow();
  await journal.put(value);
  const file = path.join(root, `${value.record.matchId}.json`),
    original = await readFile(file, 'utf8');
  const corrupted = JSON.parse(original);
  corrupted.payload.record.seed++;
  await writeFile(file, JSON.stringify(corrupted));
  await expect(journal.read(value.record.matchId)).rejects.toThrow('corrupt');
  expect(await readFile(file, 'utf8')).toBe(JSON.stringify(corrupted));
  await expect(journal.read('../outside')).rejects.toThrow();
});
test('journal capacity and filesystem failures are errors while an existing identical intent remains readable', async () => {
  const root = await directory(),
    journal = new RecoveryJournal(root, 1),
    value = entry(await journal.open());
  await journal.put(value);
  expect(await journal.put(value)).toBe('already-stored');
  await expect(journal.put(entry(value.base.storageId))).rejects.toThrow('capacity');
  const blocked = path.join(await directory(), 'blocked');
  await writeFile(blocked, 'file');
  await expect(new RecoveryJournal(blocked).open()).rejects.toThrow();
});

test('concurrent terminal publications cannot exceed the same process journal capacity', async () => {
  const root = await directory(),
    journal = new RecoveryJournal(root, 1),
    storageId = await journal.open();
  const results = await Promise.allSettled([journal.put(entry(storageId)), journal.put(entry(storageId))]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(await journal.ids()).toHaveLength(1);
});
