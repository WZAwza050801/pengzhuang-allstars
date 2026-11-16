# HANDOVER_AR · 原版美术重建交接（安安 2026-11-16 09:30 指令后暂停）

> **本文档 = 恢复手册。** 任何新会话接手时，**第一步读本文档 + `runs/TASK_QUEUE.md` + `runs/PROGRESS_ALL.md`**，
> 然后从「§5 下一步」的第一个未完成项继续。**不要重复调研 `materials/`，不要重做已完成阶段。**
>
> **本文档同时记录安安 2026-11-16 09:30 的两条新指示**（见 §4），它们改变了后续美术方向。

---

## 0. 一页速览

| 项 | 状态 |
|---|---|
| 项目根目录 | `D:\ai_for_games\碰撞全明星复刻` |
| 当前主线 | **AR 原版美术重建已做完 AR-1～AR-5**。下一项回到 T4-c1 技能元数据，或等安安确认 AR-6 |
| 后台 watcher | **已停**（`autopilot_watcher_v5.sh` 于 08:59 因三连崩主动退出，无残留进程） |
| 恢复方式 | 见 §6 |
| 安安最新指示 | **图标要和原版一样**；**可能按原版美术风格继续增加球员和数值** |
| 唯一硬约束 | **图标（头像）= 原版原图**，不是重绘、不是 AI 生成 |

---

## 1. 安安的最新指示（2026-11-16 09:30）

> 原话：「我期望的图标是和原版一样的 可能还会按照原版的美术风格去增加一些球员和数值」

拆成两条可执行指令：

### 指令 A · 图标必须是原版原图

- **含义**：场上圆盘里的球员头像、大厅名单头像、卡面头像 —— 全部用**原版 1.5.5 的 `head_*.png` 原图**，
  **不做 AI 重绘、不做手绘替代、不做风格化处理**。只允许做**裁切与遮罩**（几何操作），不允许改像素内容。
- **这正是已固化的 D2**（`runs/DECISIONS.md`），AR-3 就是执行 D2。
- 已有对照样例：`runs/_diag/style_compare.png`（梅西 / C罗 / 大罗 四栏对照）。

### 指令 B · 后续可能按原版美术风格扩充球员与数值

- **含义**：AR 阶段做完后，可能还要**新增球员**（超出原版 106 人），新球员的**美术风格必须对齐原版**，
  **数值体系必须对齐原版**。
- **好消息**：材料包里带着**原厂自己重绘头像时用的提示词模板 + 逐人提示词**，这就是"原版美术风格"的权威规格：

  | 文件 | 内容 | 用法 |
  |---|---|---|
  | `materials/.../02_players_and_data/generation_prompt_template.txt` | 原厂头像重绘提示词模板（含"保留原版圆润夸张的大眼、清楚的眉眼和下颌轮廓，使用统一的精致卡通游戏头像画风、柔和明暗和清晰小尺寸轮廓"） | 新增球员的头像生成提示词，**照抄这个模板的结构与措辞**，只换 `{real} {english} {game} {id}` |
  | `materials/.../02_players_and_data/generation_jobs.json` | **106 条逐人提示词成品**（已把模板填好，含 `reference_image` 指向哪张原图） | 新增球员时照此格式生成 |
  | `materials/.../02_players_and_data/pending_generation_jobs.json` | 1 条待确认（小罗 40109） | 见下方纪律 |

- **数值的纪律（来自原厂 README 与 REBUILD_PROMPT 原文，硬性）**：
  > 「**没有编造任何属性**」/「**不编造数值**」
  >
  > 现有数值全部来自原版表：`level_records.json` 2250 条（1.2.0: 880 / 1.5.5: 1370），
  > `card_records.json` 224 张卡，`skill_records.json` 511 条技能 + `skill_links.json` 547 条关联。
  >
  > → **新增球员的数值必须标注来源**。三种可接受来源，写进 `docs/roster-provenance.json`：
  > 1. `original` — 原版表直接有（106 人走这条）
  > 2. `derived` — 从原版同位置/同稀有度球员按明确规则推导（规则写进 `docs/roster-mapping.md`）
  > 3. `designed` — 原创设计（**必须在报告里单列，标"非原版"**）
  >
  > **禁止**：把 `designed` 数值混进原版数值里不标注。

- **⚠️ 交接说明**：指令 B 的具体范围（新增多少人、哪些人、要不要新阵型/新技能）**安安尚未明确**。
  **不要自己定范围开干**。§5 把 B 列为"待确认"，恢复时先向安安确认再动。

---

## 2. 已完成阶段（**不要重做**）

| 阶段 | 状态 | 证据 |
|---|---|---|
| A 服务端骨架 / B 权威一杆球 / C 双端联机 / D 构建 / E 浏览器 E2E | ✅ | `runs/STAGE_{A,B,C}_DONE.md` |
| T1 一条命令一个地址 | ✅ | — |
| T2-a 名册 16→117 人 | ✅ | `runs/STAGE_T2a_DONE.md` |
| 美术 v2 头像 117/117（**Q 版重绘，待被原版替换**） | ✅ | `runs/avatars-all-117.png` |
| **AR-1 球场底图 ×5** | ✅ **2026-11-16 08:15** | `runs/STAGE_AR1_DONE.md` |
| **AR-3 原版头像 106 张** | ✅ **2026-11-16 10:00** | `runs/STAGE_AR3_DONE.md`。10:45 又删掉这 106 人的 Q 版文件，p06–p16 仍留着 |
| **AR-2 四角弹簧** | ✅ **2026-11-16 10:45** | `runs/STAGE_AR2_DONE.md` |
| **AR-4 双边门框** | ✅ **2026-11-16 11:00** | `runs/STAGE_AR4_DONE.md`。开口跟 `goalWidth`（现 2.05 m） |
| **AR-5 游戏 UI** | ✅ **2026-11-16 11:08** | `runs/STAGE_AR5_DONE.md`。技能图标和俱乐部徽章未接 |
| T4-a 等级成长 2250 条 → `data/levels.json` | ✅ | `runs/STAGE_T4a_DONE.md` |
| T4-b 卡牌变体 224 条 → `data/cards.json` | ✅ | `runs/STAGE_T4b_DONE.md` |

### AR-1 的关键修正（**Opus 原方案是错的，已修，别改回去**）

- Opus 原写裁剪 `[242,180,1198,1739]` → **上下偏移 63px**，顶部混入广告板、底部切掉底线。
- 正确：原图 `x[242,1198]`、`y[top, top+1559]`，`top` 逐套 **243/244/244/245/246**。
- **底图纵向、不旋转**（项目同为竖向）。施工单里"旋转 90°"那条是错的。
- **有底图时必须跳过程序化草皮与白线**（原图自带，否则双线）。
- 验证：原图中线换算 4.89 m、中圈 3.89/5.89 m，与物理几何完全吻合。

---

## 3. 未完成阶段（队列顺序）

### 3.1 AR 主线（当前最高优先级）

| ID | 任务 | 状态 | 关键要点 |
|---|---|---|---|
| **AR-1** | 球场底图 ×5 | ✅ DONE | 见 §2 |
| **AR-2** | 四角弹簧 ×4 | ✅ **2026-11-16 10:45** | 见 `runs/STAGE_AR2_DONE.md`。`spring_corner.png` 贴四角，受击压缩。`cornerCut` 未动 |
| **AR-3** | 球员头像 106 张 | ✅ **2026-11-16 10:00** | 见 `runs/STAGE_AR3_DONE.md`。10:45 删掉这 106 人的 Q 版文件和切换开关；p06–p16 仍用 `players/`。`head_4001_40109` 未入库 |
| **AR-4** | 双边门框 | ✅ **2026-11-16 11:00** | 见 `runs/STAGE_AR4_DONE.md`。开口 = `goalWidth`（现 2.05 m），石墙 + 淡网 + 端头盘簧 |
| **AR-5** | 游戏 UI | ✅ **2026-11-16 11:08** | 见 `runs/STAGE_AR5_DONE.md`。大厅和 HUD 已换原版切片。技能图标和俱乐部徽章未接 |

> **AR-5 依赖技能数据（技能图标）**，所以 T4-c 排在 AR-5 之后是天然顺序。
> 若 T4-c 要提前，得先确认技能图标不依赖 skill_id 映射。

### 3.2 T4 材料包剩余

| ID | 任务 | 状态 | 备注 |
|---|---|---|---|
| **T4-c1** | 511 条技能元数据 + 547 条关联 → `data/skills.json`（不接执行器） | ⬜ | 已从 T4-c 拆出（因连续 2 次 "Prompt is too long"） |
| **T4-c2** | 技能效果执行器接入 `shared/` | ⬜ | |
| **T4-d** | 原版头像 107 张 + 五套球场接入 + 切换开关 | ⬜ | **已被 AR-1 / AR-3 覆盖并提前，AR 完成后直接勾掉** |
| **T4-e** | 阵型 90 套 → `data/formations.json` + 开局可选（先验 1 套） | ⬜ | D7：**不换默认阵型**，保 176 条 net 基线 |
| **T4-f** | `docs/materials-import-report.md` 导入报告 + 冲突清单 | ⬜ | D5：20 条冲突取 1.5.5 等级 1，注明「复刻策略非原版优先级」；D6：小罗 40109 / 齐祖 90001 不进正式名单 |

### 3.3 T2 V0.3 剩余

T2-b 快速匹配 · T2-b2 rematch · T2-c 五套皮肤（AR-1 已铺路）· T2-d 移动端 · T2-e 公网部署**方案文档**（不执行）

### 3.4 T3 球门宽度（最后做）

D1 已由安安拍板 **1.68 m（28% 场宽）**，物理 + 视觉都改。`data/fields.json` `geometry.goalWidth` 2.05 → 1.68，
`field-2` → `field-3`。必须实跑 `typecheck → calibrate → test:physics → test:net → build → test:e2e → online-e2e`（≥3 轮），
**前后 30 场进球率对照写进 DONE**。物理回归 FAIL 则回退 2.05 并如实记录，**不许弱化断言**。

---

## 4. 关键实现细节

### 4.1 AR-3 头像接入（= 安安指令 A）—— ✅ 已完成，细节见 `runs/STAGE_AR3_DONE.md`

**数据链路**：
```
data/players.json 的 srcId
  → materials/.../earlier_exports/player_portrait_mapping.csv 的 player_id 列（表头带 BOM，必须 utf-8-sig）
  → 同表 portrait_id 列（如 head_4001_40108）
  → materials/.../02_players_and_data/portraits/1.5.5/{portrait_id}.png
```
- csv 106 行，每行 `portrait_id` 对应文件**全部存在（0 缺失）**。
- 原版头像尺寸 **194×188 RGBA**，alpha 内容框只占画布 **40–46%**（四周透明）。
- **裁切要领**：按 alpha 内容框裁 → **按短边留白（约 6%）** → 套圆形遮罩。
  直接把整张 194×188 套圆会把下巴/头顶硬切出白边（这是最容易做错的一步）。

**已完成的原型**：`art/preview_style.py` → `runs/_diag/style_compare.png`
（脚本只写 `runs/_diag/`，不碰 `client/public`，可安全复用做 AR-3 的裁切/遮罩实现）

**覆盖率**：117 人中 **106 人有原版头像**。缺原版的 11 人是 **p06–p16**（`坦克哥/门神/卷毛狮/鲁大师/卤蛋/丸子头/脏辫侠/红毛/金毛/飞猫/大胡子`），
它们**没有 `srcId`**（项目自造角色，原版无此人）。
→ 按已固化 D3：**回退到现有 `client/public/assets/players/pXX_avatar.png`，绝不出现灰饼 `#dde6ee`**。

**渲染层改造点**（`client/src/render.ts`）：
- 现在 `avatar(playerId)` 固定读 `/assets/players/${playerId}_avatar.png`。
- 改成：优先读 `players_original/{portraitId}.png`，失败回退 `players/${playerId}_avatar.png`。
- 开关放 `data/fields.json` 或新建 `data/settings.json`：`"portraitStyle": "original" | "redrawn"`，**默认 original**。
- 圆盘绘制逻辑（`render.ts` 约 498–520 行）本身不用改，只是喂进去的图变了。

### 4.2 AR-2 四角弹簧

- 诊断图已备好（在 `runs/_diag/`，**人眼看，别让 Opus Read**）：`c_tl/c_tr/c_br/c_bl.png`（四角放大）、`goal_top.png`、
  `goal_mouth_area.png`、`goal_ruler.png` / `goal_ruler2.png`（带像素标尺）、`ui_sheet.png`、`atlas_head_half.png`。
- 原版四角是**斜切角 + 蓝灰金属盘绕弹簧 + 内侧沙土坡**，尺寸不一（0.06–0.09 场宽），物理 `cornerCut` 取 0.5 m。

### 4.3 素材坐标与实测值（**别重算，直接用**）

| 项 | 值 |
|---|---|
| 原版球场原图 | `Scenes_01..05.jpg` 1440×1920 |
| 可玩区 | 956×1559 px（x 242..1198），对应 6.0 m × 9.78 m |
| 中线 / 中圈 | 4.89 m / 3.89 m 与 5.89 m |
| 五套底图 top | 243 / 244 / 244 / 245 / 246 |
| 球门开口 | 原图底图 ~38% 场宽；物理 **1.68 m = 28%**（冲突 → 程序化画） |
| 原版头像 | 194×188 RGBA，1.5.5 有 107 张，1.2.0 有 87 张 |
| 原版 UI 图集 | `atlas/Skin.png` 2048×2048 |

### 4.4 材料包全貌（`runs/MATERIALS_DIGEST.md` 是唯一权威，别再摸底）

| 数据 | 量 | 位置 |
|---|---|---|
| 等级属性 | **2250** 条（1.2.0: 880 / 1.5.5: 1370），106 人 | `02_players_and_data/level_records.json` |
| 卡牌 | **224** 张（1.2.0: 87 / 1.5.5: 137） | `card_records.json` |
| 技能 | **511** 条元数据 + **547** 条关联 | `skill_records.json` / `skill_links.json` |
| 阵型 | **90** 套 | `formations.json` |
| 头像 | 107 张 | `portraits/{1.2.0,1.5.5}/head_*.png` |
| 头像生成任务 | **106** 条逐人提示词 | `generation_jobs.json` + `generation_prompt_template.txt` |
| 冲突 | 20 条卡牌 vs card_attr | `parameter_conflicts.json` |

---

## 5. 下一步（恢复后按此顺序）

**立刻可做（无歧义）**：

1. ~~**AR-3 球员头像**~~ ✅ 2026-11-16 10:00。Q 版文件已于 10:45 删除（p06–p16 保留）。
2. ~~**AR-2 四角弹簧**~~ ✅ 2026-11-16 10:45（`runs/STAGE_AR2_DONE.md`）。
3. ~~**AR-4 门框**~~ ✅ 2026-11-16 11:00（`runs/STAGE_AR4_DONE.md`）。
4. ~~**AR-5 游戏 UI**~~ ✅ 2026-11-16 11:08（`runs/STAGE_AR5_DONE.md`）。
5. 回到 **T4-c1** 技能元数据。技能图标要等 id 对上再接。

**需先向安安确认**：

6. **指令 B 的范围** —— 新增多少球员？哪些人（现有 106 原版球员 + 小罗候选 40109 + 卡队仅名字的卡瓦略 + p06–p16 自造角色）？
   新数值走 `derived` 还是 `designed`？是否要新阵型/新技能？
7. **T3（1.68 m 球门）** 是否仍排在最后。
8. **T2-e 公网部署** 选型（只出方案文档，不执行）。

**完整基线**（改动后必须保持全绿）：
```
npm run typecheck        → exit 0
npm run test:physics     → 15/15
npx tsx tools/net-tests.ts   → PASS=176 FAIL=0
npm run build            → exit 0
npm run test:e2e         → PASS=7 SKIP=0 FAIL=0
npx tsx tools/online-e2e.ts  → PASS=17 FAIL=0
```

---

## 6. 恢复手册（照做，别自由发挥）

### 6.1 启动 watcher

```bash
cd /d/ai_for_games
bash autopilot_watcher_v5.sh          # 后台跑，日志 runs/WATCHER_V5.log
```

### 6.2 **v5 watcher 的已知失效模式（务必读）**

**症状**：`Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row.`
→ 会话开跑 10–15 分钟后必崩，`runs/v5-*.log` 只有 258 字节，watcher 连续 3 次 stagnant 后 `STOP` 退出。

**实测诊断（2026-11-16 09:30 巴蒂分析崩溃会话 transcript）**：

- 崩溃会话**只用了 10 次工具调用**，最大单条工具结果 **14.5 KB**（读 `ART_REBUILD_SPEC.md`）——**不是单个文件过大**。
- 崩溃前 usage：`cache_read 70,322 + cache_creation 41,370 ≈ 111,692` tokens。
  **`CLAUDE_CODE_AUTO_COMPACT_WINDOW` 被设成了 120000**，而会话起始就已占 ~111K
  （system prompt + MCP 工具定义 + skills + 15 KB prompt 文件），**只剩 ~8K 可用**。
- 第三次 compact 时仅 431 output tokens 就再次把窗口填满 → 连续 3 次触发 thrashing 判定 → 自杀。
- 另一个放大因素：`settings.json` 里 `MAX_THINKING_TOKENS=4096` + `CLAUDE_CODE_EFFORT_LEVEL=max`，
  单轮输出可达 6,693 tokens，一次思考就把剩余窗口吃掉大半。

**结论：这是压缩窗口设置过低 + 起始上下文太重，不是「读了图片」。**
（早前认为「读图片 base64 485KB」是真凶 —— 那是 AR-1 阶段的真凶且已修，
但 **AR-2 阶段的三连崩是另一个原因**：prompt 文件 15 KB + MCP 工具定义把起始上下文推到了 111K。）

**建议修法（恢复时优先做，一行改动）**：
`~/.claude/settings.json` 里把 `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 从 `120000` **调回 `180000`（或更高）**，
让起始 111K 的会话有 ~70K 呼吸空间。同时可把 `MAX_THINKING_TOKENS` 降到 `2048`、effort 从 `max` 降到 `high`
以减少单轮输出体积。

**同时建议（降低每次启动的重负）**：
- `RESUME_V5.prompt.md` 现 15.7 KB，其中 §2「T4 材料包消化」占大头，**而 AR 阶段完全用不到** → 拆成
  `RESUME_V5_AR.prompt.md`（只含 AR 部分，~5 KB）与 `RESUME_V6_T4.prompt.md`（T4 部分）。
- 还可以加 `--strict-mcp-config` 或临时禁用 MCP servers，进一步砍掉工具定义的 token 占用。

**不改设置也能继续的办法**：把 `MAX_TOOL_CALLS` 从 75 降到 **30**，并在会话开始就让 Opus 先写文件再读文件
（减少工具结果在上下文里的重复累积）。

### 6.3 会话铁律（沿用 v5 提示词，未变）

1. 直接干活，不重新规划、不输出计划后停下、不请求确认。
2. **一个子任务 = 一个 checkpoint = 一个干净会话**。只做队列里排在最前的一个未完成项。
3. 每个子任务**必须实跑验证命令**，以命令输出为准。
4. 完成判据 = **`runs/STAGE_<ID>_DONE.md` 文件存在**（不是 `[x]` 标记，见 §6.4）。
5. **禁止 Opus Read 图片文件** —— 改用 Python 产出数值（颜色中位数 / 边缘检测 / 面积占比），人眼确认留给巴蒂或安安。

### 6.4 队列漂移防线

`runs/TASK_QUEUE.md` 顶部已写明：**完成判据 = `runs/STAGE_<ID>_DONE.md` 存在**。
`[x]` 只是人类阅读参考，崩溃时可能留下没真正完成的 `[x]`（R7 事故：T4-a 曾被误标 `[x]`，
但 `data/levels.json` 与 `STAGE_T4a_DONE.md` 都不存在）。
→ **开工前先核对 DONE 文件是否真的存在。**

---

## 7. 文件清单速查

| 路径 | 作用 |
|---|---|
| `runs/HANDOVER_AR.md` | **本文档**（恢复手册） |
| `runs/TASK_QUEUE.md` | 任务队列（**完成判据 = DONE 文件**） |
| `runs/PROGRESS_ALL.md` | 进度流水（watcher 用它判断是否在推进） |
| `runs/ART_REBUILD_SPEC.md` | AR 施工单（实测像素坐标 + 10 条已知坑） |
| `runs/MATERIALS_DIGEST.md` | 材料包全貌（**唯一权威，别再摸底**） |
| `runs/DECISIONS.md` | 决策记录（D1–D8 + R7） |
| `runs/_diag/` | 诊断图（`c_*.png` 四角 / `goal_*` 球门 / `ui_sheet.png` / `style_compare.png` 风格对照） |
| `runs/STAGE_*_DONE.md` | 各阶段完成报告 |
| `art/preview_style.py` | 头像风格对照生成器（AR-3 的裁切/遮罩原型） |
| `art/build_field_skins.py` | AR-1 球场底图构建 |
| `art/extract_atlas.py` | UI 图集切图（已修 `texture_file` 坑） |
| `art/chromakey.py` | 绿幕抠图 → 头像/全身 |
| `art/avatar.py` | 头像构建。`make_original_disc` 是 AR-3 的裁切/遮罩 |
| `tools/shot-skins.mjs` | Playwright 批量截 8 套皮肤 → `runs/_diag/skin_*.png` |
| `autopilot_watcher_v5.sh` | 无人值守守护脚本（项目根上一级 `D:\ai_for_games\`） |

---

## 8. 风险与未完成项（如实记录）

1. **AR-5 已完成**。美术主线 AR-1～AR-5 都有 DONE 文件。下次从 **T4-c1** 开始。AR-6 仍要安安定范围。
2. **106/117 的场上图标已是原版原图**。剩下的风格断层只在 p06–p16。
3. **11/117 球员无原版头像**（p06–p16）—— 按 D3 回退 Q 版，风格断层对这 11 人无法通过 AR-3 消除。
   若安安要求**全场风格统一**，需要给这 11 人按原版风格**生成**头像（用 §1 指令 B 的原厂模板），
   这是"生成"不是"取原图"，与指令 A 有张力 —— **需向安安确认**。
4. **AR-4 与 T3 有顺序耦合** —— T3-a 改 `goalWidth` 到 1.68 m 会影响 AR-4 的门框宽度；
   建议 AR-4 用现行 2.05 m 做视觉，T3-a 后再复核，或先做 T3-a。
5. **Opus 崩溃问题尚未根治** —— 见 §6.2，建议先改一行设置再重启 watcher。
6. **`data/portrait_map.json` 已生成**（`portraits-1`，106 条）。AR-3 完成。

---

*文档生成：巴蒂（WorkBuddy），2026-11-16 09:30。事实以磁盘文件为准；本文档与代码冲突时以代码为准。*
