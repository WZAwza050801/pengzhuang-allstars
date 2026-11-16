# 决策点记录（V0.4 评估第六节 · 巴蒂 2026-11-16 01:00 预填）

> 来源：`runs/V04_TIME_ESTIMATE.md` 第六节列了 8 个决策点。
> 其中 **D2/D3/D5/D6/D7 可以从源材料直接推导**，不占用你的时间，已由巴蒂按原始资料预先固化（下方「已固化」）。
> **D1（球门宽度）与 D4（公网部署）需要安安拍板**，见下方「待安安拍板」。

## 已固化（可从 `materials/` 源材料直接推导，不改产品意图）

| # | 决策 | 固化取值 | 依据 |
|---|---|---|---|
| **D2** | 头像默认原版还是重绘 | **原版**（`portrait_style=original`） | `materials/.../07_ai_handoff/REBUILD_PROMPT.md` 原文要求「保持 headIcon 文件名映射、原版／重绘切换」；且 `03_art/README.md` 明确「用户自己批量重绘头像」→ 重绘是可选路径不是默认。原版 107 张覆盖率 106/106 |
| **D9** | 🆕 头像是否允许重绘 / 风格归属 | **图标一律用原版原图**（`head_*.png`），只允许裁切与遮罩，不改像素 | **安安 2026-11-16 09:30 指示**：「我期望的图标是和原版一样的」。与 D2 同向，D9 是安安直接拍板的强化版 |
| **D10** | 🆕 后续新增球员的美术与数值规范 | **美术对齐原版风格**：用原厂提示词模板 `generation_prompt_template.txt` + `generation_jobs.json` 的 106 条成品提示词；**数值必须标来源** `original`/`derived`/`designed` 写入 `docs/roster-provenance.json`，`designed` 单列并标「非原版」 | **安安 2026-11-16 09:30 指示**：「可能还会按照原版的美术风格去增加一些球员和数值」+ 原厂纪律「没有编造任何属性／不编造数值」。**新增范围安安尚未明确，开工前先确认** |
| **D11** | 🆕 大厅竞技场展示图：用原版模型还是 AI 按对局场景重生成 | **用原版 `orig_ui/stadium/Image_01–05.png`**（700×700 透明底等距 Q 版体育场），**不 AI 重生成**。**大厅展示图与对局场地是两套资产，禁止共用一张** | **安安 2026-11-16 拍板**：「有原版啊 那就原版好了」。原版五座模型与 `Scenes_01–05` **同为 1.5.5**（`art/build_lobby_assets.py:23` / `ART_REBUILD_SPEC.md:24`），是同一座球场的两种视角，特征元素逐座对得上（甲级檐上巨型足球 ↔ 场景角上足球图标；全明星花瓣穹顶 ↔ 中圈绿色星形）。与 D9「原图不重绘」同向。另：AI 重生成受模型限制——参考图生图只能 `wan2.7-image-pro`，`qwen-image-3.0-pro` 不吃 `--ref` |
| **D3** | 无原版头像的 11 名球员怎么显示 | **回退到现有手绘/重绘图**（`client/public/assets/players/*_avatar.png`），**绝不出现灰饼 `#dde6ee`** | 现有 117/117 头像已覆盖全部球员，原版只是叠加一层；回退链天然存在 |
| **D5** | 20 条 card vs card_attr 等级 1 数值冲突 | **取 1.5.5 等级 1**，并在导入报告注明「**复刻策略，非原版优先级**」 | `materials/.../02_players_and_data/README.md` 与 `REBUILD_PROMPT.md` 原文即此建议 |
| **D6** | 小罗 40109 / 早期齐祖 90001 是否进正式名单 | **不进**，标 `pending-confirmation` | `pending_generation_jobs.json` 原文「待确认，未加入106条正式任务」；README「没有编造任何属性」 |
| **D7** | 默认开局阵型是否换成原版 `2_2_1(A)` | **不换默认**（保 176 条 net 用例基线），原版 90 套阵型作**可选** | 改动会让 physics 30 场随机比赛与 net 确定性用例全部重新对账；收益不抵成本 |
| **D8** | 真机测试用哪台手机 | 安安自用手机 + 局域网 `http://<本机IP>:2567` | 已在 `docs/how-to-play-online.md` 的用法范围 |

## 待安安拍板

### ✅ D1 · 球门宽度最终值（T3）—— **安安 2026-11-16 01:20 已拍板**

> **安安决定：球门宽度 = 1.68 m（28% 场宽）**，且**物理开口与视觉观感两个问题都要修**。

| 项 | 值 |
|---|---|
| 新门宽 `goalWidth` | **1.68 m** |
| 占场宽 | **28.0 %**（原 2.05 m = 34.2%，收窄 18%） |
| 依据 | `materials/.../01_game_research/prototype_settings.json`：`field_width_units 1.0` / `goal_width_units 0.28` |
| 版本号 | `field-2` → **`field-3`**（同步升位，触发 `configVersion` 连锁） |

**T3 拆成两个子项**（避免一次会话同时做物理+视觉导致上下文爆炸）：

- **T3-a 物理**：只改 `data/fields.json` 的 `geometry.goalWidth`（**不动其它 geometry 字段**）+ 升 `field-3`；
  连锁影响门柱碰撞 → 进球判定 → `docs/calibration.*` 基线 → physics 14 → net 176 → `configVersion`。
  必须实跑：`typecheck → calibrate → test:physics → test:net → build → test:e2e → online-e2e`（≥3 轮）。
  **前后进球率对照**（30 场完整比赛）必须写进 `STAGE_T3a_DONE.md`。
- **T3-b 视觉**：改 `client/src/render.ts` 的门框绘制 / `fields.json` 的 `goalFrame` 配色线宽（**不碰物理常量**），
  让门框视觉不再显粗、球网不过分抢眼。回归只需 1 轮（typecheck + build + e2e）。
- 若物理回归 FAIL：**回退到 2.05 m 并如实记录**，不许弱化断言。

### D4 · 公网部署选型（T2-e 之后）

T2-e **只出方案文档**（不执行、不购买、不发布、不改 DNS），所以不阻塞 V0.4 完成。
选型留到 T2-e 交付后再定；届时会列出 2–3 个方案的账户/费用/域名/HTTPS-WSS/持久化备份对比。

## 已完成 · 评估识别的风险修复

- **R7 队列状态漂移（真 bug，已修）**：`TASK_QUEUE.md` 里 T4-a 曾被误标 `[x]`，但 `data/levels.json` 与 `STAGE_T4a_DONE.md` 都不存在 —— 若 T4-a 会话崩溃，下一会话会直接跳到 T4-b，半成品无人收尾（+1～2 机时）。
  **已修**：`TASK_QUEUE.md` 顶部加了硬性说明 —— **完成判据 = `runs/STAGE_<ID>_DONE.md` 文件存在**，不是 `[x]` 标记；T4-a 改为 `[~]` 进行中并标注已落盘内容。
