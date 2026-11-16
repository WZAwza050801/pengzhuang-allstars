/**
 * T4-a level-table importer. Rewrites data/levels.json (levels-1) from the recovered level_records.json
 * (2250 rows = 1.2.0 880 + 1.5.5 1370). Attribute names and values are kept exactly as in the source.
 *   players: player_id -> level -> points, from the 1.5.5 base card (card_id = player_id). The runtime reads only this.
 *   others:  every remaining row, keyed "version|card_id", so the 1.2.0 and 1.5.5 rows of a card never overwrite each other.
 * Output is deterministic (no timestamps).
 *
 *   npx tsx tools/import-levels.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

type Row = Record<string, any>;
type Points = Record<string, number>;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_REL = 'materials/pengzhuang_rebuild/02_players_and_data/level_records.json';
const OUT_REL = 'data/levels.json';
const FIELDS = ['weight', 'power', 'mind', 'radian', 'precision'];
const VERSIONS = ['1.2.0', '1.5.5'];
const RUNTIME_VERSION = '1.5.5';
const LEVELS = 10;

const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const fail = (msg: string): never => {
  throw new Error(msg);
};

const srcBuf = fs.readFileSync(path.join(ROOT, SRC_REL));
const rows: Row[] = JSON.parse(srcBuf.toString('utf8'));
const roster = readJson('data/players.json');
const attrMap = readJson('data/attr-mapping.json');
const rules = readJson('data/rules.json');
if (rules.levels.max !== LEVELS) fail(`rules.levels.max is ${rules.levels.max}, the source table has ${LEVELS} levels`);

// ---- every row
if (!Array.isArray(rows) || rows.length !== 2250) fail(`expected 2250 rows, got ${rows.length}`);
const seen = new Set<string>();
let lo = Infinity;
let hi = -Infinity;
for (const r of rows) {
  const where = `${r.version}|${r.card_id}|Lv${r.level}`;
  if (!VERSIONS.includes(r.version)) fail(`${where}: unknown version`);
  if (!Number.isInteger(r.level) || r.level < 1 || r.level > LEVELS) fail(`${where}: level outside 1..${LEVELS}`);
  if (r.attribute_row_id !== `${r.card_id}${String(r.level).padStart(2, '0')}`) fail(`${where}: attribute_row_id ${r.attribute_row_id}`);
  if (seen.has(where)) fail(`${where}: duplicate row`);
  seen.add(where);
  for (const f of FIELDS) {
    if (!Number.isInteger(r[f])) fail(`${where}: ${f} is not an integer`);
    lo = Math.min(lo, r[f]);
    hi = Math.max(hi, r[f]);
  }
  if (r.version === RUNTIME_VERSION && r.card_record_present !== true) fail(`${where}: 1.5.5 row without a card record`);
}
// attr-mapping.json documents its domain as the measured range of this table; keep that claim true.
if (lo !== attrMap.attrMin || hi !== attrMap.attrMax) fail(`measured range ${lo}..${hi} != attr-mapping ${attrMap.attrMin}..${attrMap.attrMax}`);

// ---- one series per version|card_id, exactly levels 1..10
const series = new Map<string, Row[]>();
for (const r of rows) {
  const k = `${r.version}|${r.card_id}`;
  if (!series.has(k)) series.set(k, []);
  series.get(k)!.push(r);
}
const points = (r: Row): Points => Object.fromEntries(FIELDS.map((f) => [f, r[f]]));
const byLevel = (key: string, rs: Row[]): Record<string, Points> => {
  const sorted = rs.slice().sort((a, b) => a.level - b.level);
  if (sorted.length !== LEVELS || sorted.some((r, i) => r.level !== i + 1)) fail(`${key}: levels are not exactly 1..${LEVELS}`);
  for (const f of ['player_id', 'game_name', 'card_record_present']) {
    if (sorted.some((r) => r[f] !== sorted[0][f])) fail(`${key}: ${f} changes between levels`);
  }
  return Object.fromEntries(sorted.map((r) => [String(r.level), points(r)]));
};
const num = (a: string, b: string) => Number(a) - Number(b);
const keyOrder = (a: string, b: string) => {
  const [va, ca] = a.split('|');
  const [vb, cb] = b.split('|');
  return VERSIONS.indexOf(va) - VERSIONS.indexOf(vb) || num(ca, cb);
};

const players: Record<string, Record<string, Points>> = {};
const others: Record<string, { player_id: string; game_name: string; card_record_present: boolean; levels: Record<string, Points> }> = {};
for (const key of [...series.keys()].sort(keyOrder)) {
  const rs = series.get(key)!;
  const levels = byLevel(key, rs);
  const r0 = rs[0];
  if (r0.version === RUNTIME_VERSION && r0.card_id === r0.player_id) {
    if (players[r0.player_id]) fail(`${r0.player_id}: two 1.5.5 base cards`);
    players[r0.player_id] = levels;
  } else {
    others[key] = { player_id: r0.player_id, game_name: r0.game_name, card_record_present: r0.card_record_present, levels };
  }
}
const playerIds = Object.keys(players).sort(num);
const otherKeys = Object.keys(others).sort(keyOrder);

// ---- roster: every srcId must be in the runtime table
const rosterSrc = roster.players.filter((p: Row) => p.srcId != null);
const rosterRebuilt = roster.players.filter((p: Row) => p.srcId == null).map((p: Row) => p.id);
for (const p of rosterSrc) if (!players[String(p.srcId)]) fail(`${p.id}: srcId ${p.srcId} has no 1.5.5 base card`);
const unlinked = playerIds.filter((id) => !rosterSrc.some((p: Row) => String(p.srcId) === id));

// ---- the same card and level in both versions: record differences, overwrite nothing
const byCard: Record<string, { levels: number[]; fields: string[] }> = {};
let pairsInBoth = 0;
let pairsDiffer = 0;
const rowAt = new Map(rows.map((r) => [`${r.version}|${r.card_id}|${r.level}`, r]));
for (const r of rows) {
  if (r.version !== '1.2.0') continue;
  const other = rowAt.get(`1.5.5|${r.card_id}|${r.level}`);
  if (!other) continue;
  pairsInBoth++;
  const diff = FIELDS.filter((f) => r[f] !== other[f]);
  if (!diff.length) continue;
  pairsDiffer++;
  const e = (byCard[r.card_id] ??= { levels: [], fields: [] });
  e.levels.push(r.level);
  for (const f of diff) if (!e.fields.includes(f)) e.fields.push(f);
}
for (const e of Object.values(byCard)) {
  e.levels.sort((a, b) => a - b);
  e.fields.sort((a, b) => FIELDS.indexOf(a) - FIELDS.indexOf(b));
}

const rowsByVersion = Object.fromEntries(VERSIONS.map((v) => [v, rows.filter((r) => r.version === v).length]));
const playerRows = playerIds.length * LEVELS;
const otherRows = otherKeys.length * LEVELS;
const others120 = otherKeys.filter((k) => k.startsWith('1.2.0|')).length;
const variants155 = otherKeys.filter((k) => k.startsWith('1.5.5|')).length;
if (playerRows + otherRows !== rows.length) fail(`players ${playerRows} + others ${otherRows} != ${rows.length}`);

const meta = {
  generatedBy: 'tools/import-levels.ts',
  source: SRC_REL,
  sourceSha256: createHash('sha256').update(srcBuf).digest('hex'),
  rows: rows.length,
  rowsByVersion,
  attributes: FIELDS,
  units:
    '属性点原值，字段名与数值和源表一致。weight 不是 kg，power 不是 N，radian 不是角度也不是弧度，precision 不是命中率；' +
    '属性点 → 物理倍率见 data/attr-mapping.json。',
  selection: {
    players:
      `运行时数据：player_id → 等级（1–${LEVELS}）→ 属性点，取 ${RUNTIME_VERSION} 版 card_id = player_id 的基础卡` +
      `（${playerIds.length} 人 × ${LEVELS} 级 = ${playerRows} 行）。data/players.json 的 srcId 指向这里的 player_id；` +
      `srcId 为 null 的 rebuilt 球员（${rosterRebuilt.length} 人）不在表内，仍按 attrs + growth 推算。`,
    others:
      `其余 ${otherRows} 行原样保留、互不覆盖，key = version|card_id：1.2.0 版 ${others120 * LEVELS} 行（${others120} 张卡）` +
      ` + 1.5.5 变体卡 ${variants155 * LEVELS} 行（${variants155} 张，card_id ≠ player_id，留给 T4-b）。运行时不读取。`,
  },
  attributeRowId: 'attribute_row_id = card_id + 两位等级，导入时逐行断言，不另存。',
  valueRange: { min: lo, max: hi },
  versionDiffs: {
    note: '同一 card_id 同一等级两版本都有时按 version 分开存：1.5.5 基础卡在 players，1.2.0 在 others。下面只列数值不同的卡、等级与字段。',
    pairsInBoth,
    pairsDiffer,
    byCard,
  },
  cardRecordMissing: otherKeys.filter((k) => others[k].card_record_present === false),
};

// ---- write: one line per level, keys sorted, no timestamps
const lvLines = (levels: Record<string, Points>, pad: string) =>
  Object.keys(levels)
    .sort(num)
    .map((l) => `${pad}${JSON.stringify(l)}: ${JSON.stringify(levels[l])}`)
    .join(',\n');
const otherHead = (k: string) => {
  const { player_id, game_name, card_record_present } = others[k];
  return JSON.stringify({ player_id, game_name, card_record_present }).slice(0, -1);
};
const text =
  '{\n' +
  '  "version": "levels-1",\n' +
  `  "meta": ${JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ')},\n` +
  '  "players": {\n' +
  playerIds.map((id) => `    ${JSON.stringify(id)}: {\n${lvLines(players[id], '      ')}\n    }`).join(',\n') +
  '\n  },\n' +
  '  "others": {\n' +
  otherKeys.map((k) => `    ${JSON.stringify(k)}: ${otherHead(k)}, "levels": {\n${lvLines(others[k].levels, '      ')}\n    }}`).join(',\n') +
  '\n  }\n' +
  '}\n';

// round-trip: what lands on disk must equal what was built
const back = JSON.parse(text);
if (JSON.stringify(back.players) !== JSON.stringify(Object.fromEntries(playerIds.map((id) => [id, players[id]])))) fail('players round-trip mismatch');
if (JSON.stringify(back.others) !== JSON.stringify(Object.fromEntries(otherKeys.map((k) => [k, others[k]])))) fail('others round-trip mismatch');
fs.writeFileSync(path.join(ROOT, OUT_REL), text);

console.log(
  JSON.stringify(
    {
      out: OUT_REL,
      bytes: Buffer.byteLength(text),
      rows: rows.length,
      rowsByVersion,
      players: playerIds.length,
      playerRows,
      others: otherKeys.length,
      otherRows,
      others120,
      variants155,
      valueRange: meta.valueRange,
      versionDiffs: { pairsInBoth, pairsDiffer, cards: Object.keys(byCard) },
      cardRecordMissing: meta.cardRecordMissing,
      rosterFromTable: rosterSrc.length,
      rosterRebuilt,
      tablePlayersNotInRoster: unlinked,
    },
    null,
    1,
  ),
);
