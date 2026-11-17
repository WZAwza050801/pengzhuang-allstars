import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DATA, type GameData } from '../shared/data';
import { beginTurn, createMatch, endByTime, passTurn, resolveShot } from '../shared/match';
import { chooseShot, fallbackShot } from '../shared/ai';
import { rulesForMode } from '../config/modes';
import { resolveModeLineup } from '../packages/game-core/src/modes';
import { canonicalJson } from '../packages/game-core/src/snapshot';
import type { ModeId } from '../packages/contracts/src/modes';

export function runModePairs(options: {
  seeds: number[];
  data?: GameData;
  mode?: ModeId;
  lineup?: string[];
  maxEvaluations?: number;
}) {
  const data = options.data ?? DEFAULT_DATA,
    mode = options.mode ?? 'friend',
    rules = rulesForMode(data, mode);
  const lineup = options.lineup ?? ['p01', 'p02', 'p03', 'p04', 'p05'];
  const selection = resolveModeLineup(data, rules, lineup, {
    owned: lineup.map((playerDefId) => ({ playerDefId, level: 5 })),
  });
  const maxEvaluations = options.maxEvaluations ?? 2;
  const rows = [];
  for (const seed of options.seeds)
    for (const firstSide of [0, 1] as const) {
      const state = createMatch(data, [selection.lineup, selection.lineup], {
        seed,
        firstSide,
        levels: [selection.levels, selection.levels],
      });
      let elapsedSeconds = 0,
        skillEvents = beginTurn(state, data).filter((e) => e.type === 'skill').length;
      const trace = createHash('sha256');
      while (!state.over) {
        const input =
          chooseShot(state, data, 'easy', state.shotNo * 7919 + 13, { maxEvaluations, now: () => 0 }) ??
          fallbackShot(state, data);
        if (input) {
          const shot = resolveShot(state, data, input);
          elapsedSeconds += shot.sim.frames.length / data.physics.recordHz + 2;
          skillEvents += [...shot.events, ...shot.turnEvents].filter((e) => e.type === 'skill').length;
        } else {
          const events = passTurn(state, data, 'no-legal-piece');
          skillEvents += events.filter((e) => e.type === 'skill').length;
          elapsedSeconds += rules.turnSeconds;
        }
        if (!state.over && elapsedSeconds >= rules.matchSeconds) endByTime(state);
        trace.update(canonicalJson(state));
        if (state.shotNo > data.rules.maxShots) throw new Error('Unbounded experimental match');
      }
      rows.push({
        seed,
        firstSide,
        winner: state.winner,
        score: state.score,
        reason: state.endReason,
        shots: state.shotNo,
        elapsedSeconds,
        skillEvents,
        traceSha256: trace.digest('hex'),
      });
    }
  return {
    schemaVersion: 1,
    rules,
    lineup: selection.lineup,
    levels: selection.levels,
    proxy: {
      difficulty: 'easy',
      maxEvaluations,
      decisionSeconds: 2,
      clock: 'virtual-playback-plus-decision',
      note: 'Deterministic low-budget AI proxy; not evidence of human balance or real server wall-clock timing',
    },
    rows,
    summary: {
      matches: rows.length,
      firstWins: rows.filter((r) => r.winner === r.firstSide).length,
      secondWins: rows.filter((r) => r.winner !== -1 && r.winner !== r.firstSide).length,
      draws: rows.filter((r) => r.winner === -1).length,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = runModePairs({ seeds: [13, 42, 7919, 2026] });
  if (process.argv.includes('--write'))
    writeFileSync(
      new URL('../docs/productization/reports/mode-pairs.json', import.meta.url),
      JSON.stringify(report, null, 2) + '\n',
    );
  console.log(JSON.stringify(report.summary));
}
