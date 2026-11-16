/**
 * T4-b card importer. Rewrites data/cards.json (cards-1) from the recovered card_records.json
 * (224 rows = 1.2.0 87 + 1.5.5 137; 闪卡 31 of them, all 1.5.5). Every source field keeps its name, type and value.
 *   cards:     keyed "version|card_id" (the source key), so the 1.2.0 and 1.5.5 records of a card both stay.
 *   byPlayer:  roster id (data/players.json) -> its cards, matched by srcId = player_id. No card is made up.
 *   conflicts: the 20 card-table vs level-table Lv1 differences of parameter_conflicts.json, recomputed here and kept
 *              verbatim, plus the D5 replica choice (1.5.5 level-table Lv1: a replica strategy, not the original priority).
 *   nameDiffs: cards whose game_name differs between the card table and the level table; both names kept, none renamed.
 *   pending:   what the materials leave open (1.2.0|90001, 40109, 80206); recorded, nothing filled in.
 * The runtime does not read this file yet. Output is deterministic (no timestamps).
 *
 *   npx tsx tools/import-cards.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

type Row = Record<string, any>;
type Points = Record<string, number>;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAT = 'materials/pengzhuang_rebuild/02_players_and_data';
const OUT_REL = 'data/cards.json';
const LEVELS_REL = 'data/levels.json';
const ROSTER_REL = 'data/players.json';
const FIELDS = ['weight', 'power', 'mind', 'radian', 'precision'];
const VERSIONS = ['1.2.0', '1.5.5'];
const RUNTIME_VERSION = '1.5.5';
const LEVELS = 10;
const BASE = '普通卡';
const FLASH = '闪卡';
// the 21 source fields in source order, with their source types; the output keeps both
const SRC_FIELDS: [string, 'string' | 'number'][] = [
  ['version', 'string'], ['key', 'string'], ['card_id', 'string'], ['player_id', 'string'], ['game_name', 'string'],
  ['real_name', 'string'], ['variant', 'string'], ['rarity', 'number'], ['position', 'string'], ['weight', 'number'],
  ['power', 'number'], ['mind', 'number'], ['radian', 'number'], ['precision', 'number'], ['skills', 'string'],
  ['unlocks', 'string'], ['foil', 'string'], ['normal', 'string'], ['flash_skills', 'string'], ['icon', 'string'],
  ['source_line', 'number'],
];
const POLICY =
  'D5：card 表基础值与等级表 Lv1 不同时，复刻取 1.5.5 等级表 Lv1 值（运行时属性本来就读 data/levels.json）；' +
  'card 表的值原样留在 cards[key] 和 conflicts[].card_values。这是复刻策略，不是原版优先级：原版运行时取哪一组未知（issues.json DATA-01）。';

const sources: Record<string, string> = {};
const readSrc = (name: string): any => {
  const rel = `${MAT}/${name}`;
  const buf = fs.readFileSync(path.join(ROOT, rel));
  sources[rel] = createHash('sha256').update(buf).digest('hex');
  return JSON.parse(buf.toString('utf8'));
};
const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const fail = (msg: string): never => {
  throw new Error(msg);
};
const list = (s: string) => (s === '' ? [] : s.split(';'));
const points = (r: Row): Points => Object.fromEntries(FIELDS.map((f) => [f, r[f]]));
const same = (a: Points, b: Points) =>
  Object.keys(a).sort().join() === [...FIELDS].sort().join() && FIELDS.every((f) => a[f] === b[f]);

const rows: Row[] = readSrc('card_records.json');
const listed: Row[] = readSrc('parameter_conflicts.json');
const levelRows: Row[] = readSrc('level_records.json');
const links: Row[] = readSrc('skill_links.json');
const skillRows: Row[] = readSrc('skill_records.json');
const issues: Row[] = readSrc('issues.json');
const catalog: Row[] = readSrc('catalog.json');
const levels = readJson(LEVELS_REL);
const roster = readJson(ROSTER_REL);

// ---- every row: exactly the 21 source fields, in source order, with the source types
if (!Array.isArray(rows) || rows.length !== 224) fail(`expected 224 rows, got ${rows.length}`);
const byKey = new Map<string, Row>();
for (const r of rows) {
  const where = String(r.key);
  if (Object.keys(r).join() !== SRC_FIELDS.map(([f]) => f).join()) fail(`${where}: fields are ${Object.keys(r).join()}`);
  for (const [f, t] of SRC_FIELDS) if (typeof r[f] !== t) fail(`${where}: ${f} is not a ${t}`);
  if (!VERSIONS.includes(r.version)) fail(`${where}: unknown version`);
  if (r.key !== `${r.version}|${r.card_id}`) fail(`${where}: key is not version|card_id`);
  if (byKey.has(r.key)) fail(`${where}: duplicate key`);
  byKey.set(r.key, r);
  if (r.variant !== BASE && !(r.variant === FLASH && r.version === RUNTIME_VERSION)) fail(`${where}: variant ${r.variant}`);
  if ((r.variant === BASE) !== (r.card_id === r.player_id)) fail(`${where}: ${r.variant} with player_id ${r.player_id}`);
  for (const f of FIELDS) if (!Number.isInteger(r[f])) fail(`${where}: ${f} is not an integer`);
  const skills = list(r.skills);
  const unlocks = list(r.unlocks);
  if (skills.length !== unlocks.length) fail(`${where}: ${skills.length} skills, ${unlocks.length} unlocks`);
  if (new Set(skills).size !== skills.length) fail(`${where}: a skill is listed twice`);
  for (const id of [...skills, ...unlocks, ...list(r.flash_skills)]) if (!/^\d+$/.test(id)) fail(`${where}: list item "${id}"`);
  if (unlocks.some((u) => Number(u) < 1 || Number(u) > LEVELS)) fail(`${where}: unlock level outside 1..${LEVELS}`);
  if ((r.variant === FLASH) !== (r.flash_skills !== '')) fail(`${where}: flash_skills on a ${r.variant}`);
}
const tally = (rs: Row[], f: (r: Row) => string) =>
  rs.reduce<Record<string, number>>((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});
const rowsByVersion = tally(rows, (r) => r.version);
const rowsByVariant = tally(rows, (r) => `${r.version}|${r.variant}`);
if (rowsByVersion['1.2.0'] !== 87 || rowsByVersion['1.5.5'] !== 137) fail(`rows by version ${JSON.stringify(rowsByVersion)}`);

// ---- flash cards: normal -> the base card and foil -> the flash card must point at each other
for (const r of rows) {
  if (r.variant === FLASH) {
    const base = byKey.get(`${r.version}|${r.normal}`);
    if (!base || base.variant !== BASE || base.foil !== r.card_id || base.player_id !== r.player_id) fail(`${r.key}: normal ${r.normal} does not point back`);
    if (r.foil !== '') fail(`${r.key}: flash card with a foil`);
  } else {
    if (r.normal !== '') fail(`${r.key}: base card with a normal`);
    const flash = r.foil === '' ? null : byKey.get(`${r.version}|${r.foil}`);
    if (r.foil !== '' && (!flash || flash.variant !== FLASH || flash.normal !== r.card_id)) fail(`${r.key}: foil ${r.foil} does not point back`);
  }
}

// ---- roster: player_id = srcId; every linked player has exactly its own 1.5.5 base card
const rosterIdBySrc = new Map<string, string>();
const rosterRebuilt: string[] = [];
for (const p of roster.players) {
  if (p.srcId == null) rosterRebuilt.push(p.id);
  else if (rosterIdBySrc.has(String(p.srcId))) fail(`srcId ${p.srcId} twice in the roster`);
  else rosterIdBySrc.set(String(p.srcId), p.id);
}
for (const r of rows) if (!rosterIdBySrc.has(r.player_id)) fail(`${r.key}: player_id ${r.player_id} is not a roster srcId`);
const byPlayer: Record<string, { srcId: string; cards: string[] }> = {};
for (const [srcId, id] of rosterIdBySrc) {
  const cards = rows.filter((r) => r.player_id === srcId);
  const base = cards.filter((r) => r.version === RUNTIME_VERSION && r.variant === BASE);
  if (base.length !== 1 || base[0].card_id !== srcId) fail(`${id}: ${base.length} 1.5.5 base cards for srcId ${srcId}`);
  if (cards.filter((r) => r.version === '1.2.0').length > 1) fail(`${id}: more than one 1.2.0 card`);
  byPlayer[id] = { srcId, cards: cards.map((r) => r.key) };
}
const playerCards = Object.values(byPlayer);
const playersWith = {
  both: playerCards.filter((p) => p.cards.some((k) => k.startsWith('1.2.0|')) && p.cards.some((k) => k.startsWith('1.5.5|'))).length,
  only155: playerCards.filter((p) => p.cards.every((k) => k.startsWith('1.5.5|'))).length,
  flash: playerCards.filter((p) => p.cards.some((k) => byKey.get(k)!.variant === FLASH)).length,
};

// ---- data/levels.json holds the 10 levels of every card, equal to level_records
const levelAt = new Map(levelRows.map((r) => [`${r.version}|${r.card_id}|${r.level}`, r]));
const levelsRef = (r: Row) =>
  r.version === RUNTIME_VERSION && r.variant === BASE ? { segment: 'players', key: r.card_id } : { segment: 'others', key: r.key };
const LEVEL_KEYS = Array.from({ length: LEVELS }, (_, i) => String(i + 1)).join();
let levelCells = 0;
// the level table names some cards differently from the card table; both names stay as they are
const nameDiffs: Row[] = [];
for (const r of rows) {
  const ref = levelsRef(r);
  const entry = levels[ref.segment][ref.key] ?? fail(`${r.key}: no ${LEVELS_REL} ${ref.segment}/${ref.key}`);
  const byLv = ref.segment === 'players' ? entry : entry.levels;
  const src = Array.from({ length: LEVELS }, (_, i) => levelAt.get(`${r.key}|${i + 1}`) ?? fail(`${r.key}: no level_records row for Lv${i + 1}`));
  const levelName = src[0].game_name;
  if (src.some((s) => s.game_name !== levelName || s.player_id !== r.player_id || s.card_record_present !== true)) fail(`${r.key}: level_records rows disagree on the card`);
  if (ref.segment === 'others' && (entry.player_id !== r.player_id || entry.game_name !== levelName || entry.card_record_present !== true))
    fail(`${r.key}: ${LEVELS_REL} others entry is for ${entry.player_id} ${entry.game_name}`);
  if (levelName !== r.game_name) nameDiffs.push({ key: r.key, real_name: r.real_name, card_game_name: r.game_name, level_game_name: levelName });
  if (Object.keys(byLv).join() !== LEVEL_KEYS) fail(`${r.key}: levels are not exactly 1..${LEVELS}`);
  src.forEach((s, i) => {
    if (!same(byLv[i + 1], points(s))) fail(`${r.key}: Lv${i + 1} in ${LEVELS_REL} differs from level_records`);
    levelCells++;
  });
}
const levelOnly = [...new Set(levelRows.map((r) => `${r.version}|${r.card_id}`))].filter((k) => !byKey.has(k));
if (levelOnly.join() !== '1.2.0|90001') fail(`level_records cards without a card record: ${levelOnly.join()}`);

// ---- conflicts: recompute card vs level-table Lv1 for all 224 cards; it must give exactly the listed 20
const lv1 = (r: Row) => points(levelAt.get(`${r.key}|1`)!);
const recomputed = rows.filter((r) => !same(points(r), lv1(r))).map((r) => r.key);
const listedKeys = listed.map((c) => `${c.version}|${c.card_id}`);
if (listed.length !== 20 || new Set(listedKeys).size !== 20) fail(`expected 20 distinct listed conflicts, got ${listed.length}`);
if ([...recomputed].sort().join() !== [...listedKeys].sort().join()) fail(`recomputed ${recomputed.join()} != listed ${listedKeys.join()}`);
const conflicts = listed.map((c, i) => {
  const key = listedKeys[i];
  const r = byKey.get(key) ?? fail(`${key}: conflict without a card`);
  if (c.version !== RUNTIME_VERSION) fail(`${key}: D5 is written for 1.5.5 conflicts only`);
  for (const f of ['player_id', 'game_name', 'variant']) if (c[f] !== r[f]) fail(`${key}: conflict ${f} ${c[f]} != card ${r[f]}`);
  if (!same(c.card_values, points(r))) fail(`${key}: card_values != card_records`);
  if (!same(c.level1_values, lv1(r))) fail(`${key}: level1_values != level_records Lv1`);
  if (c.fields.join() !== FIELDS.filter((f) => c.card_values[f] !== c.level1_values[f]).join()) fail(`${key}: fields ${c.fields.join()}`);
  if (typeof c.resolution !== 'string' || c.resolution === '') fail(`${key}: no resolution`);
  const ref = levelsRef(r);
  return {
    key,
    ...c,
    replica: { values: c.level1_values, from: `${LEVELS_REL} ${ref.segment}/${ref.key} Lv1`, policy: 'D5 复刻策略，不是原版优先级（见 meta.conflictPolicy）' },
  };
});
const conflictKeys = new Set(listedKeys);
const conflictCardValues = [...new Set(listed.map((c) => JSON.stringify(points(c.card_values))))];

// ---- skill_links.json must list exactly the skills / flash_skills of the cards, with the same unlock levels
const refs = new Map<string, { type: string; unlock: string }>();
for (const r of rows) {
  const unlocks = list(r.unlocks);
  list(r.skills).forEach((id, i) => refs.set(`${r.key}|${id}`, { type: '普通技能', unlock: unlocks[i] }));
  for (const id of list(r.flash_skills)) refs.set(`${r.key}|${id}`, { type: '闪卡天赋', unlock: '' });
}
const refCount = rows.reduce((n, r) => n + list(r.skills).length + list(r.flash_skills).length, 0);
const linkKey = (l: Row) => `${l.version}|${l.card_id}|${l.skill_id}`;
if (refs.size !== refCount) fail(`skill refs collide: ${refs.size} != ${refCount}`);
if (links.length !== refs.size || new Set(links.map(linkKey)).size !== links.length) fail(`skill_links ${links.length} rows, the cards list ${refs.size}`);
const flashUnlocks: Record<string, number> = {};
for (const l of links) {
  const ref = refs.get(linkKey(l)) ?? fail(`skill_links ${linkKey(l)} is not on its card`);
  if (l.type !== ref.type || l.found !== true || l.player_id !== byKey.get(`${l.version}|${l.card_id}`)!.player_id) fail(`skill_links ${linkKey(l)}: ${l.type} found=${l.found}`);
  if (ref.type === '普通技能' && String(l.unlock_level) !== ref.unlock) fail(`skill_links ${linkKey(l)}: unlock ${l.unlock_level} != card ${ref.unlock}`);
  if (ref.type === '闪卡天赋') flashUnlocks[String(l.unlock_level)] = (flashUnlocks[String(l.unlock_level)] ?? 0) + 1;
}
const skillKeys = new Set(skillRows.map((s) => `${s.version}|${s.skill_id}`));
for (const k of refs.keys()) {
  const [version, , id] = k.split('|');
  if (!skillKeys.has(`${version}|${id}`)) fail(`${k}: skill ${id} is not in the ${version} skill_records`);
}
const skillRefs = tally([...refs.entries()].map(([k, v]) => ({ k, t: v.type })), (x) => `${x.k.split('|')[0]}|${x.t}`);

// ---- pending: what the materials leave open; recorded with the issue text, nothing filled in
const issue = (id: string, mentions: string) => {
  const i = issues.find((x) => x.id === id) ?? fail(`issues.json has no ${id}`);
  if (!String(i.subject).includes(mentions)) fail(`${id} does not mention ${mentions}`);
  return { issue: id, issueSubject: i.subject, issueStatus: i.status, issueAction: i.action };
};
if (rows.some((r) => [r.card_id, r.player_id, r.foil, r.normal].includes('40109'))) fail('a card refers to 40109');
if (rosterIdBySrc.has('40109')) fail('40109 is in the roster');
const qizu = byKey.get(`${RUNTIME_VERSION}|90001`) ?? fail('no 1.5.5|90001 card');
const cards80206 = rows.filter((r) => r.player_id === '80206').map((r) => r.key);
if (!cards80206.length) fail('no 80206 card');
const pending = [
  {
    subject: '1.2.0|90001',
    status: 'pending-confirmation',
    found: `level_records 有它的 ${LEVELS} 级属性（card_record_present=false），card_records 没有这张卡`,
    handling:
      `不造卡，cards 里没有这一条；等级行原样在 ${LEVELS_REL} others/1.2.0|90001。` +
      `名册 ${rosterIdBySrc.get('90001')} ${qizu.game_name} 对应的是 ${qizu.key}`,
    ...issue('DATA-02', '90001'),
  },
  {
    subject: '40109',
    status: 'pending-confirmation',
    found: 'card_records 没有任何一行引用 40109（card_id / player_id / foil / normal 都没有）',
    handling: '不造卡，不进名册（D6），属性留空',
    ...issue('NAME-01', '40109'),
  },
  {
    subject: cards80206.join(' '),
    status: 'pending-confirmation',
    found: '卡牌存在，球员身份待确认',
    handling: '卡牌按原表收录，game_name / real_name 不替换',
    ...issue('NAME-02', '80206'),
  },
];

// ---- catalog.json card_variant_ids: cross-check only
const catalogDiffs: string[] = [];
for (const c of catalog) {
  const ours = [...new Set(rows.filter((r) => r.player_id === String(c.player_id)).map((r) => r.card_id))].sort().join(';');
  const theirs = [...(c.card_variant_ids ?? [])].map(String).sort().join(';');
  if (ours !== theirs) catalogDiffs.push(`${c.player_id}: catalog ${theirs || '-'} / cards ${ours || '-'}`);
}

// ---- the same card_id in both versions: two records, both kept; list what differs
const PAIR_FIELDS = SRC_FIELDS.map(([f]) => f).filter((f) => !['version', 'key', 'source_line'].includes(f));
const pairDiffs: Record<string, string[]> = {};
let pairs = 0;
let pairsDiffer = 0;
for (const a of rows) {
  const b = a.version === '1.2.0' ? byKey.get(`1.5.5|${a.card_id}`) : undefined;
  if (!b) continue;
  pairs++;
  const diff = PAIR_FIELDS.filter((f) => a[f] !== b[f]);
  if (diff.length) pairsDiffer++;
  for (const f of diff) (pairDiffs[f] ??= []).push(a.card_id);
}

// ---- flash card vs its base card (recorded only)
const FLASH_SAME = ['game_name', 'real_name', 'rarity', 'position', ...FIELDS, 'skills', 'unlocks', 'icon'];
const flashCards = rows.filter((r) => r.variant === FLASH);
const flashSameCard = flashCards.filter((r) => FLASH_SAME.every((f) => r[f] === byKey.get(`${r.version}|${r.normal}`)![f])).length;
const flashLevelDiffs = flashCards
  .filter(
    (r) =>
      !Array.from({ length: LEVELS }, (_, i) => i + 1).every((lv) =>
        same(points(levelAt.get(`${r.key}|${lv}`)!), points(levelAt.get(`${r.version}|${r.normal}|${lv}`)!)),
      ),
  )
  .map((r) => r.key);

// ---- output records: source fields first (verbatim), then derived fields
const cards: Record<string, Row> = {};
for (const r of rows) {
  cards[r.key] = {
    ...Object.fromEntries(SRC_FIELDS.map(([f]) => [f, r[f]])),
    playerId: rosterIdBySrc.get(r.player_id),
    skillIds: list(r.skills),
    unlockLevels: list(r.unlocks).map(Number),
    flashSkillIds: list(r.flash_skills),
    foilKey: r.foil === '' ? null : `${r.version}|${r.foil}`,
    normalKey: r.normal === '' ? null : `${r.version}|${r.normal}`,
    levelsRef: levelsRef(r),
    conflict: conflictKeys.has(r.key),
  };
}

const meta = {
  generatedBy: 'tools/import-cards.ts',
  sources,
  links: { roster: `${ROSTER_REL} (${roster.version})`, levels: `${LEVELS_REL} (${levels.version})` },
  rows: rows.length,
  rowsByVersion,
  rowsByVariant,
  fields: {
    source: `源表 ${SRC_FIELDS.length} 个字段原名、原类型、原值保留，顺序同源表：${SRC_FIELDS.map(([f]) => f).join(' / ')}`,
    derived: {
      playerId: `${ROSTER_REL} 的球员 id（srcId = player_id）`,
      skillIds: 'skills 按 ; 拆开，顺序不变',
      unlockLevels: `unlocks 按 ; 拆开转整数，与 skillIds 一一对应（卡牌等级 1–${LEVELS}）`,
      flashSkillIds: 'flash_skills 按 ; 拆开（只有闪卡有）',
      foilKey: '普通卡 foil 指向的同版本闪卡 key',
      normalKey: '闪卡 normal 指向的同版本普通卡 key',
      levelsRef: `${LEVELS_REL} 里这张卡的 ${LEVELS} 级属性：${RUNTIME_VERSION} 普通卡在 players/<card_id>，其余在 others/<version|card_id>`,
      conflict: '是否在 conflicts 里（card 表与等级表 Lv1 数值不同）',
    },
  },
  units: '属性点原值。weight 不是 kg，power 不是 N，radian 不是角度也不是弧度，precision 不是命中率（issues.json RULE-01）。',
  versions:
    `1.2.0 与 1.5.5 的同一 card_id 是两条记录（key = version|card_id），都保留，互不覆盖。两版都有的 ${pairs} 对里` +
    ` ${pairsDiffer} 对有字段不同，明细见 versionPairs。1.2.0 没有闪卡。`,
  versionPairs: { pairs, pairsDiffer, byField: Object.fromEntries(Object.entries(pairDiffs).map(([f, ids]) => [f, ids.join(' ')])) },
  conflictPolicy: POLICY,
  names:
    `card 表与等级表（level_records）有 ${nameDiffs.length} 张卡 game_name 不同（按版本：` +
    `${Object.entries(tally(nameDiffs, (d) => d.key.split('|')[0])).map(([v, n]) => `${v} ${n} 张`).join('，')}），见 nameDiffs。` +
    `两边原样保留：cards[].game_name 是 card 表的名字，${LEVELS_REL} others[].game_name 是等级表的名字；不改名、不合并。`,
  runtime: `运行时暂不读取本文件，属性仍走 ${LEVELS_REL}（T4-a）。`,
  rosterWithoutCards: { ids: rosterRebuilt, note: '重建球员（srcId 为空），原表没有卡，不造卡。' },
  observations: {
    note: '只记录，不作为取舍依据。',
    conflictCardValues: `${listed.length} 条冲突的 card 表值共 ${conflictCardValues.length} 组：${conflictCardValues.join(' ')}`,
    flash:
      `${flashCards.length} 张闪卡与对应普通卡相比：${FLASH_SAME.join(' / ')} 都相同 ${flashSameCard}/${flashCards.length}；` +
      `等级表 ${LEVELS} 级属性都相同 ${flashCards.length - flashLevelDiffs.length}/${flashCards.length}（不同的：${flashLevelDiffs.join(' ') || '无'}）`,
    flashTalentUnlockLevels: flashUnlocks,
    cardsWithoutSkills: tally(rows.filter((r) => r.skills === ''), (r) => `${r.version}|${r.variant}`),
    catalog: catalogDiffs.length ? catalogDiffs : `catalog.json ${catalog.length} 行的 card_variant_ids 与本文件一致`,
  },
};

// ---- write: one line per card / player / conflict, no timestamps
const text =
  '{\n' +
  '  "version": "cards-1",\n' +
  `  "meta": ${JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ')},\n` +
  '  "cards": {\n' +
  rows.map((r) => `    ${JSON.stringify(r.key)}: ${JSON.stringify(cards[r.key])}`).join(',\n') +
  '\n  },\n' +
  '  "byPlayer": {\n' +
  Object.keys(byPlayer).map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(byPlayer[id])}`).join(',\n') +
  '\n  },\n' +
  '  "conflicts": [\n' +
  conflicts.map((c) => `    ${JSON.stringify(c)}`).join(',\n') +
  '\n  ],\n' +
  '  "nameDiffs": [\n' +
  nameDiffs.map((d) => `    ${JSON.stringify(d)}`).join(',\n') +
  '\n  ],\n' +
  `  "pending": ${JSON.stringify(pending, null, 2).replace(/\n/g, '\n  ')}\n` +
  '}\n';

// round-trip: what lands on disk must equal what was built, and every source field must be verbatim
const back = JSON.parse(text);
if (JSON.stringify(back) !== JSON.stringify({ version: 'cards-1', meta, cards, byPlayer, conflicts, nameDiffs, pending })) fail('round-trip mismatch');
for (const r of rows) for (const [f] of SRC_FIELDS) if (back.cards[r.key][f] !== r[f]) fail(`${r.key}: ${f} is not verbatim`);
fs.writeFileSync(path.join(ROOT, OUT_REL), text);

console.log(
  JSON.stringify(
    {
      out: OUT_REL,
      bytes: Buffer.byteLength(text),
      sha256: createHash('sha256').update(text).digest('hex'),
      cards: rows.length,
      rowsByVersion,
      rowsByVariant,
      players: Object.keys(byPlayer).length,
      playersWith,
      rosterRebuilt,
      levelCells,
      levelOnly,
      skillRefs,
      skillLinks: links.length,
      conflicts: { listed: listed.length, recomputed: recomputed.length, cardValueSets: conflictCardValues.length, byVariant: tally(listed, (c) => c.variant) },
      conflictPolicy: POLICY,
      nameDiffs: nameDiffs.map((d) => `${d.key} ${d.card_game_name}/${d.level_game_name}`),
      versionPairs: { pairs, pairsDiffer, byField: Object.fromEntries(Object.entries(pairDiffs).map(([f, ids]) => [f, ids.length])) },
      flash: { cards: flashCards.length, sameCardFields: flashSameCard, levelsDifferFromBase: flashLevelDiffs, talentUnlockLevels: flashUnlocks },
      catalogDiffs,
      pending: pending.map((p) => `${p.subject} (${p.issue})`),
    },
    null,
    1,
  ),
);
