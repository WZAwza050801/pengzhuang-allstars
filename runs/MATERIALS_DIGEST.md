# 材料包全量摸底摘要（巴蒂 2026-11-15 23:10 实测）

> 目的：让后续每个会话**不用重新调研** `materials/pengzhuang_rebuild/`（591 条目、含 4.8MB 的 index.html）。
> 所有数字均为实测，非估计。源文件**不可修改**，只能读。

## 0. 材料包根信息

- 压缩包原文：`D:\ai_for_games\碰撞全明星复刻\pengzhuang_rebuild.zip`（591 entries）
- 已解压到：`D:\ai_for_games\碰撞全明星复刻\materials\pengzhuang_rebuild/`
- 目录：`01_game_research` / `02_players_and_data` / `03_art` / `04_frontend` / `05_online` / `06_physics` / `07_ai_handoff` / `08_sources_and_checks`
- **原始开发提示词全文**：`07_ai_handoff/REBUILD_PROMPT.md`（7.6KB，用户本人写的验收标准，最高权威）
- 开发顺序：`07_ai_handoff/MILESTONES.md`（7 步，**均标注"当前状态均未实现"**）
- 入口说明：`07_ai_handoff/START_HERE.md`
- 校验：`08_sources_and_checks/verification.json`、`SHA256SUMS.txt`、`workbook_verification.json`
- 数据总册（4.8MB HTML，**不要读**）：`02_players_and_data/index.html`
- 调研报告（4.2MB HTML，**不要读**）：`01_game_research/research.html`

## 1. `02_players_and_data` — 数据核心（已消化 vs 未消化）

| 文件 | 规模 | 内容 | 消化状态 |
|---|---|---|---|
| `earlier_exports/players.json` | 106 条 | 人物基础值（weight/power/mind/radian/precision） | ✅ 已导入 `data/players.json`（117 条，含 p01–p16 原手绘） |
| `level_records.json` | **2250 条** | 每张卡每级的 5 项属性 | ❌ **未消化（T4-a）** |
| `card_records.json` | **224 条** | 卡牌变体/稀有度/技能/解锁等级 | ❌ **未消化（T4-b）** |
| `skill_records.json` | **511 条** | 技能完整参数 | ❌ **未消化（T4-c）** |
| `skill_links.json` | **547 条** | card↔skill 关联 + unlock_level | ❌ **未消化（T4-c）** |
| `catalog.json` | 108 条 | 人物完整元数据（俱乐部/位置/别名/头像哈希） | ❌ 未消化 |
| `formations.json` | 90 条 | 阵型（10 种名称） | ❌ **未消化（T4-e）** |
| `factors.json` | 110 条 | 系数（Guild_/Arena_/Test_ 前缀，多为样例） | ❌ 未消化 |
| `parameter_conflicts.json` | 20 条 | card 值 vs card_attr 等级 1 的冲突 | ⚠️ 已记录 88 条 clamp，但**这 20 条冲突本身要单独保留** |
| `issues.json` | 8 条 | 待确认问题 | ❌ 未消化 |
| `field_dictionary.json` | 118KB | 字段字典（映射表来源） | ⚠️ 只能用 `node -e` 抽样 |
| `field_interpretation.json` | 20 条 | 表头字段含义 | ❌ 未消化 |
| `language_player_names.json` | 196 条 | 中英游戏名对照 | ❌ 未消化 |
| `version_comparison.json` | 87 条 | 1.2.0 vs 1.5.5 差异 | ❌ 未消化 |
| `table_inventory.json` | 106 条 | 原始配置表清单（哪些已纳入） | ❌ 未消化 |
| `reference_tables/{1.2.0,1.5.5}/` | 92 张表 | 原始字段字符串（**空字符串不是 0**，分号列表保序） | ❌ 未消化 |
| `generation_jobs.jsonl` | 106 行 | 用户批量重绘头像的生图任务（含每人提示词） | ❌ 未消化 |
| `pending_generation_jobs.json` | 1 条 | **小罗 40109**，待用户确认，不进正式批次 | ⚠️ 保持标记 |
| `pengzhuang_reference.xlsx` | 261KB | Excel 总表（人物/卡牌/等级/技能/冲突/来源） | ❌ 未消化 |
| `workbook_payload.json` | 11 表 | xlsx 的结构化内容 | ❌ 未消化 |
| `provenance.json` | — | 源文件包名/版本/下载来源/MD5-SHA256 | ❌ 未消化 |
| `earlier_exports/player_portrait_mapping.csv` | 106 行 | player_id→portrait_id→俱乐部→位置→card_variant_ids | ❌ **高价值未消化** |
| `earlier_exports/skill_parameters_1_5_5.json` | 297 条 | 1.5.5 技能参数原始表 | ❌ 未消化 |
| `earlier_exports/level_attributes_1_2_0.json` / `_1_5_5.json` | — | 等级属性原表 | ❌ 未消化 |
| `earlier_exports/cards_1_5_5.json` | — | 卡牌原表 | ❌ 未消化 |
| `earlier_exports/portrait_frames_{1.2.0,1.5_5}.json` | — | 头像图集切片坐标 | ❌ 未消化 |
| `earlier_exports/verification.json` | — | 早前导出校验 | ❌ 未消化 |

### 关键字段样本（照抄，不要猜）

`earlier_exports/players.json` 单条：
```json
{"player_id":"10101","game_name":"马少尔","game_name_aliases":[],"real_name_original":"安东尼·马歇尔",
 "real_name_english":"Anthony Martial","english_name_key_original":"PlayerName_Anthony_Martial", ...}
```

`level_records.json` 单条（**同一 card 有多条 level**）：
```json
{"version":"1.2.0","card_id":"10101","player_id":"10101","attribute_row_id":"1010101","game_name":"马少尔",
 "level":1,"weight":34,"power":51,"mind":53,"radian":55,"precision":47,"card_record_present":true}
```
- 每人 **20 或 30 条**（10102 有 30 条），`max level = 10`。
- 同一 card_id 在同一 level 上**可能出现两条**（1.2.0 与 1.5.5 双版本并存），导入时按 `version` 区分，**不要直接覆盖**。

`card_records.json` 单条：
```json
{"version":"1.2.0","key":"1.2.0|10101","card_id":"10101","player_id":"10101","game_name":"马少尔",
 "real_name":"安东尼·马歇尔","variant":"普通卡","rarity":3,"position":"ST",
 "weight":34,"power":51,"mind":53,"radian":55,"precision":47,
 "skills":"10;11;12","unlocks":"3;6;10","foil":"","normal":"","flash_skills":"",
 "icon":"head_1001_10101","source_line":3}
```
- `skills` / `unlocks` 是**分号列表**。

`skill_records.json` 单条：
```json
{"version":"1.2.0","skill_id":"10","name":"疾风金童","level":1,"rarity":3,"extra":"",
 "trigger_condition":"14","conditions":"14;3","probabilities":"10","target":"0",
 "effects":"11","values":"10","duration":3,"stacks":1,"description":"我方回合开始时10%几率触发，..."}
```
- ⚠️ `probabilities` 是**列表**（`triggerPerList`），**不是单个概率**，不能相乘。
- ⚠️ `duration` 是原始计数，**不是秒**。
- ⚠️ `effects` / `values` 是 ID 引用，语义在 `field_dictionary.json` / `reference_tables`。

`skill_links.json` 单条：
```json
{"version":"1.2.0","card_id":"10101","player_id":"10101","game_name":"马少尔",
 "type":"普通技能","skill_id":"10","skill_level":"1","unlock_level":"3","skill_name":"疾风金童","found":true}
```

`formations.json` 单条（**坐标格式 `位置;x%;y%`**）：
```json
{"version":"1.2.0","kind":"比赛阵型","id":"10001","name":"2_2_1(A)",
 "positions":["ST;35:50","ST;65:50","CM;20:50","CM;80:50","DC;50:50"],
 "ball":"","req_level":1,"available":""}
```
- 90 条，10 种不同 name；`available` 只有 9 条为 `"1"`，其余 81 条为 `""`（空字符串 ≠ 0）。
- ⚠️ 训练坐标与比赛阵型坐标格式不同，原点/缩放未验证 —— **先验 1 套再批量**。

`catalog.json` 单条：
```json
{"player_id":"10101","game_name":"马少尔","game_name_aliases":[],"real_name_original":"安东尼·马歇尔",
 "real_name_english":"Anthony Martial","english_name_key_original":"PlayerName_Anthony_Martial",
 "english_game_name":"Marshall","club_original":"Manchester United","club_cn":"曼联","position":"ST",
 "rarity_code":3,"portrait_id":"head_1001_10101","portrait_file":"portraits/1.5.5/head_1001_10101.png",
 "portrait_reference_for_generation":"portraits/1.2.0/head_1001_10101.png","reference_version":"1.2.0",
 "portrait_size":[194,188],"portrait_sha256":"47bb9797...","first_recovered_in":"1.2.0","card_variant_ids":["10101"]}
```

### ⚠️ 不可忽略的 4 条差异（REBUILD_PROMPT.md 明确点名）

1. **20 条 card 基础值 ≠ 同卡 1 级属性** —— `parameter_conflicts.json`。建议取 1.5.5 等级 1 作复刻策略，但**不能声称是原版优先级**。
2. **早期齐祖 90001** —— 1.2.0 等级表有 10 行数据，卡表和头像里却没有对应记录。保留，不认定已上线。
3. **小罗 40109** —— 有头像 `head_4001_40109` 和语言表记录，但**无卡表关联**，用户未确认，**不编造属性**，不进正式批次。
4. **耳帝原名冲突** —— 原表写 `Nicolas Burdisso`，俱乐部填加拉塔萨雷，官方 2014-02-03 公告是 `Guillermo Enio Burdisso`。两者作为**独立证据保留**，显示名不自动纠正。

### 数值语义红线
- `weight` 是属性点，**不是 kg**；`power` 不是 N；`radian=70` 不是 70 弧度也不是 70 度；`precision` 不是已证实的命中概率。
- 源值保持原样；属性点→实际速度/质量/曲率的映射另建配置，记录依据与测量结果。

## 2. `03_art` — 美术资产（**原版素材全在，尚未接入**）

### 2.1 原版头像 —— 最高价值
- 路径：`materials/pengzhuang_rebuild/02_players_and_data/portraits/{1.2.0,1.5.5}/`
- **194 个 PNG**（1.2.0 有 87 个，1.5.5 有 107 个），尺寸 **194×188 透明 PNG**
- 1.5.5 版 107 张 = 106 位正式球员 + 1 张小罗候选，**全覆盖率 106/106**
- 命名：`head_<cardGroup>_<playerId>.png`，例 `head_1001_10101.png`
- 现项目用的是 AI 重绘头像（`client/public/assets/players/*_avatar.png`），**原版图更有价值** → 做原图/重绘切换（REBUILD_PROMPT.md 原始要求）
- 尺寸不同（194×188 vs 512×512）**分别配置留白，不横向拉伸**

### 2.2 五套球场原图
- `03_art/original_images/1.5.5/texture/Scenes_01.jpg` — `Scenes_05.jpg`（1.2.0 版同样 5 张）
- `image_inventory.json`（90 条）记录了每张的 `file` / `sha256` / `bytes` / `width` / `height`
- 现有 `data/fields.json` 的 geometry 注释显示 Scenes_01.jpg 是 **1440×1920**，白色边墙内沿 956×1559 px（长宽比 1.63）—— **几何已从这张原图量过**
- ⚠️ **换皮只改画面，不改碰撞几何**；原图边界不自动当碰撞墙

### 2.3 其他精灵
- `03_art/selected_sprites/1.2.0/`（8 个）：`Goal_01.png` (1054×203)、`Goal_02.png`、`Goal_03.png`、`Guide_Arrow.png`、`Lv_Background.png`、`Tab_Background.png`、`Tab_Background_Shadow.png`、`ballBg.png` (64×64)
- `03_art/selected_sprites/1.5.5/`（6 个）：`Goal_01.png` (1054×203)、`Goal_03.png`、`Guide_Arrow.png`、`Lv_Background.png`、`Tab_Background.png`、`Tab_Background_Shadow.png`
- `03_art/original_images/1.5.5/atlas/`：`Badge.png`、`PlayerSkin.png`、`ShopIcon.png`、`Skin.png`、`skillIcon.png` —— 按 `sprite_frames.json` 切片
- `03_art/sprite_frames.json`：`{"1.2.0": 696 条, "1.5.5": 885 条}`，每条含 `texture`(UUID) / `rect` / `offset` / `originalSize` / `rotated`，**有时有 `texture_file`**
- `03_art/image_inventory.json`：两版来源映射 + SHA-256，相同字节只存一份，用 `file` 字段定位
- ⚠️ `football` 纹理是**展开的纹理图**，不是已渲染的立体足球，不能直接当球用
- `03_art/original_images/*/texture/` 还有 `Goal_00.png`、各种 `Anim_*`、`ID_*`、`Image_*`、`Activity_*` 等杂项
- `01_game_research/assets/`（19 张 2016 官方截图 JPG）、`01_game_research/references/`（10 张：4 PNG + 6 JPG，含 `taptap_original_*.jpg` 与 `club_press_*.png`）—— **球门开口 0.34 场宽就是从 `taptap_original_3.jpg`（1242×2208）量出来的**
- `02_players_and_data/contact_sheets/players_001_024.jpg` … `players_097_106.jpg`（5 张联系表）—— 快速目视核对

## 3. `01_game_research` — 调研

| 文件 | 内容 |
|---|---|
| `CURRENT_FINDINGS.md` (3.2KB) | **必读**，已核实事实清单 |
| `facts.json` (3.9KB) | 关键事实 |
| `rebuild_brief.md` (5.9KB) | 复刻简报 |
| `prototype_settings.json` (1.4KB) | **原型建议参数**（明确标注"不是恢复出的原版数值"） |
| `image_sources.json` (13KB) / `reference_sources.json` (4.4KB) / `sources.json` (6.8KB) | 来源清单 |
| `screenshots.csv` (6KB) / `sources.csv` (4.9KB) | 素材索引 |
| `video_reference.json` | 视频参考 |

`prototype_settings.json` 关键值（**是建议值不是原版值**，但比我们自己拍的靠谱）：
```json
"prototype_assumptions": {"target_goals":3,"formation":"2-2-1","goal_reset":"先重置双方为初始阵型","next_kickoff":"暂由失球方开球"},
"simulation_suggestions": {"fixed_step_seconds":0.008333333333333333,"field_width_units":1.0,"field_length_units":1.65,
 "goal_width_units":0.28,"player_radius_units":0.033,"ball_radius_units":0.018,"player_mass":1.0,"ball_mass":0.5,
 "max_launch_speed_units_per_second":1.8,"linear_drag_per_second":1.2,"wall_restitution":0.8,"disc_restitution":0.9,
 "sleep_speed_units_per_second":0.012,"sleep_hold_seconds":0.25}
```
> 🔑 **对 T3 球门宽度极有用**：`goal_width_units 0.28 / field_width_units 1.0` = **球门开口 ≈ 28% 场宽**。
> 现行 `goalWidth = 2.05 m`，场宽 6.0 m → **34.2% 场宽**。这与"安安说门偏大"的直觉一致，且现在**有了来源依据**，不再是拍脑袋。
> T3 时把 34.2% → 28% 作为首选候选（goalWidth ≈ 1.68 m），连同 1.90 / 1.80 / 1.65 一并做对比。

## 4. `04_frontend` / `05_online` / `06_physics` — 技术方案（**尚未逐条对照实现**）

### `04_frontend/data_contracts.ts`（2.6KB，设计草案）
关键类型：`RawAttributes{weight,power,mind,radian,precision}`、`ResolvedCard{playerId,cardId,sourceVersion,sourceTable,sourceLevel,selectionReason,original,portraitId,skillIds}`、`ShotRequest{matchId,turnId,clientShotId,playerId,directionX,directionY,power01,curveMinus1To1,configVersion}`、`ShotResult{accepted|rejected}`、`PhysicsTuning{fixedStepSeconds,discRadiusU,ballRadiusU,maxLaunchSpeedUPerSecond,dragDecelerationUPerSecondSquared,discRestitution,wallRestitution,settleSpeedUPerSecond,settleDurationSeconds,maxMovingSeconds}`、`MatchSnapshot{...simulationTick,turnId,phase,activeTeamId,redScore,blueScore,turnDeadlineServerMs,discs,ball,acceptedShotId,rulesVersion,physicsVersion,rosterVersion}`。
`MatchPhase = "waiting"|"aiming"|"moving"|"goal"|"reconnecting"|"finished"`。
> 现项目的 `shared/protocol.ts` 大体覆盖但**字段命名不完全一致**（现用 `clocks` 而非 `turnDeadlineServerMs`）。T4 时逐条对照，**不要盲改协议**（会破坏 176 条 net 用例）。

### `05_online/PROTOCOL.md`（2.8KB）
消息表：`set_lineup` / `ready` / `shot` / `shot_result` / `state` / `match_event` / `reconnect_wait` / `rematch`。
- **`rematch`（再来一局）现项目未实现** —— C 阶段只做了私人房间 + 重连 + 投降 + 落盘。**T2-b/T4 时应补 rematch**。
- `match_event` 的 eventId 幂等、`reconnect_wait` 的缺席座位显示 —— 现项目可能没有对应的独立消息。
- 持久化记录清单：访客身份 / 阵容 / 对局 / 回合日志 / 检查点。现项目只落了部分。

### `06_physics/calibration_targets.json`（1.4KB）
```json
{"length_unit":"L=选定球场的有效长边","fixed_step_hz_starting_point":120,"snapshot_hz_starting_point":20,
 "seed":52016,"minimum_regression_shots":200,
 "targets":[
  {"id":"free_025","power01":0.25,"travel_L_min":0.15,"travel_L_max":0.25},
  {"id":"free_050","power01":0.50,"travel_L_min":0.35,"travel_L_max":0.50},
  {"id":"free_100","power01":1.00,"travel_L_min":0.80,"travel_L_max":1.00,
   "settle_seconds_min":2,"settle_seconds_max":3}]}
```
- **明确标注"复刻体验目标草案，未执行校准；不是原版测量值"**。
- 空场测量必须在**无边界大世界**测总路程（不是端点位移）。
- `06_physics/reference_measurements.csv` **只有表头没有数据行** —— 原版实测数据为空，**不要伪造测量值**。
- 俯视空场减速用**独立地面阻力**，不能只改碰撞 friction。
- Planck 的 bullet/CCD 要按最高速度与半径配置并**实测**。

## 5. `08_sources_and_checks`
`SOURCES.md`(10.7KB) / `sources.json`(11.5KB) / `verification.json` / `workbook_verification.json` / `SHA256SUMS.txt`(70KB)。
> 涉及合规与引用，做报告时可引用，但**不要把 hash 全文读进上下文**。

## 6. 与现项目的差距总表（T4 消化后应清零）

| 材料包资产 | 行/张数 | 现项目状态 |
|---|---|---|
| 人物基础值 | 106 | ✅ `data/players.json` 117 条 |
| 等级属性 | 2250 | ❌ 无（现在用基础值 + 自造 growth 倍率） |
| 卡牌变体 | 224 | ❌ 无 |
| 技能记录 | 511 | ❌ 只有 13 条在 `data/skills.json`，16 个已实现 |
| 技能关联 | 547 | ❌ 无 |
| 阵型 | 90 | ❌ 无 |
| 原版头像 | 107 | ❌ 用的是 AI 重绘 |
| 五套球场原图 | 5×2 版 | ❌ 现在是程序化重绘的 3 套皮肤 |
| 原版球门/球背景 sprite | 14 | ❌ 无 |
| 图集切片元数据 | 1581 | ❌ 无 |
| 系数表 factors | 110 | ❌ 无 |
| 参考配置表 | 92 张 | ❌ 无 |
| rematch 消息 | — | ❌ 未实现 |
| 冲突/待确认清单 | 20+8 | ⚠️ 部分（88 条 clamp） |
