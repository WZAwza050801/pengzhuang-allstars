import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { DEFAULT_DATA } from '../shared/data';
import { chooseShot, type AiLevel, type AiSearchStats } from '../shared/ai';
import { validateShot, type MatchState, type ShotInput } from '../shared/match';
import { canonicalJson } from '../packages/game-core/src/snapshot';
import policy from '../config/ai-policy.json';
const fixture = JSON.parse(
  readFileSync(new URL('../docs/productization/reports/ai-baseline.json', import.meta.url), 'utf8'),
) as {
  dataVersion: string;
  baselineCommit: string;
  scenarios: { id: string; state: MatchState }[];
  observations: { scenario: string; level: AiLevel; seed: number; input: ShotInput | null }[];
};
if (fixture.dataVersion !== DEFAULT_DATA.version)
  throw new Error('AI benchmark fixtures require an explicit version update');
const results = [];
chooseShot(fixture.scenarios[0].state, DEFAULT_DATA, 'normal', 13);
for (const bounded of [false, true])
  for (const original of fixture.observations) {
    const scenario = fixture.scenarios.find((s) => s.id === original.scenario)!;
    let stats: AiSearchStats | undefined;
    const before = canonicalJson(scenario.state),
      start = performance.now();
    const input = chooseShot(scenario.state, DEFAULT_DATA, original.level, original.seed, {
      ...(bounded ? { maxEvaluations: policy.maxEvaluations, budgetMs: policy.computeBudgetMs } : {}),
      now: () => performance.now(),
      onStats: (v) => {
        stats = v;
      },
    });
    const elapsedMs = performance.now() - start;
    if (!bounded && canonicalJson(input) !== canonicalJson(original.input))
      throw new Error('Unbounded AI no longer matches the original implementation');
    if (input && validateShot(scenario.state, DEFAULT_DATA, scenario.state.turn, input))
      throw new Error('AI produced invalid input');
    if (canonicalJson(scenario.state) !== before) throw new Error('AI mutated authority');
    results.push({
      scenario: scenario.id,
      level: original.level,
      seed: original.seed,
      bounded,
      elapsedMs,
      stats,
      input,
    });
  }
const summary = [];
for (const bounded of [false, true])
  for (const level of ['easy', 'normal', 'hard'] as const) {
    const rows = results.filter((r) => r.bounded === bounded && r.level === level),
      times = rows.map((r) => r.elapsedMs).sort((a, b) => a - b);
    summary.push({
      bounded,
      level,
      samples: times.length,
      p50: times[Math.ceil(times.length * 0.5) - 1],
      p95: times[Math.ceil(times.length * 0.95) - 1],
      max: times.at(-1),
      exhausted: rows.filter((r) => r.stats?.reason !== 'complete').length,
    });
  }
const report = {
  schemaVersion: 1,
  dataVersion: DEFAULT_DATA.version,
  baselineCommit: fixture.baselineCommit,
  baselineChoicesEqual: fixture.observations.length,
  fixtureSha256: createHash('sha256').update(canonicalJson(fixture.scenarios)).digest('hex'),
  node: process.version,
  engine: 'planck1.4.2',
  hardware: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
  policy,
  summary,
  results,
  note: 'Nine fixed states per difficulty; local CPU measurements and proxy decisions, not mobile certification or human balance conclusions.',
};
writeFileSync(
  new URL('../docs/productization/reports/ai-latency.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify({ baselineChoicesEqual: report.baselineChoicesEqual, summary }, null, 2));
