import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DEFAULT_DATA, type LevelAttrs } from '../shared/data';
import { canonicalJson } from '../packages/game-core/src/snapshot';
import rawPlayers from '../data/players.json';
import levelFile from '../data/levels.json';
const root = fileURLToPath(new URL('../', import.meta.url));
const text = z.string().min(1),
  points = z.number().int().nonnegative();
const SourceLevelSchema = z.strictObject({
  version: z.enum(['1.2.0', '1.5.5']),
  card_id: text,
  player_id: text,
  attribute_row_id: text,
  game_name: text,
  level: z.number().int().min(1).max(10),
  weight: points,
  power: points,
  mind: points,
  radian: points,
  precision: points,
  card_record_present: z.boolean(),
});
const sourceBytes = readFileSync(path.join(root, levelFile.meta.source));
const source = z.array(SourceLevelSchema).parse(JSON.parse(sourceBytes.toString('utf8')));
const hash = createHash('sha256').update(sourceBytes).digest('hex');
if (hash !== levelFile.meta.sourceSha256 || source.length !== levelFile.meta.rows)
  throw new Error('Level source receipt mismatch');
const fields = ['weight', 'power', 'mind', 'radian', 'precision'] as const;
const seen = new Set<string>(),
  seenRuntime = new Set<string>(),
  seenOther = new Set<string>();
let minimum = Infinity,
  maximum = -Infinity;
for (const record of source) {
  const key = `${record.version}|${record.card_id}|${record.level}`;
  if (seen.has(key) || record.attribute_row_id !== record.card_id + String(record.level).padStart(2, '0'))
    throw new Error(`Duplicate/invalid source row ${key}`);
  seen.add(key);
  const selected = record.version === '1.5.5' && record.card_id === record.player_id;
  let target: LevelAttrs | undefined;
  if (selected) {
    target = DEFAULT_DATA.levels[record.player_id]?.[String(record.level)];
    seenRuntime.add(`${record.player_id}|${record.level}`);
  } else {
    const other = (
      levelFile.others as Record<
        string,
        {
          player_id: string;
          game_name: string;
          card_record_present: boolean;
          levels: Record<string, LevelAttrs>;
        }
      >
    )[`${record.version}|${record.card_id}`];
    if (
      !other ||
      other.player_id !== record.player_id ||
      other.game_name !== record.game_name ||
      other.card_record_present !== record.card_record_present
    )
      throw new Error(`Source metadata mismatch ${key}`);
    target = other.levels[String(record.level)];
    seenOther.add(`${record.version}|${record.card_id}|${record.level}`);
  }
  for (const name of fields) {
    if (!target || target[name] !== record[name]) throw new Error(`Source attribute mismatch ${key}/${name}`);
    minimum = Math.min(minimum, record[name]);
    maximum = Math.max(maximum, record[name]);
    if (record[name] < DEFAULT_DATA.mapping.attrMin || record[name] > DEFAULT_DATA.mapping.attrMax)
      throw new Error(`Source value outside active domain ${key}/${name}`);
  }
}
const runtimeRows = Object.entries(DEFAULT_DATA.levels).flatMap(([id, rows]) =>
  Object.keys(rows).map((level) => `${id}|${level}`),
);
const others = Object.entries(levelFile.others).flatMap(([id, table]) =>
  Object.keys(table.levels).map((level) => `${id}|${level}`),
);
if (runtimeRows.some((key) => !seenRuntime.has(key)) || others.some((key) => !seenOther.has(key)))
  throw new Error('Imported rows without original source');
if (minimum !== levelFile.meta.valueRange.min || maximum !== levelFile.meta.valueRange.max)
  throw new Error('Level range receipt mismatch');
const provenance = JSON.parse(readFileSync(path.join(root, 'docs/roster-provenance.json'), 'utf8')) as {
  levelTableFields: string[];
  players: Record<string, { srcId: string; levels155: number[][]; runtimeValuesFrom: string }>;
};
if (canonicalJson(provenance.levelTableFields) !== canonicalJson(fields))
  throw new Error('Provenance field-order mismatch');
const playerSources = rawPlayers.players.map((player) => {
  if (player.srcId) {
    const receipt = provenance.players[player.id];
    if (!receipt || receipt.srcId !== player.srcId) throw new Error(`Missing player source receipt ${player.id}`);
    for (let level = 1; level <= 10; level++)
      if (
        canonicalJson(fields.map((name) => DEFAULT_DATA.levels[player.srcId!][String(level)][name])) !==
        canonicalJson(receipt.levels155[level - 1])
      )
        throw new Error(`Player provenance mismatch ${player.id}/${level}`);
    return {
      id: player.id,
      source: 'R' as const,
      srcId: player.srcId,
      evidence: `data/levels.json.players.${player.srcId};docs/roster-provenance.json.players.${player.id}`,
      runtime: 'exact-level-table',
    };
  }
  return {
    id: player.id,
    source: 'B' as const,
    srcId: null,
    evidence: `data/players.json.players.${player.id};nameSource=${player.nameSource}`,
    runtime: 'attrs-plus-growth',
  };
});
const summary = {
  schemaVersion: 1,
  dataVersion: DEFAULT_DATA.version,
  sourceSha256: hash,
  sourceRows: source.length,
  runtimeRows: runtimeRows.length,
  referenceOnlyRows: others.length,
  runtimePlayers: playerSources.length,
  sourcePlayers: playerSources.filter((p) => p.source === 'R').length,
  rebuiltPlayers: playerSources.filter((p) => p.source === 'B').length,
  implementedSkills: Object.keys(DEFAULT_DATA.skills).length,
  explicitUnimplementedPlayers: rawPlayers.players.filter((p) => p.skill === 'unimplemented').length,
  explicitNoSkillPlayers: rawPlayers.players.filter((p) => p.skill === 'none').length,
  attributeDomain: { min: minimum, max: maximum },
  legacyMetadata: {
    playersMapping: { min: rawPlayers.mapping.attrMin, max: rawPlayers.mapping.attrMax },
    active: false,
    note: 'Legacy attrs/growth and players.mapping remain preserved; source-linked players use exact levels and active attr-mapping.json.',
  },
  playerSources,
};
const output = JSON.stringify(summary, null, 2) + '\n',
  target = path.join(root, 'docs/productization/reports/balance-data.json');
if (process.argv.includes('--write')) writeFileSync(target, output);
else if (!existsSync(target) || readFileSync(target, 'utf8') !== output)
  throw new Error('Balance data report stale; review then run npm run balance:data');
console.log(
  `Balance data verified: ${summary.runtimePlayers} players (${summary.sourcePlayers} source/${summary.rebuiltPlayers} rebuilt), ${source.length} exact source rows, domain ${minimum}..${maximum}, ${summary.explicitUnimplementedPlayers} explicit unsupported skills`,
);
