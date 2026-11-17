import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { availableParallelism, cpus, platform, arch } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DEFAULT_DATA, buildGameData, type GameData } from '../shared/data';
import { MODE_POLICY } from '../config/modes';
import { ECONOMY_POLICY } from '../config/economy';
import { makeConfigPackage, diffConfiguration } from '../config/versioned';
import { canonicalJson } from '../packages/game-core/src/snapshot';
import { runModePairs } from './mode-pairs';

export const sha256 = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export function archiveCurrentBundles() {
  const archives = [
    {
      directory: '../config/physics-archive/',
      version: DEFAULT_DATA.physics.version,
      content: makeConfigPackage(DEFAULT_DATA.physics.version, DEFAULT_DATA.physics),
    },
    { directory: '../config/mode-archive/', version: MODE_POLICY.version, content: MODE_POLICY },
  ];
  for (const archive of archives) {
    const directory = new URL(archive.directory, import.meta.url);
    const target = new URL(`${archive.version}.json`, directory);
    mkdirSync(directory, { recursive: true });
    if (existsSync(target)) {
      if (canonicalJson(JSON.parse(readFileSync(target, 'utf8'))) !== canonicalJson(archive.content))
        throw new Error('Archive version conflict; historical packages may not be overwritten');
    } else writeFileSync(target, JSON.stringify(archive.content, null, 2) + '\n');
  }
}
const side = z.union([z.literal(0), z.literal(1)]);
const rowSchema = z.strictObject({
  seed: z.number().int().min(0).max(0xffffffff),
  firstSide: side,
  winner: z.union([side, z.literal(-1)]),
  score: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  reason: z.enum(['goals', 'time', 'shot-limit']),
  shots: z.number().int().positive().max(100000),
  elapsedSeconds: z.number().finite().nonnegative(),
  skillEvents: z.number().int().nonnegative(),
  traceSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type PairRow = z.infer<typeof rowSchema>;
export function summarizePairs(input: unknown) {
  const rows = z.array(rowSchema).min(2).max(20000).parse(input);
  const pairs = new Map<number, PairRow[]>();
  for (const row of rows) pairs.set(row.seed, [...(pairs.get(row.seed) ?? []), row]);
  if ([...pairs.values()].some((pair) => pair.length !== 2 || new Set(pair.map((r) => r.firstSide)).size !== 2))
    throw new Error('Each seed requires exactly two swapped-first-side matches');
  const score = (r: PairRow) => (r.winner === -1 ? 0.5 : r.winner === r.firstSide ? 1 : 0);
  const means = [...pairs.values()].map((pair) => (score(pair[0]) + score(pair[1])) / 2);
  const mean = means.reduce((a, b) => a + b, 0) / means.length;
  const variance =
    means.length > 1 ? means.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (means.length - 1) : 0;
  const radius = means.length > 1 ? 1.96 * Math.sqrt(variance / means.length) : 0.5;
  return {
    matches: rows.length,
    pairs: means.length,
    firstWins: rows.filter((r) => r.winner === r.firstSide).length,
    secondWins: rows.filter((r) => r.winner !== -1 && r.winner !== r.firstSide).length,
    draws: rows.filter((r) => r.winner === -1).length,
    shotLimitVoids: rows.filter((r) => r.reason === 'shot-limit').length,
    firstScoreFraction: mean,
    biasPercentagePoints: (mean - 0.5) * 100,
    confidence95: [Math.max(0, mean - radius), Math.min(1, mean + radius)],
    confidenceMethod: 'normal interval over independent seed-pair means; AI proxy only',
    rowsSha256: sha256(rows),
  };
}
export function experimentFingerprints(data: GameData = DEFAULT_DATA) {
  return {
    gameDataVersion: data.version,
    gameSha256: sha256(data),
    modesVersion: MODE_POLICY.version,
    modesSha256: sha256(MODE_POLICY),
    economyVersion: ECONOMY_POLICY.version,
    economySha256: sha256(ECONOMY_POLICY),
  };
}
export function validateBalanceReport(input: unknown, data: GameData = DEFAULT_DATA) {
  const report = z
    .strictObject({
      schemaVersion: z.literal(1),
      fingerprints: z.unknown(),
      environment: z.unknown(),
      setup: z.unknown(),
      proxy: z.unknown(),
      rows: z.array(rowSchema).min(2).max(20000),
      statistics: z.unknown(),
      replayCheck: z.unknown(),
      sensitivities: z.unknown(),
    })
    .parse(input);
  if (canonicalJson(report.fingerprints) !== canonicalJson(experimentFingerprints(data)))
    throw new Error('Experiment configuration fingerprint mismatch');
  const setup = runModePairs({ seeds: [], data });
  if (canonicalJson(report.setup) !== canonicalJson({ rules: setup.rules, lineup: setup.lineup, levels: setup.levels }))
    throw new Error('Experiment lineup/rules mismatch');
  if (canonicalJson(report.proxy) !== canonicalJson(setup.proxy))
    throw new Error('Experiment AI/clock budget mismatch');
  const statistics = summarizePairs(report.rows);
  if (canonicalJson(statistics) !== canonicalJson(report.statistics)) throw new Error('Experiment statistics mismatch');
  for (const row of report.rows) {
    const winner = row.score[0] === row.score[1] ? -1 : row.score[0] > row.score[1] ? 0 : 1;
    if (
      winner !== row.winner ||
      row.shots > data.rules.maxShots ||
      (row.reason === 'goals' && Math.max(...row.score) !== data.rules.goalsToWin) ||
      (row.reason === 'time' && row.elapsedSeconds < data.rules.matchSeconds)
    )
      throw new Error('Inconsistent terminal match');
  }
  const replay = z
    .strictObject({ seeds: z.array(z.number().int()).min(1), traceSha256: z.string().regex(/^[a-f0-9]{64}$/) })
    .parse(report.replayCheck);
  const replayRows = report.rows.filter((row) => replay.seeds.includes(row.seed));
  if (replayRows.length !== replay.seeds.length * 2 || sha256(replayRows) !== replay.traceSha256)
    throw new Error('Replay evidence mismatch');
  if (canonicalJson(runModePairs({ seeds: replay.seeds, data }).rows) !== canonicalJson(replayRows))
    throw new Error('Historical replay differs from actual simulation');
  const reasons = [];
  if (statistics.matches < 1000) reasons.push('At least 1000 paired matches required');
  if (statistics.shotLimitVoids) reasons.push('Safety shot-limit reached');
  if (statistics.confidence95[0] < 0.45 || statistics.confidence95[1] > 0.55)
    reasons.push('First-side bias confidence interval exceeds the engineering 5 percentage point budget');
  return { valid: true, publishable: reasons.length === 0, reasons, statistics };
}

async function generateReport() {
  const seeds = Array.from({ length: 500 }, (_, i) => i + 1);
  const workers = Math.min(4, availableParallelism());
  const jobs = Array.from({ length: workers }, (_, i) => seeds.filter((_, j) => j % workers === i));
  let complete = 0;
  const output = await Promise.all(
    jobs.map(async (chunk) => {
      const result = await promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(import.meta.url), '--worker', JSON.stringify(chunk)],
        { maxBuffer: 16 * 1024 * 1024 },
      );
      const batch = JSON.parse(result.stdout) as PairRow[];
      complete += batch.length;
      console.log(`Balance matches completed: ${complete}/1000`);
      return batch;
    }),
  );
  const rows = output.flat().sort((a, b) => a.seed - b.seed || a.firstSide - b.firstSide);
  const replaySeeds = [1, 42];
  const replayRows = runModePairs({ seeds: replaySeeds }).rows;
  const expected = rows.filter((row) => replaySeeds.includes(row.seed));
  if (canonicalJson(replayRows) !== canonicalJson(expected)) throw new Error('Independent replay changed');
  const sensitivities = [];
  for (const delta of [-0.05, 0.05]) {
    const physics = structuredClone(DEFAULT_DATA.physics);
    physics.version = `phys-experiment-${delta < 0 ? 'slower' : 'faster'}`;
    physics.shot.vmax *= 1 + delta;
    const probe = runModePairs({ seeds: [1, 2, 3, 4], data: buildGameData(physics) });
    sensitivities.push({
      axis: 'vmax',
      factor: 1 + delta,
      diff: diffConfiguration(DEFAULT_DATA.physics, physics),
      fingerprints: experimentFingerprints(buildGameData(physics)),
      ...probe,
    });
  }
  for (const level of [1, 10])
    sensitivities.push({ axis: 'owned-level', level, ...runModePairs({ seeds: [1, 2, 3, 4], mode: 'growth', level }) });
  sensitivities.push({ axis: 'AI-search-budget', ...runModePairs({ seeds: [1, 2, 3, 4], maxEvaluations: 8 }) });
  const setup = runModePairs({ seeds: [] });
  const report = {
    schemaVersion: 1,
    fingerprints: experimentFingerprints(),
    environment: {
      node: process.version,
      planck: '1.4.2',
      workers,
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
    },
    setup: { rules: setup.rules, lineup: setup.lineup, levels: setup.levels },
    proxy: runModePairs({ seeds: [] }).proxy,
    rows,
    statistics: summarizePairs(rows),
    replayCheck: { seeds: replaySeeds, traceSha256: sha256(replayRows) },
    sensitivities,
  };
  const result = validateBalanceReport(report);
  if (process.argv.includes('--write')) {
    writeFileSync(
      new URL('../docs/productization/reports/balance-experiment.json', import.meta.url),
      JSON.stringify(report, null, 2) + '\n',
    );
    archiveCurrentBundles();
  }
  console.log(JSON.stringify(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--archive-only')) {
    archiveCurrentBundles();
    console.log('Immutable baseline archives verified');
  } else if (process.argv.includes('--worker')) {
    const seeds = z
      .array(z.number().int().min(0).max(0xffffffff))
      .min(1)
      .max(500)
      .parse(JSON.parse(process.argv.at(-1)!));
    console.log(JSON.stringify(runModePairs({ seeds }).rows));
  } else if (process.argv.includes('--check')) {
    const input = JSON.parse(
      readFileSync(new URL('../docs/productization/reports/balance-experiment.json', import.meta.url), 'utf8'),
    );
    const result = validateBalanceReport(input);
    console.log(JSON.stringify(result));
    if (process.argv.includes('--require-publishable') && !result.publishable) process.exitCode = 1;
  } else await generateReport();
}
