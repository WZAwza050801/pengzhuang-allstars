# 名册导入映射（T2-a）

由 `tools/import-roster.ts` 生成，请勿手改。源目录：`materials/pengzhuang_rebuild/02_players_and_data/`（版本 1.2.0 / 1.5.5）。

## 1. 属性：源字段 → 运行时 attrs

运行时 `attrs` / `growth` 的顺序是 `[weight, power, curve, accuracy, mental]`。对应关系取自 `field_dictionary.json`（1.5.5，`card` 与 `card_attr` 两表，导入时逐项断言标签一致），不凭字面猜：

| attrs 下标 | 运行时键 | 源字段 | 字典标签 |
|---|---|---|---|
| 0 | weight | weight | 重量 |
| 1 | power | power | 力度 |
| 2 | curve | radian | 弧度 |
| 3 | accuracy | precision | 精准 |
| 4 | mental | mind | 心理 |

源表字段的出现顺序是 weight, power, mind, radian, precision。若按出现顺序逐位写入，会把 mind 写进 curve 位、radian 写进 accuracy 位、precision 写进 mental 位，所以按字典标签对应。数值单位未恢复（RULE-01），按“属性点”保存，不标 kg / N / 角度 / 命中率。

字典依据（1.5.5）：

- card.rare = 品质
- card.position = 位置
- card.weight = 重量
- card.power = 力度
- card.mind = 心理
- card.radian = 弧度
- card.precision = 精准
- card.growOrder = 成长顺序
- card.growPer = 成长百分比
- card.skillUnlockLv = 解锁LV
- card.skillId = 解锁技能ID
- card_attr.level = 等级
- card_attr.weight = 重量
- card_attr.power = 力度
- card_attr.mind = 心理
- card_attr.radian = 弧度
- card_attr.precision = 精准

## 2. 取值规则

- 数值来源：`earlier_exports/level_attributes_1_5_5.json`（等级属性表），按 `oldId == card_id` 关联到 1.5.5 普通卡（106 张，`card_id == player_id`）。
- `attrs` = Lv1 行；`growth` = (Lv10 − attrs) / 9，保留 2 位小数。引擎按 `min(attrMax, attrs + growth × (level−1))` 计算，默认对局等级为 5（`rules.levels.uniformLevel`）。
- 不重新缩放；`mapping`（attrMin 40 / attrMax 99）未改动。
- Lv1 < 40 → 取 40；Lv1 > 99 → 取 99。每一次都记录在 `docs/roster-conflicts.json#clamps`（球员、属性、源字段、层级、原值、取值、原因），没有静默 clamp。clamp 后 growth 仍按源 Lv10 计算，Lv10 保持源值；Lv10 > 99 的部分由引擎的 attrMax 饱和。p01–p05 保留 rebuilt 数值，它们源推导值上的 clamp 同样记录，标记 `appliedToRuntime: false`。
- DATA-01：1.5.5 有 20 条卡牌基础五属性与等级表 Lv1 行不一致。两组值并排保留在 `docs/roster-conflicts.json#valueConflicts`。18 张普通卡取等级表 Lv1 行；2 张闪卡不是运行时球员，仅记录。取舍是工程决定，不是源裁决（源表写明“运行时取值优先级未知”）。
- 1.2.0 的 87 张卡、1.5.5 的 31 张闪卡不生成运行时球员，原样保留在 `docs/roster-provenance.json`。

## 3. 其它字段

- `id`：p01–p16 保持不变；p17 起按源 master 顺序（player_id 升序）顺次编号，跳过已关联的 5 名源球员。
- `name` = 源 `game_name`；`aliases` = 源 `game_name_aliases`（不覆盖 `name`）；`nameSource` = `source:players.json#<player_id>`。
- `srcId`：源 player_id；p06–p16 无源对应，为 `null`。`srcPosition`：源位置原值。`rarity`：源 `rarity_code`（数值）。
- `position`：ST→FW、CM→MF、DC→DF（源 master 只有这三种，没有 GK）。
- `quality`：p17 起按约定 1 white / 2 green / 3 blue / 4 purple / 5、9 orange 映射——这是约定，不是源值（未恢复源的颜色语义）；运行时代码不读取 quality。
- `srcSkill`：源 1.5.5 普通卡的技能族名（`skill_parameters_1_5_5.json` 的 `chineseSkillname`）；无技能为 `null`。

## 4. 技能占位

- `skill` 取 `data/skills.json` 里的 id（p01–p16，rebuilt 效果）、`unimplemented`（源卡有技能族，效果未实现）或 `none`（源卡无技能）。引擎对未知 id 取 `null`，等同无技能。
- 新球员不按名称自动绑定已实现技能：名称相同不能证明参数相同（RULE-02 / RULE-03 未知）。技能族的原始行（duration、triggerPerList、条件列表、解锁等级）保留在 `docs/roster-provenance.json`。

## 5. 既有球员 p01–p16

- 只追加：p01–p16 的 `id / name / nameSource / position / quality / attrs / growth / skill` 保持不变，只新增上述附加键。
- p01–p05 按名称关联源球员 40108 / 40208 / 90002 / 20102 / 30103（早期恢复标记 recovered:S03 / S04）：保留 rebuilt 数值，源推导值与差异记录在 `docs/roster-provenance.json` 的 `derived`。p06–p16 无源对应。
