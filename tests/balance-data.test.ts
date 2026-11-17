import { expect, test } from 'vitest';
import { GameDefinitionsSchema } from '@pengzhuang/contracts';
import fields from '../data/fields.json';
import physics from '../data/physics.json';
import players from '../data/players.json';
import skills from '../data/skills.json';
import rules from '../data/rules.json';
import mapping from '../data/attr-mapping.json';
import { version, players as table } from '../data/levels.json';
import { DEFAULT_DATA, buildGameData } from '../shared/data';
const input = {
  geometry: fields.geometry,
  physics,
  players,
  skills,
  rules,
  mapping,
  levels: { version, players: table },
};
test('all runtime definitions validate without filling missing data; source and rebuilt values remain unchanged', () => {
  const d = GameDefinitionsSchema.parse(input);
  expect(d.players.players).toHaveLength(117);
  expect(Object.keys(d.levels.players)).toHaveLength(106);
  expect(d.levels.players['10101']['1'].weight).toBe(34);
  expect(d.mapping.attrMin).toBe(21);
  expect(DEFAULT_DATA.levels).toEqual(table);
  expect(d.players.players.filter((p) => p.srcId === null)).toHaveLength(11);
  expect(() => buildGameData({ ...physics, hz: NaN })).toThrow();
});
test('broken references, missing levels, non-finite values, invalid probabilities and unsupported trigger/effect combinations fail', () => {
  const cases: ((d: typeof input) => void)[] = [
    (d) => {
      d.players.players[0].skill = 'typo';
    },
    (d) => {
      d.players.players[1].id = d.players.players[0].id;
    },
    (d) => {
      d.players.players[0].srcId = 'missing';
    },
    (d) => {
      delete (d.levels.players['10101'] as Partial<(typeof table)['10101']>)['5'];
    },
    (d) => {
      d.levels.players['10101']['1'].weight = NaN;
    },
    (d) => {
      d.levels.players['10101']['1'].power = 120;
    },
    (d) => {
      d.skills.skills[0].probability[0] = 1.1;
    },
    (d) => {
      d.skills.skills[0].trigger = 'passive';
    },
    (d) => {
      d.rules.defaultLineup[0] = 'missing';
    },
    (d) => {
      d.rules.levels.skillLevelAt = [1, 7, 4];
    },
    (d) => {
      d.mapping.attrMax = d.mapping.attrMin;
    },
    (d) => {
      d.players.players[5].growth[0] = -1000;
    },
  ];
  for (const change of cases) {
    const broken = structuredClone(input);
    change(broken);
    expect(GameDefinitionsSchema.safeParse(broken).success).toBe(false);
  }
});
