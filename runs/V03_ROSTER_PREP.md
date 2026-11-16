# V0.3 全量人物导入 · 数据底账与避坑指南

> 巴蒂 2026-11-15 15:4x 并行摸底，**只做只读统计，未改动任何运行时数据文件**。
> 目的：接力会话进 V0.3 时直接照此导入，省去重新翻资料包的时间。
> 硬要求：保留原值、来源版本、冲突记录；**不编造缺失卡牌 / 属性 / 技能**。

## 1. 数据源清单（都在 `materials/pengzhuang_rebuild/02_players_and_data/`）

| 文件 | 规模 | 用途 | 关键字段 |
|---|---|---|---|
| `earlier_exports/players.json` | **106 人**（数组） | **人物主表 / 身份权威** | `player_id`, `game_name`, `game_name_aliases`, `real_name_original`, `real_name_english`, `club_original`, `club_cn`, `position`, `rarity_code`, `portrait_id`, `portrait_file`, `portrait_reference_for_generation` |
| `card_records.json` | **224 卡**（数组） | 卡牌数值主表 | `version`, `key`, `card_id`, `player_id`, `game_name`, `real_name`, `variant`, `rarity`, `position`, `weight`, `power`, `mind`, `radian`, `precision` 等 |
| `earlier_exports/cards_1_5_5.json` | 137 卡 | 1.5.5 版本数值对照 | `id`, `name`, `club`, `rare`, `position`, `weight`, `power`, `mind`, `radian`, `precision`, `growOrder`, `growPer`, `skillUnlockLv` |
| `earlier_exports/players_1_2_0.json` | 87 人 | 1.2.0 版本对照 | 同上 + `card_table_name`, `club_id` |
| `language_player_names.json` | 196 条 | 中英游戏名映射 | `version`, `key`, `chinese_game_name`, `english_game_name` |
| `parameter_conflicts.json` | **20 条** | **版本冲突与裁决，必须保留** | `version`, `card_id`, `player_id`, `game_name`, `variant`, `fields`, `card_values`, `level1_values`, `resolution` |
| `issues.json` | **8 条** | 已知问题与待办 | `id`, `type`, `subject`, `finding`, `status`, `action`, `source` |
| `field_dictionary.json` | 118KB | 字段含义字典（映射依据） | — |
| `field_interpretation.json` | 20 条 | 字段解释 | — |
| `earlier_exports/level_attributes_1_2_0.json` / `_1_5_5.json` | 176KB / 274KB | 等级属性曲线 | — |
| `earlier_exports/skill_parameters_1_5_5.json` | 110KB | 技能参数 | — |
| `level_records.json` | 641KB | 等级记录 | — |
| `portraits/1.2.0/*.png` | 头像图 | 美术来源 | — |
| `contact_sheets/players_001_024.jpg` … `097_106.jpg` | 5 张 | 001–106 全覆盖核对图 | — |
| `reference_tables/1.2.0/*.json` | 多表 | 原始参考表（每表 11 个顶层键） | `card.json`, `card_attr.json`, `cardlevel.json`, `factor.json` 等 |

## 2. 现有目标结构（`data/players.json`）

```jsonc
{
  "version": "players-1",
  "note": "...",
  "attributes": { "weight": "...", "power": "...", "curve": "...", "accuracy": "...", "mental": "..." },
  "attributesSource": "...",
  "players": [
    { "id": "p01", "name": "梅球王", "nameSource": "recovered:S04",
      "position": "FW", "quality": "orange",
      "attrs": [52, 74, 86, 84, 80], "growth": [1, 2, 3, 2, 1], "skill": "king" }
  ],
  "mapping": {
    "massMul": [0.85, 1.25], "speedMul": [0.92, 1.08],
    "curveMul": [0.6, 1.4], "aimAssist": [0.45, 1],
    "attrMin": 40, "attrMax": 99
  }
}
```

当前 **16 人**。`data/skills.json` 有 **13 个技能**（`skills` 数组）+ `legend` / `triggers`。

## 3. 必须避开的坑

1. **字段不是一一对应**。源是 `weight / power / mind / radian / precision`，目标是 `weight / power / curve / accuracy / mental`。**先查 `field_dictionary.json` + `field_interpretation.json` 再映射，禁止凭字面猜**；映射规则要写进 `docs/` 并在每条记录留来源版本。
2. **冲突不许静默取值**。`parameter_conflicts.json` 的 20 条已带 `resolution`，导入时按裁决执行并保留 `card_values` / `level1_values` 双份原值与版本号；`issues.json` 的 8 条按 `status` 逐条标注，不要当成完成。
3. **数值边界**：`attrs` 每项须落在 `mapping.attrMin=40` ~ `attrMax=99`。越界要 clamp 并**记录原值与 clamp 原因**，不能悄悄改数。
4. **技能只许引用已实现的 13 个 id**。源里的 `skillUnlockLv` / `skill_parameters_1_5_5.json` 中未实现的技能，一律标 `unimplemented` + 占位说明，**不得写成已完成**（任务书第 6 节硬要求）。
5. **`nameSource` 保留可溯源标记**，沿用现有 `recovered:S04` 风格；别名放 `game_name_aliases` 单独字段，不要覆盖 `name`。
6. **改 `version` 会连锁影响校准**。`GameData.version` 由 `field-2/phys-2/players-1/skills-1/rules-1` 拼成，players 版本号一变，服务端 `configVersion` 与开局锁定值全变。**导入后必须实跑**：
   ```
   npm run typecheck
   npm run test:physics      # 14/14，防线
   npm run calibrate         # phys-2 校准目标不得回归
   npm run test:net          # configVersion 变化后客户端/服务端必须仍一致
   ```
   若校准回归，优先保持数值映射规则不变、只扩人数，不要改 `mapping`。
7. **美术覆盖不全要如实标注**。`art/cutout/` 只有 16 张，`portraits/1.2.0/` 有更多原始头像。106 人导入后不可能每人都有 cutout，缺图的用占位/复用皮肤并在文档列出清单，**不伪造素材**。

## 4. 建议导入顺序

1. 读 `field_dictionary.json` / `field_interpretation.json`，产出一份「源字段 → 目标 attrs 下标」的映射表（写进 `docs/roster-mapping.md`）。
2. 以 `earlier_exports/players.json` 的 106 人为身份主表，按 `player_id` 关联 `card_records.json` 的 224 卡（一对多，保留 `variant`）。
3. 套用 `parameter_conflicts.json` 的 20 条 `resolution`，生成数值。
4. 保留现有 16 人 id（`p01`…`p16`）不变，只往后追加，避免破坏已有存档/阵容引用。
5. 写 `docs/roster-audit.md`：人数、卡数、来源版本、冲突处理、未实现技能清单、缺图清单。
6. 实跑第 3 节第 6 点的四条命令，把原始结果贴进 `runs/HANDOVER_V03.md`。

## 5. 状态

- 本文件是**只读调研产物**，不参与运行时加载，不与 A/B/C/D/E 阶段任何文件冲突。
- `data/players.json` **尚未改动**，仍是 16 人；V0.3 由接力会话在 V0.2 验收后执行导入。
