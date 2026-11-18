import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { OutcomeIntentSchema } from '../packages/contracts/src/match-results';
import { OutcomeJournal } from '../server/matches/outcome-journal';

const intent = () => ({
  schemaVersion: 1 as const,
  protocol: 2 as const,
  matchId: crypto.randomUUID(),
  mode: 'friend' as const,
  configurationHash: 'a'.repeat(64),
  configVersion: 'frozen',
  finalSeq: 4,
  score: [1, 0] as [number, number],
  winner: 0 as const,
  reason: 'time' as const,
  elapsedSeconds: 180,
  endedAt: '2026-11-18T05:00:00.000Z',
  participants: [
    { userId: crypto.randomUUID(), side: 0 as const, actions: 2 },
    { userId: crypto.randomUUID(), side: 1 as const, actions: 2 },
  ] as const,
});
test('outcome intents are bounded, exclude credentials and bind both unique sides and accepted action counts', () => {
  const value = intent();
  expect(OutcomeIntentSchema.parse(value)).toEqual(value);
  for (const extra of [
    { ticket: 'secret' },
    { finalSeq: 5 },
    { participants: [value.participants[0], value.participants[0]] },
    { reason: 'abandoned', winner: 0 },
    { elapsedSeconds: Infinity },
    { protocol: 1 },
  ])
    expect(OutcomeIntentSchema.safeParse({ ...value, ...extra }).success).toBe(false);
});
test('the immutable journal returns identical retries, refuses conflicts and survives a fresh owner', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'pz-outcome-journal-'));
  try {
    const value = intent(),
      journal = new OutcomeJournal(directory);
    expect(journal.put(value)).toBe('stored');
    expect(journal.put(value)).toBe('already-stored');
    expect(journal.put({ ...value, matchId: value.matchId.toUpperCase() })).toBe('already-stored');
    expect(journal.read(value.matchId.toUpperCase())).toEqual(value);
    expect(() => journal.put({ ...value, score: [2, 0] })).toThrow('conflict');
    expect(new OutcomeJournal(directory).list()).toEqual([value]);
    expect(JSON.parse(readFileSync(path.join(directory, `${value.matchId}.json`), 'utf8'))).toMatchObject({
      outcome: value,
    });
    expect(() => journal.remove('../outside')).toThrow();
    journal.remove(value.matchId);
    expect(journal.list()).toEqual([]);
  } finally {
    expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(directory)).toMatch(/^pz-outcome-journal-/);
    rmSync(directory, { recursive: true, force: true });
  }
});
