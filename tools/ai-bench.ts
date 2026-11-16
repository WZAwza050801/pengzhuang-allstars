/** Practice-bot sanity: think time and strength vs. a random shooter. `npx tsx tools/ai-bench.ts` */
import { DEFAULT_DATA } from '../shared/data';
import { chooseShot, type AiLevel } from '../shared/ai';
import { beginTurn, createMatch, resolveShot, type ShotInput } from '../shared/match';
import { makeRng } from '../shared/rng';

const data = DEFAULT_DATA;
const lineup = data.rules.defaultLineup;

function play(a: AiLevel | 'random', b: AiLevel | 'random', seed: number) {
  const st = createMatch(data, [lineup, lineup], { seed });
  beginTurn(st, data);
  const rng = makeRng(seed * 3);
  let think = 0, thinkN = 0, maxThink = 0;
  while (!st.over) {
    const who = st.turn === 0 ? a : b;
    let input: ShotInput | null;
    if (who === 'random') {
      const mine = st.pieces.filter((p) => p.side === st.turn && p.out === 0 && p.frozen === 0);
      const p = mine[Math.floor(rng.next() * mine.length)];
      const ang = Math.atan2(st.ball.y - p.y, st.ball.x - p.x) + (rng.next() - 0.5) * 0.8;
      input = { pieceId: p.id, dirX: Math.cos(ang), dirY: Math.sin(ang), power: 0.3 + rng.next() * 0.7, curve: 0 };
    } else {
      const t0 = performance.now();
      input = chooseShot(st, data, who, seed + st.shotNo);
      const dt = performance.now() - t0;
      think += dt; thinkN++; maxThink = Math.max(maxThink, dt);
    }
    resolveShot(st, data, input!);
  }
  return { score: st.score, winner: st.winner, shots: st.shotNo, avgThink: thinkN ? think / thinkN : 0, maxThink };
}

for (const [a, b, n] of [['normal', 'random', 6], ['easy', 'random', 6], ['hard', 'normal', 4]] as const) {
  let wa = 0, wb = 0, d = 0, think = 0, maxT = 0, goals = [0, 0], shots = 0;
  for (let i = 0; i < n; i++) {
    const r = play(a, b, 100 + i);
    if (r.winner === 0) wa++; else if (r.winner === 1) wb++; else d++;
    think += r.avgThink / n; maxT = Math.max(maxT, r.maxThink);
    goals[0] += r.score[0]; goals[1] += r.score[1]; shots += r.shots;
  }
  console.log(`${a} vs ${b}: ${wa}-${d}-${wb} (W-D-L), goals ${goals[0]}:${goals[1]}, avg shots/match ${(shots / n).toFixed(1)}, think avg ${think.toFixed(0)} ms, max ${maxT.toFixed(0)} ms`);
}
