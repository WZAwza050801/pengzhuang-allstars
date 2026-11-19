import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { DEFAULT_DATA } from '../shared/data';
import { createMatch, beginTurn, resolveShot, passTurn, validateShot } from '../shared/match';
import { chooseShot, type AiLevel } from '../shared/ai';
import policy from '../config/ai-policy.json';

const data = DEFAULT_DATA;
const lineup = data.rules.defaultLineup.slice();

/** One fixed-seed self-play game; both sides use the bounded practice AI policy. */
function playMatch(level0: AiLevel, level1: AiLevel, seed: number) {
  const st = createMatch(data, [lineup, lineup], { seed, levels: [null, null] });
  beginTurn(st, data);
  let guard = 0;
  while (!st.over && guard++ < 300) {
    const level = st.turn === 0 ? level0 : level1;
    const input = chooseShot(st, data, level, seed + st.shotNo * 7919 + 13, {
      maxEvaluations: policy.maxEvaluations,
      budgetMs: policy.computeBudgetMs,
    });
    if (!input || validateShot(st, data, st.turn, input)) {
      passTurn(st, data, 'no-legal-piece');
      continue;
    }
    resolveShot(st, data, input);
  }
  return { winner: st.winner as -1 | 0 | 1, score: [...st.score] as [number, number], shots: st.shotNo, endReason: st.endReason };
}

const levels: AiLevel[] = ['easy', 'normal', 'hard'];
const seeds = Array.from({ length: 6 }, (_, i) => 1000 + i * 101);
const matchups = [];
for (const side0 of levels)
  for (const side1 of levels) {
    let wins0 = 0, wins1 = 0, draws = 0, shots = 0;
    for (const seed of seeds) {
      const r = playMatch(side0, side1, seed);
      if (r.winner === 0) wins0++;
      else if (r.winner === 1) wins1++;
      else draws++;
      shots += r.shots;
    }
    matchups.push({
      side0,
      side1,
      games: seeds.length,
      wins0,
      wins1,
      draws,
      avgShots: Number((shots / seeds.length).toFixed(2)),
      side0WinRate: Number((wins0 / seeds.length).toFixed(3)),
    });
  }

const report = {
  schemaVersion: 1,
  dataVersion: data.version,
  node: process.version,
  engine: 'planck1.4.2',
  hardware: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
  policy,
  seeds,
  matchups,
  note: 'Fixed-seed self-play under the bounded practice policy. Proxy strength for observable difficulty difference, not human balance or mobile certification.',
};
writeFileSync(new URL('../docs/productization/reports/ai-strength.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ matchups: matchups.map((m) => ({ side0: m.side0, side1: m.side1, side0WinRate: m.side0WinRate, draws: m.draws, avgShots: m.avgShots })) }, null, 2));