import { expect, test } from 'vitest';
import { runModePairs } from '../tools/mode-pairs';
import { summarizePairs, experimentFingerprints, validateBalanceReport, sha256 } from '../tools/balance-experiments';

test('paired statistics weight draws by half and keep both members of every seed together', () => {
  const rows = runModePairs({ seeds: [7, 8] }).rows;
  const paired = rows.map((row) => ({ ...row, winner: 0 as const }));
  expect(summarizePairs(paired)).toMatchObject({
    matches: 4,
    pairs: 2,
    firstWins: 2,
    secondWins: 2,
    firstScoreFraction: 0.5,
  });
  const draws = paired.map((row) => ({ ...row, winner: -1 as const }));
  expect(summarizePairs(draws).firstScoreFraction).toBe(0.5);
  expect(() => summarizePairs([...rows, rows[0]])).toThrow('exactly two');
});

test('release validation recomputes statistics and actual replay; small or altered reports cannot authorize rollout', () => {
  const base = runModePairs({ seeds: [7, 8] });
  const replayRows = base.rows.filter((row) => row.seed === 7);
  const report = {
    schemaVersion: 1,
    fingerprints: experimentFingerprints(),
    environment: { node: process.version },
    setup: { rules: base.rules, lineup: base.lineup, levels: base.levels },
    proxy: base.proxy,
    rows: base.rows,
    statistics: summarizePairs(base.rows),
    replayCheck: { seeds: [7], traceSha256: sha256(replayRows) },
    sensitivities: [],
  };
  expect(validateBalanceReport(report)).toMatchObject({ valid: true, publishable: false });
  const badVersion = structuredClone(report);
  badVersion.fingerprints.gameSha256 = 'a'.repeat(64);
  expect(() => validateBalanceReport(badVersion)).toThrow('fingerprint');
  const badCount = structuredClone(report);
  badCount.statistics.firstWins = 1000;
  expect(() => validateBalanceReport(badCount)).toThrow('statistics');
  const badReplay = structuredClone(report);
  badReplay.rows[0].traceSha256 = 'b'.repeat(64);
  badReplay.statistics = summarizePairs(badReplay.rows);
  badReplay.replayCheck.traceSha256 = sha256(badReplay.rows.filter((row) => row.seed === 7));
  expect(() => validateBalanceReport(badReplay)).toThrow('actual simulation');
  const badSetup = structuredClone(report);
  badSetup.setup.levels[0] = 10;
  expect(() => validateBalanceReport(badSetup)).toThrow('lineup');
});
