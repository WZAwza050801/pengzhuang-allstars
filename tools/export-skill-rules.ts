import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_DATA, buildGameData } from '../shared/data';
import source from '../data/skills.json';
import { beginTurn, createMatch } from '../shared/match';
import { SKILL_EFFECT_POLICIES, SKILL_TIMING_VERSION } from '../packages/game-core/src/skill-policy';
const experimentData = buildGameData();
for (const player of Object.values(experimentData.players)) {
  player.skill = 'none';
  player.srcSkill = null;
}
experimentData.players.p01.skill = 'alien';
const experiment = createMatch(
  experimentData,
  [
    ['p01', 'p02', 'p03', 'p04', 'p05'],
    ['p17', 'p18', 'p19', 'p20', 'p21'],
  ],
  {
    seed: 42,
    firstSide: 0,
    levels: [
      [10, 10, 10, 10, 10],
      [10, 10, 10, 10, 10],
    ],
  },
);
const samples = 10000;
let triggered = 0;
for (let i = 0; i < samples; i++) {
  beginTurn(experiment, experimentData);
  if (experiment.pieces[0].ready) triggered++;
}
const rate = triggered / samples,
  z = 1.96,
  denominator = 1 + (z * z) / samples;
const center = (rate + (z * z) / (2 * samples)) / denominator;
const halfWidth = (z * Math.sqrt((rate * (1 - rate)) / samples + (z * z) / (4 * samples * samples))) / denominator;
const report = {
  schemaVersion: 1,
  semanticVersion: SKILL_TIMING_VERSION,
  dataVersion: DEFAULT_DATA.version,
  lifecycle: {
    preturn: 'beginTurn at a new action; never on reconnect',
    preview: 'rng=null; never rolls onShot',
    counters: 'end of owner full turn; not after first extra action',
    goal: 'reset all statuses; conceding side kickoff; no extra action',
    end: 'no new skills, passes, resolution or result overwrite',
    reconnect: 'restore RNG and status flags; do not call beginTurn',
  },
  effects: SKILL_EFFECT_POLICIES,
  probabilityExperiment: {
    fixture: 'only p01 alien enabled; current unmodified probabilities',
    seed: 42,
    cardLevel: 10,
    samples,
    triggered,
    expected: experimentData.skills.alien.probability[2],
    observed: rate,
    wilson95: [center - halfWidth, center + halfWidth],
    declaredTestTolerance: 0.02,
  },
  skills: source.skills.map((s) => ({
    id: s.id,
    trigger: s.trigger,
    effect: s.effect,
    probability: s.probability,
    durationTurns: s.durationTurns,
    unlockLevel: s.unlockLevel,
    nameSource: s.nameSource,
    effectSource: s.effectSource,
    policy: SKILL_EFFECT_POLICIES[s.effect.type as keyof typeof SKILL_EFFECT_POLICIES],
  })),
  unsupportedSourcePlayers: Object.values(DEFAULT_DATA.players)
    .filter((p) => p.skill === 'unimplemented')
    .map((p) => p.id),
};
const target = new URL('../docs/productization/reports/skill-rules.json', import.meta.url),
  output = JSON.stringify(report, null, 2) + '\n';
if (process.argv.includes('--write')) writeFileSync(target, output);
else if (!existsSync(target) || readFileSync(target, 'utf8') !== output)
  throw new Error('Skill rules report differs; review semantics and regenerate');
console.log(
  `Skill rules verified: ${report.skills.length} definitions, ${Object.keys(report.effects).length} effects; ${report.unsupportedSourcePlayers.length} source-only players remain explicit`,
);
