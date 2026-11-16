# 碰撞全明星复刻 · 续做指令 v5（干净会话 · 幂等 · 全部 Opus）

> 2026-11-16 06:35 巴蒂签发 v5，**主线切换为 AR 原版美术重建**（安安 06:30 明确要求）。
> 本指令面向**全新会话**。所有事实以磁盘文件为准。模型固定 `claude-opus-5-5`，effort=max，子代理同样是 Opus。

## 0. 最高铁律

1. **直接干活，不要重新规划、不要输出计划后停下、不要请求确认。** 你是无人值守会话。
2. **开工第一件事：读 `runs/ART_REBUILD_SPEC.md`**（本轮施工单，含全部实测像素坐标与已切好的验证图），再 `tail -20 runs/PROGRESS_ALL.md`，再读 `runs/MATERIALS_DIGEST.md`（材料包已摸透，**严禁重复调研 materials/**）。
3. **一个子任务 = 一个 checkpoint = 一个会话。** 本会话只做 `runs/TASK_QUEUE.md` 里**排在最前的一个未完成项**（当前是 **AR-2 四角弹簧**），做完立刻停。watcher 会自动开全新干净会话接力。
4. **每个子任务必须实跑验证命令**，以命令输出为准，不许用「代码写了」代替「测试通过」。
5. 完成判据：写 `runs/STAGE_<ID>_DONE.md`（改动文件清单 + 实跑命令与原始结果数字 + 遗留问题）+ 追加 `runs/PROGRESS_ALL.md` 一行，然后结束会话。
6. 全部完成后写 `runs/FINAL_REPORT.md`，watcher 见此文件即停。

## 0.5 [RED] 本轮主线：AR 原版美术重建（安安指定，优先级高于 T4-c）

**施工单 = `runs/ART_REBUILD_SPEC.md`（必读，全是实测数据，别自己重算）**。
诊断图（巴蒂已从原图裁好、放大、带标尺）在 `runs/_diag/`：
`c_tl/c_tr/c_br/c_bl.png`（四角弹簧放大）、`goal_top.png`、`goal_mouth_area.png`、
`goal_ruler.png` / `goal_ruler2.png`（球门口带像素标尺）、`ui_sheet.png`（已切好的 UI 对照）、
`atlas_head_half.png`（原版角色头图集）。

**五个子任务（严格按顺序，每项一个会话）**：

> ✅ **AR-1 已完成**（`runs/STAGE_AR1_DONE.md`）：5 张底图已建好并接入渲染层，**裁剪范围已修正**（Opus 原方案上下偏移 63px）。
> 底图 `x[242,1198] y[top,top+1559]`，top 逐套 243/244/244/245/246。**底图不旋转。**
> **有底图时必须跳过程序化草皮与白线**（原图自带，否则双线）。

| ID | 任务 | 核心要点 |
|---|---|---|
| **AR-1** | 球场底图 x5 | `Scenes_01..05.jpg`（1440x1920）裁可玩区 **956x1559**（x 242..1198 / y 180..1739）-> **旋转 90 度**（底图纵向、项目横向）-> `client/public/assets/fields/`；`fields.json` 的 `skins[]` 扩到 5 条带 `art` 字段；**推荐底图只取可玩区内部**，球门区留给程序化画（见 AR-4 宽度冲突） |
| **AR-2** | 四角弹簧 x4 | 原版是**斜切角 + 蓝灰金属盘绕弹簧 + 内侧沙土坡**，不是柱子。优先从 `Scenes_01.jpg` 抠图成透明 sprite（`art/chromakey.py`），兜底程序化重绘。**物理 `cornerCut` 不动**，保留受击回弹动画 |
| **AR-3** | 球员头像 106 张 | 原版 194x188 全覆盖无需生成。映射 `players.json.srcId` -> `player_portrait_mapping.csv`(utf-8-sig) -> `portrait_id`（**106/106 实测命中**）。按 **alpha 内容框**裁剪再进圆形遮罩（复用 `art/avatar.py`）。加「原图/重绘」开关，**默认原版**（D2） |
| **AR-4** | 双边门框 | 原版**没有独立门框 sprite**，球门 = 围挡中间的缺口，两端有盘簧。**底图开口实测约 38% 场宽 vs 物理 1.68m = 28%** -> 球门网/门框**必须程序化画**，开口宽度 = `geometry.goalWidth`。`Goal_00..03.png` 是**边墙护栏不是门框** |
| **AR-5** | 游戏 UI | 用 **`art/extract_atlas.py`**（已修 `texture_file` 坑，真实来源 `atlas/Skin.png` 2048x2048）。17 个已验证切片 + Badge.png 66 徽章 + skillIcon.png 83 技能图标 + head.png 品质框/表情/球衣。大厅 + HUD 换装，**只换视觉不动交互** |

**AR-1 -> AR-2 -> AR-3 -> AR-4 -> AR-5 做完，才回到 T4-c（技能）。**
AR-5 依赖技能数据（技能图标），顺序天然如此。

> **T3（球门宽度 1.68m）尚未执行**。AR-4 若要在 T3-a 之前定稿门框视觉，
> 可先用现行 2.05m 做视觉，并在 DONE 里注明「T3-a 改物理后需同步复核 AR-4」。

## 1. 当前状态

| 阶段 | 状态 |
|---|---|
| A 服务端骨架 / B 权威一杆球 / C 双端联机 / D 构建 / E 浏览器 E2E | ✅ DONE |
| T1 一条命令一个地址 | ✅ DONE 20:55 |
| T2-a 名册 16→117 人 | ✅ DONE 22:12（`runs/STAGE_T2a_DONE.md`） |
| 美术 v2 头像 117/117 | ✅ DONE 22:40 |
| **AR 原版美术重建（本轮主线）** | 🔄 AR-1 球场底图 ✅ DONE（`runs/STAGE_AR1_DONE.md`）；下一个是 **AR-2 四角弹簧** |
| T4-c 技能 511 条 | ⬜ 排在 AR 之后 |
| T2-b 在线快速匹配 | ⬜ 排在 T4 之后 |
| T3 球门宽度 | ⬜ 最后做 |

**实测基线（改动后必须保持全绿）**：
```
npm run typecheck        → exit 0
npm run test:physics     → 14/14
npx tsx tools/net-tests.ts   → PASS=176 FAIL=0
npm run build            → exit 0
npm run test:e2e         → PASS=7 SKIP=0 FAIL=0
npx tsx tools/online-e2e.ts  → PASS=17 FAIL=0
```

## 2. 材料包消化（T4-c 之后才做，这里仅备查）

**背景**：用户提供了原始资料压缩包 `materials/pengzhuang_rebuild/`（591 个条目，含 07_ai_handoff/REBUILD_PROMPT.md 的完整原始开发提示词）。
此前只消化了 `players.json` 一小部分（106 人基础值），**其余全部未利用**。巴蒂已完成摸底，全貌写在 **`runs/MATERIALS_DIGEST.md`—— 必读，里面有每个文件的准确字段、行数、样本与坑**。

### T4-a · 等级成长数据（2250 条）入库
- 源：`materials/pengzhuang_rebuild/02_players_and_data/level_records.json`（2250 条 = 106 人 × 10 级 + 1.5.5 137 条）。
- 现状 `data/players.json` 的 `attrs` 是**单值基础值**，`growth` 字段是巴蒂自造的倍率数组，**不是原版数据**。
- 目标：新增 `data/levels.json`，按 `player_id` → `level` → `{weight,power,mind,radian,precision}` 存储，**保留原始属性名**，不要重命名成 kg/N/角度。
- 玩法接入：允许赛前选卡牌等级（1–10 级），出手力度/速度/弧线按**该等级属性**计算，而不是固定基础值。**改物理映射必须重跑 `npm run calibrate` 并把新基线写进 `docs/calibration.md`**。
- 不许把 `radian=70` 当 70 度、`weight=70` 当 70kg。属性点→物理量的映射另建配置并记录依据。

### T4-b · 卡牌变体与稀有度（224 张卡）
- 源：`card_records.json`（87 张 1.2.0 + 137 张 1.5.5），字段含 `variant`（普通卡等）、`rarity`、`skills`、`unlocks`、`foil`/`flash_skills`。
- 目标：新增 `data/cards.json`，`card_id`/`player_id` 关联到现有 117 人（`srcId` 对应），**不造卡**。1.2.0 与 1.5.5 同名卡**并存**，不要覆盖成一套。
- 20 条 card 与 card_attr 等级 1 的数值冲突（`parameter_conflicts.json`）**必须保留记录**，不得静默取舍。可选策略：取 1.5.5 等级 1，并在导入报告说明这是**复刻策略不是原版优先级**。

### T4-c · 技能表全量接入（511 条 / 547 条关联）
- 源：`skill_records.json`（511 条，含 trigger/probability/target/effects/values/duration/stacks）、`skill_links.json`（547 条 card↔skill 关联，带 unlock_level）。
- 现状 `data/skills.json` 只有 13 个技能、16 个已实现、71 个占位、30 个 none。**这是当前最大的功能缺口**。
- 目标：把 511 条技能的**元数据**全量入库（`data/skills.json` 扩为 id → name/rarity/trigger/probabilities/target/effects/values/duration/stacks/description + 原始字段）。
- **效果实现分级**：能明确推导效果的（速度加成、重量加成、概率触发）才接进 `shared/` 的技能执行器；不能推导的标 `effectStatus: "unimplemented"` 并在文档列表，**绝不编造效果**。
- `triggerPerList` 是**列表不是单个概率**，`duration` 是原始计数不是秒。照此实现。

### T4-d · 原版头像与球场图接入（美术真实化）
- **原版头像 107 张在 `materials/pengzhuang_rebuild/02_players_and_data/portraits/1.5.5/`（194×188 透明 PNG，覆盖全部 106 人 + 1 候选 40109）。**
- 现状：场上的 117 个头像是 AI 重绘 + 16 个手绘（`client/public/assets/players/*_avatar.png`）。**原版图比 AI 图更有价值**，应做**原图/重绘切换**（`portrait_style=original|redrawn`，正是 REBUILD_PROMPT.md 的原始要求）。
- 目标：
  1. 把 107 张原版头像导入 `client/public/assets/players_original/`（保持 `head_XXXX_YYYYY.png` 命名与 `portrait_id` 映射）。
  2. 客户端加**原图/重绘切换开关**（大厅里可选），默认用**原版**。
  3. 原版图 194×188、重绘图 512×512，**分别配置留白，不横向拉伸**，圆形遮罩裁切要保住头顶。
  4. 五套球场原图 `materials/pengzhuang_rebuild/03_art/original_images/1.5.5/texture/Scenes_01.jpg` — `Scenes_05.jpg` 接入为**背景贴图皮肤**（现有 3 套是程序化重绘的）。
- **红线**：换皮只改画面，**绝不改碰撞几何**。`data/fields.json` 的 geometry 是唯一物理边界来源。原版图里的边界不自动当碰撞墙。

### T4-e · 阵型与场地数据
- 源：`formations.json`（90 套阵型，10 种名称，`positions` 格式 `ST;35:50` = 位置;x%;y%）、`factors.json`（110 条系数）、`reference_tables/1.2.0|1.5.5/`（106 张原始配置表，`table_inventory.json` 记录了哪些已纳入）。
- 目标：把 90 套阵型接入 `data/formations.json` 并在开局界面可选（**坐标格式需要你验证换算**，训练坐标与比赛阵型坐标格式不同，原点/缩放未验证——先做 1 套验证再批量）。

### T4-f · 导入报告与冲突清单
- 汇总产出 `docs/materials-import-report.md`：每张源表的行数、导入去向、丢弃/未导入项及原因、冲突条目完整列出（20 条数值冲突、8 条 issues、待确认人物：小罗 40109 / 卡队法比奥·卡纳瓦罗 / 早期齐祖 90001 / 耳帝 Nicolas vs Guillermo Burdisso）。
- `data/roster-conflicts.json` 现有 88 条 clamp 记录要保留。

## 3. T4 之后的队列

- **T2-b 在线快速匹配**：等待队列 → 二人自动配对 → 可取消。服务端房间管理，不引数据库。
- **T2-c/d** 五套球场（已在 T4-d 铺路）与移动端适配。
- **T2-e 公网部署只写方案文档**：账户、费用、域名、HTTPS/WSS、持久化与备份。**不执行、不购买、不发布、不改 DNS。**
- **T3 球门宽度**：`data/fields.json` `geometry.goalWidth = 2.05 m`（占场宽 34.2%），安安反馈偏大。候选 1.90 / 1.80 / 1.65 m，详见 `runs/ISSUE_goal_width.md`。改物理数据必须重跑 calibrate + 全部回归。

## 4. 上下文纪律（崩溃的根因 · 违反就是浪费一个会话）

**崩溃实证（务必重视）**：
- 16:50 会话 6.55MB、18:46 会话 5.96MB（均 `Autocompact is thrashing`）
- 20:28 会话 `Prompt is too long` 后进程存活但零输出
- **2026-11-16 03:13 与 05:21 又连续两次 `Prompt is too long`**（T4-c 技能任务）：
  崩溃前会话累计 **287KB / 465KB 工具结果**，单会话 **87 / 158 次工具调用**。
  → 会话不是"文件太大"，是**跑得太长**。这是当前第一大浪费源。

### 硬性限制

0. ⛔ **绝对禁止用 Read 工具读取任何图片**（`.png` / `.jpg` / `.jpeg` / `.webp` / `.gif` / `.bmp`）。
   **这是 2026-11-16 三连崩的真凶**：07:00 / 07:27 / 07:40 三个会话全部崩在
   `Autocompact is thrashing` / `Prompt is too long`，崩溃前一步都是
   `Read runs/_diag/ar1_overlay.png` → 工具结果 **485KB base64** → 上下文瞬间爆掉。
   （一次 Read 一张图 ≈ 烧掉 15 次普通文件 Read 的额度。）
   **要"看图"就用 Python 产出数值**：白线位置扫描、颜色中位数、像素对齐差、
   `Image.getbbox()` 裁剪框、面积占比——**用数字说话，不看图**。
   实在需要人眼确认，**留给安安或巴蒂看**，不要自己 Read。

1. **单会话工具调用上限 60 次**。接近上限就把结论写进 `PROGRESS_ALL.md` + `runs/STAGE_<T>_DONE.md` 并**主动结束会话**。
   **主动结束不算失败，崩溃才算。**
2. **单次工具结果超过 15KB 就不许再 Read**。改用 `grep -n` 定位行号后分段读，或 `node -e` 只取需要的字段。
   注意：这条也适用于**命令输出**——脚本输出务必自己截断，别把 500 行日志打回上下文。
3. **绝不整体读** `materials/**` 大 JSON（`field_dictionary.json` 118KB、`level_records.json` 641KB、`catalog.json` 168KB、`card_records.json` 111KB、`index.html` 4.8MB、`research.html` 4.2MB）、`node_modules/**` 源码全文。
4. 需要时用 `node -e` / `python -c` 做统计、抽样、字段提取，**只打印几行结果**。
5. **一次 Read 不超过 300 行**；用 `grep -n` 定位后分段读。
6. 所有命令输出用 `| head -40` / `| tail -40` 截断；测试只看 PASS/FAIL 汇总行。
7. 感觉上下文变长时，**优先把结论写进 `PROGRESS_ALL.md` 落盘**。
8. 单会话只做一个子任务就主动收尾。

### 已被拆分的大任务（不要合并回去）
- **T4-c** 拆成 **T4-c1（511 条元数据 + 547 条关联入库）** 与 **T4-c2（效果执行器接 `shared/`）**，两个独立会话。
- **T3** 拆成 **T3-a（物理 goalWidth 1.68m）** 与 **T3-b（视觉门框）**（详见 `runs/DECISIONS.md` D1）。

## 5. 已踩过的坑（别再踩）

1. **客户端首个快照竞态**：服务端 `onJoin` 立刻广播快照，客户端 `await join` 返回后才注册 handler → 首个快照被丢弃。**拿到 room 对象就立刻同步注册 handler**。
2. **`until(fn)` 语义**：条件必须返回 `undefined`（未就绪），不能返回 `false`。
3. **Colyseus 重连**：`allowReconnection(prev, seconds)` 必须在 `onLeave` 内调用；重连成功**不走 `onJoin`**，要自己在 `reconnection.then()` 里发 `resume`。
4. **服务端 `onMessage` 的 `'*'`** 只捕获没有专用 handler 的 type。
5. **AI 全身立绘裁头失败**（尖发/举手污染肩线）→ 直接生成头肩特写。
6. **宫格图白框混入头像** → 检测白线位置并先涂回绿色；正方形化留 24% 边距（`MARGIN = 1.24`）。
7. **沙箱 safe-delete 守卫**：删 `dist/client` 被拦 → 改名而非删除。
8. **PowerShell 吞 stdout**：结果写临时文件再用 Read 读最可靠；`python -c` 内联多引号易炸 → 写 .py 脚本执行。

## 6. 质量红线

- 不许删测试、不许弱化断言、不许把失败用例标 skip 来"通过"。
- 不许用本地双标签页冒充公网联机；联机必须是两个独立客户端连真实 Colyseus 服务端。
- 不许改 `shared/physics.ts` 的物理常量与 `docs/calibration.md` 的校准基线（除非本任务明确要求并重跑了校准）。
- 不许编造缺失卡牌/技能/人物数值；不确定的标 `unimplemented` / `pending-confirmation`。
- 不许引入按量计费服务、不许 git init。
- 遇到真阻塞：把诊断写进 `PROGRESS_ALL.md` 与 `runs/BLOCKER.md`，做完其他能做的再停。

## 7. 收尾

写 `runs/FINAL_REPORT.md`：逐阶段列出**实跑命令 + 原始结果数字**、改动文件清单、未完成项及原因、下一步建议。完成即停。
