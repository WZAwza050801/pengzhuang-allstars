/**
 * T2-a roster importer. Rewrites data/players.json (players-2), docs/roster-conflicts.json,
 * docs/roster-provenance.json, docs/roster-mapping.md and docs/roster-audit.md from the recovered source tables.
 * p01..p16 are kept verbatim (runtime fields); new players are appended. Output is deterministic (no timestamps).
 *
 *   npx tsx tools/import-roster.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Row = Record<string, any>;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_REL = 'materials/pengzhuang_rebuild/02_players_and_data';
const rd = (rel: string): Row[] => JSON.parse(fs.readFileSync(path.join(ROOT, SRC_REL, rel), 'utf8'));
const write = (rel: string, text: string) => fs.writeFileSync(path.join(ROOT, rel), text);

const ATTR_MIN = 40;
const ATTR_MAX = 99;
const SRC_FIELDS = ['weight', 'power', 'mind', 'radian', 'precision'];
// runtime attrs order [weight, power, curve, accuracy, mental] <- source field, matched by field_dictionary label
const MAP = [
  { attr: 'weight', field: 'weight', label: '重量' },
  { attr: 'power', field: 'power', label: '力度' },
  { attr: 'curve', field: 'radian', label: '弧度' },
  { attr: 'accuracy', field: 'precision', label: '精准' },
  { attr: 'mental', field: 'mind', label: '心理' },
];
const POS: Record<string, string> = { ST: 'FW', CM: 'MF', DC: 'DF' };
const QUALITY: Record<number, string> = { 1: 'white', 2: 'green', 3: 'blue', 4: 'purple', 5: 'orange', 9: 'orange' };
const LINKED: Record<string, string> = { p01: '40108', p02: '40208', p03: '90002', p04: '20102', p05: '30103' };
const KEEP = Array.from({ length: 16 }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);
const RUNTIME_KEYS = ['id', 'name', 'nameSource', 'position', 'quality', 'attrs', 'growth', 'skill'];
const TUPLE: Record<string, number> = { weight: 70, power: 70, mind: 50, radian: 60, precision: 70 };
const ATTR_SRC_SUFFIX = '；T2-a：field_dictionary 1.5.5 确认源标签为 重量/力度/心理/弧度/精准（见 docs/roster-mapping.md）';
const NOTE =
  '属性 40–99，Lv1 基础值 + 每级成长。p01–p16 的数值仍为 rebuilt（保持不变）；p17 起取自原版 1.5.5 等级属性表' +
  '（Lv1→attrs，(Lv10−attrs)/9→growth；字段映射与取值规则见 docs/roster-mapping.md），Lv1 低于 40 的值取下限 40 并逐条记录于 docs/roster-conflicts.json。' +
  '名称来源见 nameSource。skill 为 unimplemented＝源卡有技能但效果未实现，none＝源卡无技能（见 docs/roster-audit.md）。' +
  'p17 起的 quality 是按 rarity 的约定映射，不是源值，运行时不读取。';

const round2 = (x: number) => Math.round(x * 100) / 100;
const clampAttr = (v: number) => Math.min(ATTR_MAX, Math.max(ATTR_MIN, v));
const sumOf = (a: number[]) => a.reduce((x, y) => x + y, 0);
const group = <T>(rows: Row[], key: (r: Row) => string, val: (r: Row) => T): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(val(r));
  }
  return m;
};

// ---------- load ----------
const PLAYERS_PATH = path.join(ROOT, 'data', 'players.json');
const oldText = fs.readFileSync(PLAYERS_PATH, 'utf8');
const old: Row = JSON.parse(oldText);
if (old.mapping.attrMin !== ATTR_MIN || old.mapping.attrMax !== ATTR_MAX) throw new Error('mapping.attrMin/attrMax differ from importer constants');
const baseById = new Map<string, Row>((old.players as Row[]).map((p) => [p.id, p]));
for (const id of KEEP) if (!baseById.has(id)) throw new Error(`existing ${id} missing from data/players.json`);
const skillDefs: Row[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'skills.json'), 'utf8')).skills;
const implemented = new Map<string, string>(skillDefs.map((s) => [s.name, s.id]));
const implementedIds = new Set<string>(skillDefs.map((s) => s.id));
const rulesLevels: Row = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'rules.json'), 'utf8')).levels;

const dict = rd('field_dictionary.json');
const master = rd('earlier_exports/players.json');
const cards = rd('card_records.json');
const levelAttr = rd('earlier_exports/level_attributes_1_5_5.json');
const levelRecs = rd('level_records.json');
const cards155Raw = rd('earlier_exports/cards_1_5_5.json');
const skillRows = rd('earlier_exports/skill_parameters_1_5_5.json');
const conflicts = rd('parameter_conflicts.json');
const issues = rd('issues.json');

const EVIDENCE_FIELDS = new Set([...SRC_FIELDS, 'growOrder', 'growPer', 'skillUnlockLv', 'skillId', 'rare', 'position', 'level']);
const dictEvidence = dict.filter((r) => r.version === '1.5.5' && (r.table === 'card' || r.table === 'card_attr') && EVIDENCE_FIELDS.has(r.field));
for (const x of MAP) {
  for (const table of ['card', 'card_attr']) {
    const hit = dict.filter((r) => r.version === '1.5.5' && r.table === table && r.field === x.field);
    if (!hit.length || hit.some((r) => r.source_label !== x.label)) throw new Error(`field_dictionary 1.5.5 ${table}.${x.field} label is not ${x.label}`);
  }
}

const lvByCard = group(levelAttr, (r) => String(r.oldId), (r) => r);
for (const rows of lvByCard.values()) rows.sort((a, b) => Number(a.level) - Number(b.level));
const skillById = new Map<string, Row>(skillRows.map((r) => [String(r.id), r]));
const raw155ById = new Map<string, Row>(cards155Raw.map((r) => [String(r.id), r]));
const masterIds = new Set<string>(master.map((m) => String(m.player_id)));
const lr155 = levelRecs.filter((r) => r.version === '1.5.5');
const lr120ByCard = group(
  levelRecs.filter((r) => r.version === '1.2.0' && r.card_record_present !== false),
  (r) => String(r.card_id),
  (r) => r,
);
for (const rows of lr120ByCard.values()) rows.sort((a, b) => Number(a.level) - Number(b.level));
const unlinked = levelRecs.filter((r) => r.card_record_present === false);
let lrMismatch = 0;
for (const r of lr155) {
  const t = lvByCard.get(String(r.card_id))?.find((x) => Number(x.level) === Number(r.level));
  if (!t || SRC_FIELDS.some((f) => Number(t[f]) !== Number(r[f]))) lrMismatch++;
}
const srcOrder = (r: Row) => SRC_FIELDS.map((f) => Number(r[f]));

// 1.5.5 cards whose card-table base values differ from the level-1 row (must equal the DATA-01 conflict set)
const mismatch155 = new Set<string>();
for (const c of cards.filter((x) => x.version === '1.5.5')) {
  const l1 = lvByCard.get(String(c.card_id))?.[0];
  if (!l1 || SRC_FIELDS.some((f) => Number(c[f]) !== Number(l1[f]))) mismatch155.add(String(c.card_id));
}
const conflictIds = new Set<string>(conflicts.map((c) => String(c.card_id)));
const mismatchEqualsConflicts = mismatch155.size === conflictIds.size && [...mismatch155].every((i) => conflictIds.has(i));

function skillOf(card: Row) {
  const ids = String(card.skills || '').split(';').filter(Boolean);
  const unlocks = String(card.unlocks || '').split(';').filter(Boolean).map(Number);
  const rows = ids.map((i) => {
    const r = skillById.get(i);
    if (!r) throw new Error(`skill id ${i} (card ${card.card_id}) not in skill_parameters_1_5_5.json`);
    return r;
  });
  const names = [...new Set(rows.map((r) => String(r.chineseSkillname)))];
  if (names.length > 1) throw new Error(`card ${card.card_id} has several skill family names: ${names.join('+')}`);
  return { family: names[0] ?? null, ids, unlocks, rows, levels: rows.map((r) => Number(r.level)) };
}

function derive(m: Row) {
  const sid = String(m.player_id);
  const normal = cards.find((c) => c.version === '1.5.5' && c.variant === '普通卡' && c.player_id === sid);
  if (!normal || String(normal.card_id) !== sid) throw new Error(`no 1.5.5 normal card with card_id == player_id for ${sid}`);
  const tbl = lvByCard.get(sid);
  if (!tbl || tbl.length !== 10 || tbl.some((r, i) => Number(r.level) !== i + 1)) throw new Error(`level table of ${sid} is not levels 1..10`);
  const pick = (row: Row) => MAP.map((x) => Number(row[x.field]));
  const raw1 = pick(tbl[0]);
  const raw10 = pick(tbl[9]);
  const attrs = raw1.map(clampAttr);
  const growth = raw10.map((z, i) => round2((z - attrs[i]) / 9));
  let nonlin = 0;
  let engineErrMax = 0;
  const lv5Delta: number[] = [];
  const pts: [number, boolean, number][] = [];
  MAP.forEach((x, i) => {
    const s = tbl.map((r) => Number(r[x.field]));
    const g = (s[9] - s[0]) / 9;
    s.forEach((v, L) => {
      nonlin = Math.max(nonlin, Math.abs(v - (s[0] + g * L)));
      // the engine clamps to attrMin..attrMax before normalising, so compare in that space
      const dev = clampAttr(attrs[i] + growth[i] * L) - clampAttr(v);
      engineErrMax = Math.max(engineErrMax, Math.abs(dev));
      pts.push([dev, raw1[i] !== attrs[i], L + 1]);
    });
    lv5Delta.push(round2(clampAttr(attrs[i] + growth[i] * 4) - clampAttr(s[4])));
  });
  return { sid, normal, tbl, raw1, raw10, attrs, growth, nonlin: round2(nonlin), engineErrMax: round2(engineErrMax), lv5Delta, pts, sk: skillOf(normal) };
}

// ---------- ids ----------
const idFor = new Map<string, string>();
for (const [rid, sid] of Object.entries(LINKED)) idFor.set(sid, rid);
let nextNo = 17;
for (const m of master) if (!idFor.has(String(m.player_id))) idFor.set(String(m.player_id), `p${nextNo++}`);

// ---------- build ----------
const fresh: Row[] = [];
const extras = new Map<string, Row>();
const prov: Record<string, Row> = {};
const clamps: Row[] = [];
const negGrowth: Row[] = [];
const fit: { id: string; nonlin: number; pts: [number, boolean, number][] }[] = [];
const lv10Over: number[] = [];
const nameMatchesImplemented: string[] = [];
const skillShapes = new Map<string, number>();

for (const m of master) {
  const d = derive(m);
  const rid = idFor.get(d.sid)!;
  const isLinked = d.sid in Object.fromEntries(Object.entries(LINKED).map(([a, b]) => [b, a]));
  const x = { srcId: d.sid, srcPosition: m.position, rarity: m.rarity_code, aliases: m.game_name_aliases ?? [], srcSkill: d.sk.family };
  const clampedAttrs = d.raw1.map((v, i) => (v !== d.attrs[i] ? MAP[i].attr : null)).filter(Boolean);
  d.raw1.forEach((v, i) => {
    if (v === d.attrs[i]) return;
    clamps.push({
      runtimeId: rid,
      srcId: d.sid,
      attr: MAP[i].attr,
      srcField: MAP[i].field,
      level: 1,
      raw: v,
      clamped: d.attrs[i],
      appliedToRuntime: !isLinked,
      reason:
        (v < ATTR_MIN ? `源 Lv1 值 ${v} 低于 attrMin ${ATTR_MIN}，取下限；未重新缩放` : `源 Lv1 值 ${v} 高于 attrMax ${ATTR_MAX}，取上限；未重新缩放`) +
        (isLinked ? `；${rid} 保留 rebuilt 数值（只追加），此 clamp 只出现在 roster-provenance.json 的 derived 推导值上，未应用到运行时` : ''),
    });
  });
  let runtimeSkill: string;
  if (isLinked) {
    extras.set(rid, x);
    runtimeSkill = baseById.get(rid)!.skill;
  } else {
    if (!POS[m.position]) throw new Error(`unmapped source position ${m.position} (${d.sid})`);
    if (!QUALITY[m.rarity_code]) throw new Error(`unmapped rarity_code ${m.rarity_code} (${d.sid})`);
    runtimeSkill = d.sk.ids.length ? 'unimplemented' : 'none';
    if (d.sk.family && implemented.has(d.sk.family)) nameMatchesImplemented.push(`${rid}:${d.sk.family}`);
    fresh.push({
      id: rid,
      name: m.game_name,
      nameSource: `source:players.json#${d.sid}`,
      position: POS[m.position],
      quality: QUALITY[m.rarity_code],
      attrs: d.attrs,
      growth: d.growth,
      skill: runtimeSkill,
      ...x,
    });
    d.growth.forEach((g, i) => {
      if (g >= 0) return;
      const bothBelowMin = d.raw1[i] < ATTR_MIN && d.raw10[i] <= ATTR_MIN;
      negGrowth.push({
        runtimeId: rid,
        srcId: d.sid,
        attr: MAP[i].attr,
        attrs: d.attrs[i],
        growth: g,
        rawLv1: d.raw1[i],
        rawLv10: d.raw10[i],
        bothBelowMin,
        note: bothBelowMin
          ? `源 Lv1 ${d.raw1[i]} 与 Lv10 ${d.raw10[i]} 都不高于 attrMin ${ATTR_MIN}：运行时曲线始终不高于 ${ATTR_MIN}，归一化后恒为 0（源两端点同样不高于 ${ATTR_MIN}）；负斜率只是让 Lv10 保持源值`
          : `源表自身 Lv10 ${d.raw10[i]} 低于 Lv1 ${d.raw1[i]}，按源保留负斜率`,
      });
    });
    d.raw10.forEach((v) => {
      if (v > ATTR_MAX) lv10Over.push(v);
    });
    fit.push({ id: rid, nonlin: d.nonlin, pts: d.pts });
  }
  const shape = d.sk.ids.length ? `技能行等级 ${d.sk.levels.join('/')}、解锁等级 ${d.sk.unlocks.join('/')}` : '无技能';
  skillShapes.set(shape, (skillShapes.get(shape) ?? 0) + 1);
  const foilCards = cards.filter((c) => c.version === '1.5.5' && c.variant === '闪卡' && c.player_id === d.sid);
  prov[rid] = {
    srcId: d.sid,
    runtimeName: isLinked ? baseById.get(rid)!.name : m.game_name,
    srcName: m.game_name,
    realName: m.real_name_original,
    realNameEn: m.real_name_english,
    club: m.club_cn,
    srcPosition: m.position,
    rarityCode: m.rarity_code,
    aliases: m.game_name_aliases ?? [],
    firstRecoveredIn: m.first_recovered_in,
    cardVariantIds: m.card_variant_ids,
    cards: cards.filter((c) => c.player_id === d.sid),
    raw155: [raw155ById.get(d.sid), ...foilCards.map((c) => raw155ById.get(String(c.card_id)))].filter(Boolean),
    levels155: d.tbl.map(srcOrder),
    levels120: lr120ByCard.get(d.sid)?.map(srcOrder) ?? null,
    skill: { runtime: runtimeSkill, family: d.sk.family, ids: d.sk.ids, unlocks: d.sk.unlocks, rows: d.sk.rows },
    derived: { attrsRawLv1: d.raw1, rawLv10: d.raw10, attrs: d.attrs, growth: d.growth, clampedAttrs, nonlinearity: d.nonlin, engineErrMax: d.engineErrMax, lv5Delta: d.lv5Delta },
    runtimeValuesFrom: isLinked ? 'kept rebuilt values (p01-p16 are append-only); derived is what the source would give' : 'source level table',
  };
}

const rebuiltExtras = { srcId: null, srcPosition: null, rarity: null, aliases: [], srcSkill: null };
const players: Row[] = KEEP.map((id) => {
  const e: Row = {};
  for (const k of RUNTIME_KEYS) e[k] = baseById.get(id)![k];
  return Object.assign(e, extras.get(id) ?? rebuiltExtras);
});
players.push(...fresh);

// ---------- checks ----------
const keySig = JSON.stringify(Object.keys(players[0]));
const ids = new Set<string>();
for (const p of players) {
  if (ids.has(p.id)) throw new Error(`duplicate id ${p.id}`);
  ids.add(p.id);
  if (JSON.stringify(Object.keys(p)) !== keySig) throw new Error(`${p.id}: key set differs from ${keySig}`);
  if (p.attrs.length !== 5 || p.growth.length !== 5) throw new Error(`${p.id}: attrs/growth length`);
  if (p.attrs.some((v: number) => !Number.isFinite(v) || v < ATTR_MIN || v > ATTR_MAX)) throw new Error(`${p.id}: attrs out of ${ATTR_MIN}..${ATTR_MAX}`);
  if (p.growth.some((v: number) => !Number.isFinite(v))) throw new Error(`${p.id}: growth not finite`);
  if (!implementedIds.has(p.skill) && p.skill !== 'unimplemented' && p.skill !== 'none') throw new Error(`${p.id}: unknown skill ${p.skill}`);
}
const covered = new Set<string>(players.map((p) => p.srcId).filter(Boolean));
if (covered.size !== masterIds.size || [...masterIds].some((i) => !covered.has(i))) throw new Error('source coverage is not exactly the 106 master players');
const cardsLinked = cards.filter((c) => masterIds.has(String(c.player_id))).length;
if (cardsLinked !== cards.length) throw new Error(`only ${cardsLinked}/${cards.length} cards link to a master player`);
if (fresh.length + 16 !== players.length) throw new Error('player count arithmetic');

// ---------- players.json ----------
const fmt = (v: unknown): string => (Array.isArray(v) ? `[${v.map(fmt).join(', ')}]` : JSON.stringify(v));
const playerLine = (p: Row) => `    { ${Object.keys(p).map((k) => `${JSON.stringify(k)}: ${fmt(p[k])}`).join(', ')} }`;
const attrBlock = oldText.slice(oldText.indexOf('  "attributes": {'), oldText.indexOf('  "attributesSource"'));
const mappingTail = oldText.slice(oldText.indexOf('  "mapping": {'));
const attrSource = String(old.attributesSource).split('；T2-a：')[0] + ATTR_SRC_SUFFIX;
const playersText =
  '{\n' +
  `  "version": "players-2",\n` +
  `  "note": ${JSON.stringify(NOTE)},\n` +
  attrBlock +
  `  "attributesSource": ${JSON.stringify(attrSource)},\n` +
  `  "players": [\n${players.map(playerLine).join(',\n')}\n  ],\n` +
  mappingTail;
JSON.parse(playersText);
write('data/players.json', playersText);

// ---------- conflicts doc ----------
const runtimeOf = (sid: string) => idFor.get(String(sid)) ?? null;
const conflictRecs = conflicts.map((c) => {
  const rid = runtimeOf(c.player_id);
  const lt = lvByCard.get(String(c.card_id));
  const normal = c.variant === '普通卡';
  const l1Matches = !!lt && SRC_FIELDS.every((f) => Number(c.level1_values?.[f]) === Number(lt[0][f]));
  const tuple = SRC_FIELDS.every((f) => Number(c.card_values?.[f]) === TUPLE[f]);
  const linked = rid !== null && rid in LINKED;
  return {
    ...c,
    runtimeId: rid,
    cardValuesAreSharedTuple: tuple,
    level1ValuesMatchLevelTable: l1Matches,
    applied: normal
      ? {
          rule: 'level-table-Lv1',
          effect: linked ? `${rid} 保留 rebuilt 数值（只追加）；源 Lv1 行记录在 roster-provenance.json 的 derived` : `${rid} 的 attrs 取等级表 Lv1 行（再按 40–99 clamp，见 clamps）`,
        }
      : { rule: 'record-only', effect: '闪卡不是运行时球员，无运行时影响；两组值仅在此记录' },
    ourDecisionNote: '工程决定，非源裁决：源表 resolution 为“运行时取值优先级未知”。',
  };
});
const clampsApplied = clamps.filter((c) => c.appliedToRuntime);
const clampPerAttr = MAP.map((x) => clampsApplied.filter((c) => c.attr === x.attr).length);
const confSummary = {
  conflicts: conflicts.length,
  conflictsNormalCard: conflicts.filter((c) => c.variant === '普通卡').length,
  conflictsFoilCard: conflicts.filter((c) => c.variant === '闪卡').length,
  cardValuesSharedTuple: conflictRecs.filter((c) => c.cardValuesAreSharedTuple).length,
  level1ValuesMatchLevelTable: conflictRecs.filter((c) => c.level1ValuesMatchLevelTable).length,
  cardVsLevel1MismatchSetEqualsConflictSet: mismatchEqualsConflicts,
  clampRecords: clamps.length,
  clampsAppliedToRuntime: clampsApplied.length,
  clampsOnUnappliedDerived: clamps.length - clampsApplied.length,
  clampedPlayersApplied: new Set(clampsApplied.map((c) => c.runtimeId)).size,
  clampPerAttrApplied: Object.fromEntries(MAP.map((x, i) => [x.attr, clampPerAttr[i]])),
  clampMinRaw: clamps.length ? Math.min(...clamps.map((c) => c.raw)) : null,
  clampAboveMax: clamps.filter((c) => c.raw > ATTR_MAX).length,
  negativeGrowth: negGrowth.length,
  negativeGrowthBothEndsBelowMin: negGrowth.filter((g) => g.bothBelowMin).length,
  issues: issues.length,
};
const HANDLING: Record<string, string> = {
  'NAME-01': '未导入：40109 的额外独立头像未被 card 表引用、属性留空（源 action），不创建运行时球员；等待用户确认是否按小罗收录。',
  'NAME-02': '80206 沿用源 master 的身份与 game_name，不替换；Guillermo 候选仅在此记录。',
  'DATA-01': '20 条两组值并排保留在 valueConflicts；18 张普通卡取等级表 Lv1 行（工程决定，非源裁决）；2 张闪卡仅记录，不影响运行时。',
  'DATA-02': '90001 的 10 行等级属性原样保留在 roster-provenance.json#unlinkedLevelRecords；不创建球员，也不认定当时已可获得。',
  'RULE-01': '五项按“属性点”保存，不标单位；到物理量的映射仍是 data/players.json 的 mapping（未改动）。',
  'RULE-02': '技能 duration 原值保留在 roster-provenance.json 的 players.*.skill.rows；未换算秒数或回合；该导入只带 skill_parameters 行，不含原始文案列；运行时技能为占位，效果未实现。',
  'RULE-03': 'triggerTypeList / triggerPerList 按源字符串原样（含分号顺序）保留在 players.*.skill.rows；未相乘；运行时技能为占位，效果未实现。',
  'NAME-03': '显示名保留源 master 的 game_name；“蜘蛛侠”别称尚未关联到具体 ID，不写入任何球员的 aliases（p51 奥巴没样的源技能名恰为“蜘蛛侠”，只作为 srcSkill 保留）。',
};
const issueRecs = issues.map((i) => {
  if (!HANDLING[i.id]) throw new Error(`no handling text for issue ${i.id}`);
  return { ...i, handling: HANDLING[i.id] };
});
const META = { generatedBy: 'tools/import-roster.ts', source: SRC_REL };
const jl = (arr: unknown[]) => arr.map((x) => `    ${JSON.stringify(x)}`).join(',\n');
write(
  'docs/roster-conflicts.json',
  '{\n' +
    `  "meta": ${JSON.stringify({ ...META, note: 'parameter_conflicts.json（20）与 issues.json（8）逐条保留；clamps 为 attrs 越界（<40 或 >99）的逐条记录，原值与取值并列（appliedToRuntime=false 的记录只出现在 p01–p05 的 provenance 推导值上）；negativeGrowth 为负 growth 的逐条记录。' })},\n` +
    `  "summary": ${JSON.stringify(confSummary)},\n` +
    `  "valueConflicts": [\n${jl(conflictRecs)}\n  ],\n` +
    `  "clamps": [\n${jl(clamps)}\n  ],\n` +
    `  "negativeGrowth": [\n${jl(negGrowth)}\n  ],\n` +
    `  "issues": [\n${jl(issueRecs)}\n  ]\n}\n`,
);

// ---------- provenance doc ----------
write(
  'docs/roster-provenance.json',
  '{\n' +
    `  "meta": ${JSON.stringify({ ...META, note: '运行时不读取。每名源球员的原始卡牌记录（1.2.0 / 1.5.5 普通 / 1.5.5 闪卡）、10 级等级表（字段顺序见 levelTableFields）、成长参数（raw155 内的 growOrder/growPer/skillUnlockLv）、技能族原始行与导入推导值。' })},\n` +
    `  "levelTableFields": ${JSON.stringify(SRC_FIELDS)},\n` +
    `  "players": {\n${Object.entries(prov).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n  },\n` +
    `  "unlinkedLevelRecords": ${JSON.stringify(unlinked)}\n}\n`,
);

// ---------- stats for docs ----------
const cnt = (f: (c: Row) => boolean) => cards.filter(f).length;
const pos = (p: string) => master.filter((m) => m.position === p).length;
const mean = (a: number[]) => (a.length ? round2(sumOf(a) / a.length) : 0);
const artDir = path.join(ROOT, 'art', 'cutout');
const artHave = new Set(fs.existsSync(artDir) ? fs.readdirSync(artDir).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '')) : []);
const artMissing = players.map((p) => p.id).filter((i) => !artHave.has(i));
const fam = group(fresh.filter((p) => p.srcSkill), (p) => p.srcSkill, (p) => p.id as string);
const skillCount = (s: string) => players.filter((p) => p.skill === s).length;
const nImpl = players.filter((p) => implementedIds.has(p.skill)).length;
const allPts = fit.flatMap((f) => f.pts);
const stat = (sel: (p: [number, boolean, number]) => boolean) => {
  const dev = allPts.filter(sel).map((p) => p[0]);
  const abs = dev.map(Math.abs);
  return { n: dev.length, max: abs.length ? round2(Math.max(...abs)) : 0, mean: mean(abs), above: dev.filter((v) => v > 0.01).length, below: dev.filter((v) => v < -0.01).length };
};
const S = {
  master: master.length,
  runtime: players.length,
  fresh: fresh.length,
  cards: cards.length,
  cards120: cnt((c) => c.version === '1.2.0'),
  cards155Normal: cnt((c) => c.version === '1.5.5' && c.variant === '普通卡'),
  cards155Foil: cnt((c) => c.version === '1.5.5' && c.variant === '闪卡'),
  lvRows: levelAttr.length,
  lvCards: lvByCard.size,
  lrRows: levelRecs.length,
  lr155: lr155.length,
  lrMismatch,
  unlinked: unlinked.length,
  skillUnimplemented: skillCount('unimplemented'),
  skillNone: skillCount('none'),
  skillImplemented: nImpl,
  families: fam.size,
  nameMatchesImplemented,
  lv10Over99: lv10Over.length,
  lv10Over99Max: lv10Over.length ? Math.max(...lv10Over) : null,
  negGrowth: negGrowth.length,
  nonlinMax: Math.max(...fit.map((f) => f.nonlin)),
  engPlain: stat((p) => !p[1]),
  engClamped: stat((p) => p[1]),
  engUniform: stat((p) => p[2] === rulesLevels.uniformLevel),
  engLv10: stat((p) => p[2] === 10),
  artHave: artHave.size,
  artMissing: artMissing.length,
};
const attrRange = (i: number, src: 'attrs' | 'growth') => {
  const v = fresh.map((p) => p[src][i] as number);
  return `${Math.min(...v)}–${Math.max(...v)}`;
};

// ---------- mapping doc ----------
const mappingMd = [
  '# 名册导入映射（T2-a）',
  '',
  '由 `tools/import-roster.ts` 生成，请勿手改。源目录：`materials/pengzhuang_rebuild/02_players_and_data/`（版本 1.2.0 / 1.5.5）。',
  '',
  '## 1. 属性：源字段 → 运行时 attrs',
  '',
  '运行时 `attrs` / `growth` 的顺序是 `[weight, power, curve, accuracy, mental]`。对应关系取自 `field_dictionary.json`（1.5.5，`card` 与 `card_attr` 两表，导入时逐项断言标签一致），不凭字面猜：',
  '',
  '| attrs 下标 | 运行时键 | 源字段 | 字典标签 |',
  '|---|---|---|---|',
  ...MAP.map((x, i) => `| ${i} | ${x.attr} | ${x.field} | ${x.label} |`),
  '',
  '源表字段的出现顺序是 weight, power, mind, radian, precision。若按出现顺序逐位写入，会把 mind 写进 curve 位、radian 写进 accuracy 位、precision 写进 mental 位，所以按字典标签对应。数值单位未恢复（RULE-01），按“属性点”保存，不标 kg / N / 角度 / 命中率。',
  '',
  '字典依据（1.5.5）：',
  '',
  ...[...new Set(dictEvidence.map((r) => `- ${r.table}.${r.field} = ${r.source_label || '（空）'}`))],
  '',
  '## 2. 取值规则',
  '',
  `- 数值来源：\`earlier_exports/level_attributes_1_5_5.json\`（等级属性表），按 \`oldId == card_id\` 关联到 1.5.5 普通卡（${S.cards155Normal} 张，\`card_id == player_id\`）。`,
  `- \`attrs\` = Lv1 行；\`growth\` = (Lv10 − attrs) / 9，保留 2 位小数。引擎按 \`min(attrMax, attrs + growth × (level−1))\` 计算，默认对局等级为 ${rulesLevels.uniformLevel}（\`rules.levels.uniformLevel\`）。`,
  `- 不重新缩放；\`mapping\`（attrMin ${ATTR_MIN} / attrMax ${ATTR_MAX}）未改动。`,
  `- Lv1 < ${ATTR_MIN} → 取 ${ATTR_MIN}；Lv1 > ${ATTR_MAX} → 取 ${ATTR_MAX}。每一次都记录在 \`docs/roster-conflicts.json#clamps\`（球员、属性、源字段、层级、原值、取值、原因），没有静默 clamp。clamp 后 growth 仍按源 Lv10 计算，Lv10 保持源值；Lv10 > ${ATTR_MAX} 的部分由引擎的 attrMax 饱和。p01–p05 保留 rebuilt 数值，它们源推导值上的 clamp 同样记录，标记 \`appliedToRuntime: false\`。`,
  `- DATA-01：1.5.5 有 ${confSummary.conflicts} 条卡牌基础五属性与等级表 Lv1 行不一致。两组值并排保留在 \`docs/roster-conflicts.json#valueConflicts\`。${confSummary.conflictsNormalCard} 张普通卡取等级表 Lv1 行；${confSummary.conflictsFoilCard} 张闪卡不是运行时球员，仅记录。取舍是工程决定，不是源裁决（源表写明“运行时取值优先级未知”）。`,
  `- 1.2.0 的 ${S.cards120} 张卡、1.5.5 的 ${S.cards155Foil} 张闪卡不生成运行时球员，原样保留在 \`docs/roster-provenance.json\`。`,
  '',
  '## 3. 其它字段',
  '',
  '- `id`：p01–p16 保持不变；p17 起按源 master 顺序（player_id 升序）顺次编号，跳过已关联的 5 名源球员。',
  '- `name` = 源 `game_name`；`aliases` = 源 `game_name_aliases`（不覆盖 `name`）；`nameSource` = `source:players.json#<player_id>`。',
  '- `srcId`：源 player_id；p06–p16 无源对应，为 `null`。`srcPosition`：源位置原值。`rarity`：源 `rarity_code`（数值）。',
  '- `position`：ST→FW、CM→MF、DC→DF（源 master 只有这三种，没有 GK）。',
  '- `quality`：p17 起按约定 1 white / 2 green / 3 blue / 4 purple / 5、9 orange 映射——这是约定，不是源值（未恢复源的颜色语义）；运行时代码不读取 quality。',
  '- `srcSkill`：源 1.5.5 普通卡的技能族名（`skill_parameters_1_5_5.json` 的 `chineseSkillname`）；无技能为 `null`。',
  '',
  '## 4. 技能占位',
  '',
  '- `skill` 取 `data/skills.json` 里的 id（p01–p16，rebuilt 效果）、`unimplemented`（源卡有技能族，效果未实现）或 `none`（源卡无技能）。引擎对未知 id 取 `null`，等同无技能。',
  '- 新球员不按名称自动绑定已实现技能：名称相同不能证明参数相同（RULE-02 / RULE-03 未知）。技能族的原始行（duration、triggerPerList、条件列表、解锁等级）保留在 `docs/roster-provenance.json`。',
  '',
  '## 5. 既有球员 p01–p16',
  '',
  '- 只追加：p01–p16 的 `id / name / nameSource / position / quality / attrs / growth / skill` 保持不变，只新增上述附加键。',
  '- p01–p05 按名称关联源球员 40108 / 40208 / 90002 / 20102 / 30103（早期恢复标记 recovered:S03 / S04）：保留 rebuilt 数值，源推导值与差异记录在 `docs/roster-provenance.json` 的 `derived`。p06–p16 无源对应。',
  '',
].join('\n');
write('docs/roster-mapping.md', mappingMd);

// ---------- audit doc ----------
const keptTable = Object.entries(LINKED).map(([rid, sid]) => {
  const e = players.find((p) => p.id === rid)!;
  const dv = prov[rid].derived;
  const rtName = skillDefs.find((s) => s.id === e.skill)?.name ?? '';
  const same = rtName && rtName === prov[rid].skill.family ? '是' : '否';
  return `| ${rid} | ${sid} | ${e.name} | ${JSON.stringify(e.attrs)} / ${JSON.stringify(e.growth)} | ${JSON.stringify(dv.attrs)} / ${JSON.stringify(dv.growth)} | ${e.skill}（${rtName}） | ${prov[rid].skill.family ?? '无'} | ${same} |`;
});
const nLinked = Object.keys(LINKED).length;
const auditMd = [
  '# 名册审计（T2-a）',
  '',
  '由 `tools/import-roster.ts` 生成；数字均为本次导入的实测。字段映射与取值规则见 `docs/roster-mapping.md`，冲突与 clamp 明细见 `docs/roster-conflicts.json`，原始值见 `docs/roster-provenance.json`。',
  '',
  '## 1. 数量与覆盖',
  '',
  `- 源身份表（earlier_exports/players.json）：${S.master} 名球员（ST ${pos('ST')} / CM ${pos('CM')} / DC ${pos('DC')}，无 GK）。`,
  `- 运行时 data/players.json（players-2）：${S.runtime} 条 = 既有 p01–p16 + 新增 ${S.fresh} 条（p17–p${S.runtime}）。`,
  `- 源覆盖：${covered.size}/${S.master}，每名源球员恰好对应 1 个运行时条目（${nLinked} 个对应既有 p01–p05，${S.fresh} 个为新增）；p06–p16 共 ${KEEP.length - nLinked} 条无源对应（rebuilt）。`,
  `- 条目数不是恰好 ${S.master}：既有 p01–p16 按“只追加”整体保留，其中 p06 / p07 / p08 / p10 / p15 / p16 被 \`rules.defaultLineup\` 或客户端 BOT_LINEUP / P2_LINEUP 引用，删掉会让默认阵容与 AI / 双人阵容指向不存在的 id；${S.master} − ${nLinked} + ${KEEP.length} = ${S.runtime}。`,
  `- 卡牌：card_records.json ${S.cards} 张 = 1.2.0 ${S.cards120} + 1.5.5 普通 ${S.cards155Normal} + 1.5.5 闪卡 ${S.cards155Foil}；全部关联到源球员（${cardsLinked}/${S.cards}）。闪卡是同一球员的变体，不单独生成运行时球员。`,
  `- 等级属性：level_attributes_1_5_5.json ${S.lvRows} 行（${S.lvCards} 张卡 × 10 级）；level_records.json ${S.lrRows} 行，其中 1.5.5 的 ${S.lr155} 行与等级表逐值交叉校验，不一致 ${S.lrMismatch} 行；1.2.0 中无 card 记录的 ${S.unlinked} 行（DATA-02）原样保留。`,
  '',
  '## 2. 源版本',
  '',
  `- 1.2.0：${S.cards120} 张卡，只做 provenance。1.5.5：${S.cards155Normal + S.cards155Foil} 张卡（${S.cards155Normal} 普通 + ${S.cards155Foil} 闪卡）；数值取 1.5.5 等级表的 Lv1 / Lv10，闪卡只做 provenance。`,
  `- 1.5.5 中卡牌基础五属性与等级表 Lv1 不一致的卡共 ${mismatch155.size} 张，${mismatchEqualsConflicts ? `与 parameter_conflicts.json 的 ${confSummary.conflicts} 条完全是同一集合` : `与 parameter_conflicts.json 的 ${confSummary.conflicts} 条不是同一集合（需要核对）`}。`,
  '',
  '## 3. 冲突与 clamp',
  '',
  `- parameter_conflicts：${confSummary.conflicts} 条（普通卡 ${confSummary.conflictsNormalCard} + 闪卡 ${confSummary.conflictsFoilCard}），逐条并排保留；其中 card_values 与同一组 70/70/50/60/70 完全相同的有 ${confSummary.cardValuesSharedTuple} 条，level1_values 与等级表 Lv1 一致的有 ${confSummary.level1ValuesMatchLevelTable} 条。源 resolution：“两表原值均保留，运行时取值优先级未知。”`,
  '- 处理规则：普通卡取等级表 Lv1 行；闪卡仅记录。这是工程决定，不是源裁决。',
  `- issues.json：${confSummary.issues} 条逐条保留并附处理说明（NAME-01 / NAME-02 / DATA-01 / DATA-02 / RULE-01 / RULE-02 / RULE-03 / NAME-03）。`,
  `- attrs clamp：${S.fresh} 名新球员共 ${S.fresh * 5} 个 Lv1 值，其中 ${confSummary.clampsAppliedToRuntime} 个低于 ${ATTR_MIN} 并取下限（涉及 ${confSummary.clampedPlayersApplied} 名球员；weight ${clampPerAttr[0]} / power ${clampPerAttr[1]} / curve ${clampPerAttr[2]} / accuracy ${clampPerAttr[3]} / mental ${clampPerAttr[4]}）。另有 ${confSummary.clampsOnUnappliedDerived} 个发生在 p01–p05（保留 rebuilt 数值）的源推导值上，只记录、未应用到运行时。共 ${confSummary.clampRecords} 条逐条记录（原值最低 ${confSummary.clampMinRaw}），高于 ${ATTR_MAX} 的 ${confSummary.clampAboveMax} 个，无静默 clamp。`,
  `- 新球员 attrs 实际范围：weight ${attrRange(0, 'attrs')} / power ${attrRange(1, 'attrs')} / curve ${attrRange(2, 'attrs')} / accuracy ${attrRange(3, 'attrs')} / mental ${attrRange(4, 'attrs')}；growth 范围：weight ${attrRange(0, 'growth')} / power ${attrRange(1, 'growth')} / curve ${attrRange(2, 'growth')} / accuracy ${attrRange(3, 'growth')} / mental ${attrRange(4, 'growth')}。`,
  '',
  '## 4. 成长拟合',
  '',
  `- 引擎用线性成长。源表自身的非线性（源值相对 Lv1–Lv10 连线的最大偏差）：最大 ${S.nonlinMax}。`,
  `- 引擎先把 \`attrs + growth × (level−1)\` 限制到 [${ATTR_MIN}, ${ATTR_MAX}] 再归一化，所以下面把运行时曲线与源表等级值都放进 [${ATTR_MIN}, ${ATTR_MAX}] 再比较（${S.fresh} 名新球员 × 5 项 × 10 级 = ${S.engPlain.n + S.engClamped.n} 个点；偏差超过 0.01 才计入“高于 / 低于源”）：`,
  `  - Lv1 未被 clamp 的属性（${S.engPlain.n} 点）：最大偏差 ${S.engPlain.max}、平均 ${S.engPlain.mean}；运行时高于源 ${S.engPlain.above} 点、低于源 ${S.engPlain.below} 点。`,
  `  - Lv1 被 clamp 的属性（${S.engClamped.n} 点）：最大偏差 ${S.engClamped.max}、平均 ${S.engClamped.mean}；运行时高于源 ${S.engClamped.above} 点、低于源 ${S.engClamped.below} 点。`,
  `  - 默认对局等级 ${rulesLevels.uniformLevel}（\`rules.levels.uniformLevel\`）处全部新球员属性：最大偏差 ${S.engUniform.max}、平均 ${S.engUniform.mean}（${S.engUniform.n} 点）；Lv10 处最大偏差 ${S.engLv10.max}（growth 取 2 位小数所致）。`,
  `- 负成长：${S.negGrowth} 个（${confSummary.negativeGrowthBothEndsBelowMin} 个是源 Lv1、Lv10 都不高于 ${ATTR_MIN}，运行时曲线恒不高于 ${ATTR_MIN}、归一化为 0；其余 ${S.negGrowth - confSummary.negativeGrowthBothEndsBelowMin} 个是源表自身 Lv10 低于 Lv1）。逐条见 \`docs/roster-conflicts.json#negativeGrowth\`。Lv10 源值 > ${ATTR_MAX} 的有 ${S.lv10Over99} 个（最大 ${S.lv10Over99Max}），由引擎 attrMax 饱和。`,
  '',
  '## 5. 技能',
  '',
  `- 运行时 skill：已实现（skills.json 内的 id）${S.skillImplemented} 个（均为 p01–p16 的 rebuilt 效果）；unimplemented ${S.skillUnimplemented} 个；none ${S.skillNone} 个（源卡无技能）。`,
  `- 新球员的技能族共 ${S.families} 个，全部未实现；名称与已实现技能相同的新球员：${S.nameMatchesImplemented.length ? S.nameMatchesImplemented.join('、') : '无'}。`,
  `- 源 1.5.5 ${S.cards155Normal} 张普通卡的技能族形态：${[...skillShapes.entries()].map(([k, n]) => `${k} ${n} 张`).join('；')}。\`rules.levels.skillLevelAt\` 现为 ${JSON.stringify(rulesLevels.skillLevelAt)}（rebuilt 值），未改动。`,
  '',
  '既有 p01–p05 与源技能族对照（运行时技能保持不变；名称相同不等于参数相同）：',
  '',
  '| 运行时 id | 源 id | 名称 | 运行时 attrs / growth（保留） | 源推导 attrs / growth | 运行时技能 | 源技能族 | 同名 |',
  '|---|---|---|---|---|---|---|---|',
  ...keptTable,
  '',
  '未实现技能族（技能族名 — 运行时 id）：',
  '',
  ...[...fam.entries()].map(([f, v]) => `- ${f} — ${v.join('、')}`),
  '',
  '## 6. 美术',
  '',
  `- art/cutout 现有 ${S.artHave} 张（p01–p16）。缺图 ${S.artMissing} 个：${artMissing.length ? `${artMissing[0]}–${artMissing[artMissing.length - 1]}` : '无'}。不生成占位图；新增球员美术由 tools/gen-art.ts 在另一个子任务处理。`,
  '',
  '## 7. 遗留与风险',
  '',
  `- 数值尺度：源 Lv1 值最低 ${confSummary.clampMinRaw}，而 mapping.attrMin 是 ${ATTR_MIN}，低于下限的值在物理映射里饱和为最小倍率；新球员整体弱于 rebuilt 的 p01–p16。未重新缩放。`,
  '- p01–p05 保留 rebuilt 数值，与源值有差异（见上表），未覆盖。',
  '- quality 颜色是约定映射，不是源值。',
  '- NAME-01（40109）未导入，等待用户确认。',
  '- tools/gen-art.ts 按文件名字典序排序，p100–p117 会排在 p17 之前（仅影响排序，不影响功能）。',
  '',
].join('\n');
write('docs/roster-audit.md', auditMd);

console.log(JSON.stringify({ ...S, nameMatchesImplemented: S.nameMatchesImplemented.length, conflicts: confSummary, artMissingRange: artMissing.length ? `${artMissing[0]}..${artMissing[artMissing.length - 1]}` : null }, null, 1));
