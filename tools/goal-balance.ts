/**
 * Shots-per-goal in bot-vs-bot play for the current data and optional goal-width variants.
 *   npx tsx tools/goal-balance.ts [matches=8] [extraGoalWidth...]
 */
import { buildGameData, type GameData } from '../shared/data';
import { chooseShot } from '../shared/ai';
import { beginTurn, createMatch, resolveShot } from '../shared/match';

const [matchesArg, ...widths] = process.argv.slice(2).map(Number);
const MATCHES = matchesArg || 8;

function variant(goalWidth: number): GameData {
  const d = buildGameData();
  d.geometry = { ...d.geometry, goalWidth };
  return d;
}

const base = buildGameData();
const variants: [string, GameData][] = [
  [`当前数据（门宽 ${base.geometry.goalWidth} m）`, base],
  ...widths.map((w): [string, GameData] => [`门宽 ${w} m`, variant(w)]),
];

for (const [name, data] of variants) {
  let shots = 0, goals = 0, kickoffGoals = 0;
  for (let m = 0; m < MATCHES; m++) {
    const st = createMatch(data, [data.rules.defaultLineup, data.rules.defaultLineup], { seed: 500 + m });
    beginTurn(st, data);
    let afterKick = true;
    while (!st.over) {
      const input = chooseShot(st, data, 'normal', 900 + st.shotNo + m * 100)!;
      const out = resolveShot(st, data, input);
      shots++;
      const g = out.events.some((e) => e.type === 'goal');
      if (g) { goals++; if (afterKick) kickoffGoals++; }
      afterKick = g;
    }
  }
  console.log(`${name}: ${MATCHES} 场 ${shots} 手 ${goals} 球 → 平均 ${(shots / Math.max(1, goals)).toFixed(1)} 手进一球；开球后第一手直接进球 ${kickoffGoals} 次`);
}
