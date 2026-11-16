# 任务队列（每个子任务 = 一个 checkpoint = 一个干净会话）

> 由巴蒂维护。watcher 每轮新开会话，会话只做**排在最前的未完成项**。
> 完成的项把 `[ ]` 改成 `[x]` 并写 `runs/STAGE_<ID>_DONE.md`。
>
> ⚠️ **完成判据 = `runs/STAGE_<ID>_DONE.md` 文件存在**，不是下面的 `[x]`。
> `[x]` 只作人类阅读参考，会话崩溃时可能留下没真正完成的 `[x]`（R7 事故：T4-a 曾被误标 `[x]`，
> 但 `data/levels.json` 与 `STAGE_T4a_DONE.md` 都不存在）。**开工前请先核对 DONE 文件是否存在。**
>
> 📌 **2026-11-16 09:30 安安新指示**（已并入本队列，详见 `runs/HANDOVER_AR.md` §1）：
> - **图标 = 原版原图**（`head_*.png` 直接用，只裁切/遮罩，不重绘）→ 即 **AR-3**，优先级提到 AR-2 之前。
> - **可能按原版美术风格增加球员和数值** → 新任务 **AR-6**，范围待安安确认后再开。

## 🔴 当前主线（最高优先级）：LB 照原版复刻 球员 / 大厅 / 竞技场
> **安安 2026-11-16 评价**：AR 只换了头像和皮，原版球员在比赛里看不到（阵容写死），大厅不是原版那种皇室战争式大厅，竞技场没做。
> 要求**照原版资料复刻**。素材依据：`01_game_research/references/taptap_original_*.jpg`、`assets/2016_gallery_*.jpg`、
> `assets/2017_global_2.jpg`；原版切片由 `art/build_lobby_assets.py` 产出。
> **安安已拍板**：经济（钞票/钻石/合同/任务）只做界面，数值本地存，入口标"未开放"；竞技场 = 皇室战争式，
> 五座原版联赛球场 Image_01–05 按段位排列、赢球涨积分解锁，每座对应一套比赛场地；
> p06–p16 自制球员不进卡池、不进电脑阵容（数据保留，测试基线不动）；顺序 = 阵容 → 大厅 → 竞技场。

- [x] **LB-1 阵容与选人**：原版"首发阵容"半场（Img_01）+ 三套阵容存档 + 全部/前锋/中场/后卫卡池（Box_Quality 卡框）
      + "特队"式详情窗（五项属性、原版技能原文与解锁等级）。比赛用所选阵容；电脑与玩家 2 随机原版阵容。
      **DONE 2026-11-16**（见 `runs/STAGE_LB1_DONE.md`）。
- [x] **LB-1b 比赛场景整屏**（安安反馈"竞技场背景不太好"）：五套原版整张场景铺满，比分栏叠在原图比分条上。
      **DONE 2026-11-16**（见 `runs/STAGE_LB1b_SCENE_DONE.md`）。
- [x] **LB-2 原版大厅**（**DONE 2026-11-16**，见 `runs/STAGE_LB2_DONE.md`；联赛球场轮播已做，积分解锁归 LB-3）：顶栏（已做）+ 玩家名/俱乐部 + 自由/重磅合同（未开放）+ 中央"地区联赛"球场 + 两侧图标按钮
      + 杯赛/竞技模式按钮；练习/双人/联机/设置收进原版风格弹窗。保留 `.nick` `[data-bot]` `.timer` `.skin` 选择器（e2e 依赖）。
- [x] **LB-1c**：五座联赛的对战页用 `fields/scene_01`–`scene_05` 原图。大厅竞技场也改用这五张，只裁掉顶部空比分条（`scene_0N_board.webp`）。
      ⚠️ **2026-11-16 已回退「大厅」那一半（D11，安安拍板「有原版啊 那就原版好了」）**：大厅展示图与对局场地是**两套资产**，
      共用一张正是病根——大厅该是皇室战争式的立体摆件，对局该是俯视功能图。大厅改回原版等距 Q 版球场模型
      `orig_ui/stadium/Image_0N.png`（`ARENAS.stadium` 此前是**死字段**，没人读），对局整屏 `scene_0N_full.webp` 不动。
      副作用：`scene_0N_board.webp` 5 个文件因此不再被任何代码引用，**安安 2026-11-16 拍板「可以的话就删掉呗」，已删**
      （源文件 + `dist/client/assets/fields/` 副本全清，全仓复扫 `*_board.webp` = **0**）。**可再生**：`python art/process_arena.py`
      从仍在用的 `scene_0N_full.webp` 裁 y=148 即可重造，该脚本保留未删。⚠️ 本项目**不是 git 仓库**，删除无版本控制兜底，
      删前已确认生成器与源图俱在。删除后复跑：build 0 / e2e 7-0 / lineup-smoke PASS / 五座核验 0 错误。
      回归：typecheck 0 / physics 18-0 / net 176-0 / build 0 / e2e 7-0 / lineup-smoke PASS（已补大厅图 src + 加载断言，
      并在开局前清 `pz_skin` 使轮播断言确定）/ 五座逐座截图核验 700×700 全部加载、0 console 错误（`runs/_diag/arena_0N.png`）。
- [x] **AIM-2**：瞄准显示（力度圈、拉线、预测点）全部画在最上层；电脑上弧线改用 ← → 调（触屏保留划弧）；准星定长 = 精准 × 6 m，碰墙镜面补全，弧线与直线同长；出手后弧线撞墙镜面反弯（`phys-3`，弧线转速 0.329 → 0.55 rad/s，满力满弧线横向偏移 2.2 → 3.44 m）；圆心进门线的球员在本杆结束时滑到门前空位（`rules-2`）。见 `runs/STAGE_AIM2_DONE.md`。
- [x] **AIM-3**：曲率半径收到原先的 1/3（`turnRate` 0.55 → 1.98，已计入出手变快）；出手速度全体 +20%（`vmax` 7.663 → 9.1956，弹簧上限 7.6 → 9.12）；准星只按精准定长，球员和足球不再截断。`phys-4`。
- [ ] **LB-3 竞技场段位**：五座联赛球场按积分解锁，赢 +积分 / 输 −积分（本地存），大厅左右切换查看，
      当前竞技场决定比赛场地皮肤；比赛 HUD 顶栏按原版（双方队名、比分、计时）。

## AR 原版美术重建（已完成 AR-1..5）
> **安安 2026-11-16 06:30 明确要求**：用原版美术资产重新生成 **球场 / 四角弹簧 / 球员头像 / 双边门框 / 游戏 UI**。
> 施工单：**`runs/ART_REBUILD_SPEC.md`**（含全部实测像素坐标、已切好的 UI 验证图、10 条已知坑）。
> 诊断图在 `runs/_diag/`（四角放大、球门口、标尺、UI 切片对照）。
> **T4-c 技能暂停**，美术做完再回去。
>
> 📖 **交接手册 = `runs/HANDOVER_AR.md`**，恢复时先读它 + 本文件 + `runs/PROGRESS_ALL.md`。


- [x] **AR-1 球场底图**：5 张 Scenes_XX.jpg（1440×1920）裁**两条球门线之间** 956×1559
      → `client/public/assets/fields/`；`fields.json` 的 `skins[]` 新增 5 条带 `art` 字段。
      **DONE 2026-11-16 08:15**（见 `runs/STAGE_AR1_DONE.md`）：
      ⚠️ **Opus 原方案的裁剪范围是错的**——原写 `[242,180,1198,1739]` 上下偏移 63px
      （顶部混入广告板区、底部把底线切掉）。实测修正为 `x[242,1198] y[top, top+1559]`，
      top 逐套为 243/244/244/245/246。验证：原图中线换算 4.89 m、中圈 3.89/5.89 m，与几何完全吻合。
      ⚠️ **底图纵向、不旋转**（项目同为竖向、球门在上下两端）——"旋转 90°"那条是错的。
      ⚠️ **有底图时必须跳过程序化草皮与白线**（原图自带，否则双线）。
      工具：`art/build_field_skins.py`、`tools/shot-skins.mjs`（8 皮肤截图 → `runs/_diag/skin_*.png`）。
- [x] **AR-3 球员头像**：原版 106 张按 alpha 内容框裁切、长边 6% 留白、圆形遮罩，写入
      `client/public/assets/players_original/`。`data/portrait_map.json` + `data/settings.json`，
      默认原版（D2/D9）；p06–p16 回退现有重绘。
      **DONE 2026-11-16 10:00**（见 `runs/STAGE_AR3_DONE.md`）：
      导入两次 sha256 相同；typecheck 0；physics 15/15；net 176-0；build 0；e2e 7-0；online-e2e 17 项 0 失败；
      `node tools/portrait-smoke.mjs` PASS（场上 4 原图 + 6 回退，106 文件均为 256×256，开关可来回切）。
- [x] **AR-2 四角弹簧**：从 `Scenes_01.jpg` 左上角切出 128×128 透明 sprite
      `client/public/assets/fields/spring_corner.png`（草地抠掉，石墙/盘簧/沙土留下），
      四角镜像贴上，受击时向角里压缩再弹回。`cornerCut` 未改。
      **DONE 2026-11-16 10:45**（见 `runs/STAGE_AR2_DONE.md`）：
      原版球场左上角采样 RGB 175,171,181（蓝灰，不是原来的橙色垫）。
      typecheck 0；physics 15/15；net 176-0；build 0；e2e 7-0；online-e2e 17 项 0 失败。
- [x] **AR-4 双边门框**：原版没有独立门框图。石墙画到 `geometry.goalWidth` 为止，
      开口里只留很淡的网，门柱端头是蓝灰盘簧。`Goal_00..03.png` 不是门框。
      **DONE 2026-11-16 11:00**（见 `runs/STAGE_AR4_DONE.md`）：
      门宽仍是 2.05 m，绘制读这个字段，T3 改成 1.68 时会跟着变。
      取样：石墙 228,228,226，开口中心 62,109,42。physics 15/15，net 176-0，e2e 7-0。
- [x] **AR-5 游戏 UI**：大厅和 HUD 换上原版图集切片（Logo、背景、按钮、面板、回合条、选中光圈）。
      交互没改。技能图标和俱乐部徽章未接，标 pending-confirmation。
      **DONE 2026-11-16 11:08**（见 `runs/STAGE_AR5_DONE.md`）：
      e2e 7-0，online-e2e 17 项 0 失败，主按钮确认是 Btn_02。
- [ ] **AR-6 按原版风格扩充球员与数值**（🆕 2026-11-16 09:30 安安指示，**范围待确认**）：
      **美术风格权威规格** = `materials/.../02_players_and_data/generation_prompt_template.txt`
      （原厂重绘头像提示词模板）+ `generation_jobs.json`（106 条逐人成品提示词）。
      新球员头像照此模板结构生成；**数值必须标来源**（`original` / `derived` / `designed`）写入
      `docs/roster-provenance.json`，**禁止把 `designed` 混进原版数值不标注**（原厂纪律：「不编造数值」）。
      ⚠️ **范围（新增多少人/哪些人/新数值规则/是否新阵型技能）安安尚未明确，开工前先确认。**
      ⚠️ 与 AR-3 有张力：AR-3 是「取原图」，本项是「按原版风格生成」，两者的产物与切换开关要分开设计。

## T4 材料包全量消化（AR 做完后回来）
详见 `runs/RESUME_V4.prompt.md` 第 2 节 与 `runs/MATERIALS_DIGEST.md`。
工期预估见 `runs/V04_TIME_ESTIMATE.md`（中性 ≈35 机时 ≈1.5 个自然日连续无人值守）。

- [x] **T4-a** 等级成长数据 2250 条入库 → `data/levels.json`，赛前选等级，按等级属性出手
      （DONE 2026-11-16 01:33：六项回归全绿，calibrate --check ✅16/❌0，见 runs/STAGE_T4a_DONE.md）
- [x] **T4-b** 卡牌变体 224 条入库 → `data/cards.json`，1.2.0/1.5.5 并存，20 条冲突保留
      （DONE 2026-11-16 02:13：六项回归全绿，xcheck 31/0，20 条冲突保留，见 runs/STAGE_T4b_DONE.md）
- [~] **T4-c** 技能 511 条元数据全量入库 + 可推导效果接入，不可推导标 unimplemented
      ⚠️ **已拆分（评估加速建议 #4，因连续 2 次 "Prompt is too long" 崩溃）**：
      - **T4-c1** = 只做 511 条**元数据 + 547 条关联**入库 → `data/skills.json`，不接执行器
      - **T4-c2** = 技能**效果执行器**接入 `shared/`
      **判据 = `runs/STAGE_T4c1_DONE.md` / `runs/STAGE_T4c2_DONE.md` 存在**
- [ ] **T4-d** 原版头像 107 张 + 五套球场原图接入，原图/重绘切换开关
      （D2 已固化：默认**原版**；D3 已固化：11 名无原版头像者回退现有手绘/重绘，**绝不出现灰饼**）
      ⚠️ **已被 AR-3 / AR-1 覆盖并提前**，AR 完成后此项直接勾掉（避免重复施工）
- [ ] **T4-e** 阵型 90 套接入 `data/formations.json` + 开局可选（先验 1 套）
      （D7 已固化：**不换默认阵型**，保 176 条 net 基线，原版阵型作可选）
- [ ] **T4-f** `docs/materials-import-report.md` 导入报告 + 冲突清单
      （D5 已固化：20 条冲突取 1.5.5 等级 1，注明「复刻策略非原版优先级」；D6 已固化：小罗 40109 / 齐祖 90001 不进正式名单）

## T2 V0.3 剩余
- [ ] **T2-b** 在线快速匹配（等待队列 → 自动配对 → 可取消）
- [ ] **T2-b2** `rematch` 再来一局（PROTOCOL.md 要求，现未实现）
- [ ] **T2-c** 五套球场皮肤（已在 T4-d 铺路）
- [ ] **T2-d** 移动端适配（触摸、旋转、后台返回）
- [ ] **T2-e** 公网部署**方案文档**（不执行、不购买、不发布）

## T3 球门宽度（最后做）· **D1 已由安安拍板：1.68 m（28% 场宽），物理+视觉都改**
见 `runs/DECISIONS.md` D1。
- [ ] **T3-a 物理**：`data/fields.json` `geometry.goalWidth` 2.05 → **1.68 m**（**只改这一个字段**）+ `field-2`→`field-3`。
      连锁：门柱碰撞 → 进球判定 → `docs/calibration.*` 基线 → physics 14 → net 176 → `configVersion`。
      必须实跑：`typecheck → calibrate → test:physics → test:net → build → test:e2e → online-e2e`（≥3 轮）。
      **前后 30 场进球率对照必须写进 DONE**。物理回归 FAIL 则**回退 2.05 并如实记录**，不许弱化断言。
- [ ] **T3-b 视觉**：`client/src/render.ts` 门框绘制 + `fields.json` 的 `goalFrame` 配色/线宽（**不碰物理常量**），
      门框不再显粗、球网不过分抢眼。回归 1 轮即可。

## 已完成
- [x] A/B/C/D/E 阶段
- [x] T1 一条命令一个地址
- [x] T2-a 名册 117 人
- [x] 美术 v2 头像 117/117
