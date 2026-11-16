# STAGE T4-a DONE — 等级成长数据 2250 条入库 + 赛前选卡牌等级 Lv1–Lv10

- 作者：Opus。watcher v4 会话 #1（2026-11-15 23:13 → 11-16 01:07）写完全部源码和数据。它在 autocompact thrashing 后以 rc=1 退出，当时还没写 DONE。会话 #2（01:09 → 01:33）负责回归、核对和收尾。
- 范围：只做了 T4-a。T4-b..f、T2-b/b2/c/d/e、T3 都没做，也没写 `runs/FINAL_REPORT.md`。
- 状态：**PASS**。六项基线全绿（§2）。`npm run calibrate -- --check` 结果 ✅ 16 / ❌ 0。phys-2 基线和 11-15 的备份逐个数值比对，0 处差异。新的等级基线写进了 `docs/calibration.md`「等级属性 → 物理」一节（§4）。

## 0. 结论

1. **入库**：`data/levels.json` 收录了源表 `materials/.../02_players_and_data/level_records.json` 的 **2250/2250** 行（1.2.0 有 880 行，1.5.5 有 1370 行）。属性名沿用原表的 `weight / power / mind / radian / precision`，没有改名。
   - `players` 段：结构是 `srcId → "1".."10" → {weight,power,mind,radian,precision}`。名册 106 人 × 10 级 = **1060 格**，取 1.5.5 的基础卡（card_id = player_id = srcId）。
   - `others` 段：其余 119 张卡原样保存，键为 `版本|card_id`，共 1190 格。其中 1.2.0 的卡 88 张，1.5.5 的变体卡 31 张。运行时暂时不读这一段，留给 T4-b 的 `cards.json`。
   - 逐格对源：1060/1060 格等于对应的 1.5.5 源行；2250/2250 条源行都能在 players 或 others 里找到（§2 #9）。
   - 导入器 `tools/import-levels.ts` 可以复现。连跑两次，输出 sha256 都是 `A197CB0D0FBEE16C…`（§2 #8）。
2. **赛前选等级**：设置区新增「卡牌等级」下拉，可选 Lv1–Lv10，默认 Lv5（= `rules.levels.uniformLevel`）。选择保存在 localStorage 的 `pz_card_level`，作用于本方全部 5 名球员。
   - 人机：本方用所选等级，电脑固定 Lv5。
   - 同屏双人：两边同级。
   - 在线约战：各端通过 `submitLineup(lineup, levels)` 提交各自的等级。服务端原本就支持 per-slot 的 `levels`，并校验 `bad-level`。
3. **按等级属性出手**：调用链是 `shared/match.ts` 的 `levelAttrs()` → `pieceStats()`。每颗棋子都带 `level`（`MatchState.pieces[i].level`）。出手、碰撞、AI worker（拿整份 state 的副本）、预测线都用 `pieceStats(data, p.playerId, p.level, p.cond)`。映射如下：
   - power → 出手速度倍率
   - radian → 弧线倍率
   - weight → 质量倍率
   - precision → 预测线显示比例（只在客户端，不进物理）
   - mind 只在状态模式里用（默认关闭）
4. **不把属性点当物理单位**：映射单独放在 `data/attr-mapping.json`（`attrmap-1`），依据写在文件内。
   - 归一域 [21, 119]：取自等级表全部 2250 行 × 5 项属性的实测最小值和最大值。导入器断言全表实测的最小/最大值正好等于域的两端（`tools/import-levels.ts:58`），所以每一行都在域内，Lv1 的低值和 Lv10 的高值都不会饱和。
   - 倍率区间：massMul [0.85, 1.25]、speedMul [0.92, 1.08]、curveMul [0.6, 1.4]、aimAssist [0.45, 1.0]。这些沿用 players-2 的设计值，文件里已注明「不是原版数值」。原因是材料包里没有原版的属性点 → 物理量公式，`reference_measurements.csv` 也只有表头。
5. `GameData.version` 现在是 `field-2/phys-2/players-2/skills-1/rules-1/levels-1/attrmap-1`，/healthz 实测能看到（§2 #5）。
6. `shared/physics.ts` 和 `data/physics.json` 都没动（§3）。

## 1. 改动文件

| 文件 | 性质 | SHA256 前 16 位 / 大小 / mtime |
|---|---|---|
| `data/levels.json` | 新增（导入器产物） | A197CB0D0FBEE16C / 185033 B / 11-16 01:18:56（幂等重跑，内容不变） |
| `data/attr-mapping.json` | 新增，attrmap-1 映射和依据 | AB1D4795D93E264C / 1480 B / 11-15 23:39:24 |
| `tools/import-levels.ts` | 新增，可复现导入器（第 58 行断言全表实测的最小/最大值等于 attr-mapping 的 [attrMin, attrMax]；输出 JSON 摘要） | ADA5E2F7583C734E / 10066 B / 23:44:45 |
| `shared/data.ts` | 修改：载入 levels、mapping，并拼接版本号 | 4D14F14823494407 / 2764 B / 23:46:01 |
| `shared/match.ts` | 修改：新增 `levelAttrs()`；`pieceStats()` 改为按等级取属性；`createMatch` 支持 `levels` | 9CE78BA59A4EBEC6 / 14625 B / 23:48:28 |
| `client/src/localHost.ts` | 修改：`levels` 透传给 `createMatch` | 8A336BBBB9FF5647 / 5078 B / 23:50:10 |
| `client/src/main.ts` | 修改：新增 `.card-level` 下拉、`cardLevel()`/`cardLevels()`、说明文字；人机、双人、在线三处入口都传等级 | 8A278A70FF2517B8 / 10451 B / 23:50:43 |
| `tools/calibrate.ts` | 修改：`--check` 报告新增「等级属性 → 物理」一节，并写入 calibration.json 的 `levels` | CD070865B42C1305 / 21181 B / 23:56:46 |
| `tools/physics-tests.ts` | 修改：**新增 1 条**「卡牌等级：按等级表取属性进入出手（Lv1–Lv10）」，原有 14 条没有改动 | 7C3AF89B6B26433E / 26076 B / 11-16 00:02:11 |
| `docs/calibration.md` / `docs/calibration.json` | calibrate 重新生成 | A18FCDDE8BD6ED8A / 6803 B；37C7491FE72768A4 / 8832 B / 01:18:22 |
| `docs/physics-tests.md` | 由 test:physics 重写 | 640E6D9409912F01 / 3578 B / 01:13:53 |

- 构建和测试副产物（不是手写的）：
  - `dist/client/**`：01:15:42 重建
  - `dist/server/index.js(.map)`：01:15:45 重建
  - `docs/screens/e2e-build-boot.png` / `e2e-build-shot.png`：test:e2e 于 01:16 重写
- 校验脚本：`runs/_t4a_xcheck.cjs`（等级表逐格对源）和 `runs/_t4a_calcmp.cjs`（phys-2 基线和备份比对）。都可以重跑，作为证据保留。

## 2. 实跑命令与原始结果

所有命令都在最后一次源码改动（00:02:11）之后由会话 #2 实跑。工作目录是 `D:/ai_for_games/碰撞全明星复刻`，「时间」取输出文件的 mtime。原始输出保留在 `runs/_t4a_<name>.out.txt`。

| # | 命令 | 时间 | 原始结果 | 指令基线 |
|---|---|---|---|---|
| 1 | `npm run typecheck` | 01:12:55 | exit 0，`tsc -p tsconfig.json --noEmit` 没有任何诊断输出 | exit 0 ✅ |
| 2 | `npm run test:physics` | 01:13:53 | `15/15 passed` | 原 14/14，加本任务新增 1 条 ✅ |
| 3 | `npx tsx tools/net-tests.ts` | 01:14:50 | `net-tests: PASS=176 FAIL=0`；`error codes exercised over the wire: 25/26 (not exercised: bad-seat-token)` | PASS=176 FAIL=0 ✅ |
| 4 | `npm run build`（先把旧 `dist/client` 改名为 `dist/_prev_client_T4a_s2`） | 01:15:45 | exit 0，`✓ built in 8.68s`。产物：`index-CPa6KufZ.js 510.88 kB │ gzip: 130.74 kB`、`aiWorker-DCxfrSxD.js` 333368 B、`index-DFW4i8NI.css 6.04 kB`、`dist\server\index.js 191.1kb`。vite 提示 `(!) Some chunks are larger than 500 kB`，只是警告（见 §6-1） | exit 0 ✅ |
| 5 | `npm run test:e2e`（`E2E_SERVER_PORT=2701`、`E2E_WEB_PORT=4273`） | 01:16:46 | `[e2e-browser] PASS=7 SKIP=0 FAIL=0`。其中 UI 一杆球 `shotNo 1 -> 2`，console error / pageerror 都是 0；/healthz 的 `dataVersion` 为 `field-2/phys-2/players-2/skills-1/rules-1/levels-1/attrmap-1` | PASS=7 SKIP=0 FAIL=0 ✅ |
| 6 | 先启动 `node dist/server/index.js`（`PORT=2702`、`ROOM_STORE_DIR=runs/_t4a_rooms`），日志为 `[server] listening on port 2702`；再跑 `npx tsx tools/online-e2e.ts`（`TEST_URL` 指向该服务端） | 01:17:25 | 两个独立 colyseus.js 客户端连真实服务端：PASS 行 17、FAIL 行 0，`online-e2e: PASS (0 failure(s))` | PASS=17 FAIL=0 ✅ |
| 7 | `npm run calibrate -- --check` | 01:18:22 | exit 0。`docs/calibration.md` 共 132 行，✅ 16 / ❌ 0 | 见 §4 |
| 8 | `npx tsx tools/import-levels.ts`（重跑，测幂等） | 01:18:56 | 摘要见 §5。`data/levels.json` 185033 B，sha256 `A197CB0D0FBEE16C…`，和首次导入一致 | — |
| 9 | `node runs/_t4a_xcheck.cjs` | 01:24 | `players cells 1060, equal to 1.5.5 source 1060, no source row 0; source rows placed 2250/2250` | — |
| 10 | `node runs/_t4a_calcmp.cjs` | 01:26 | `baseline diffs (targets/measured/physics): 0`。顶层键从 `meta,targets,measured,physics` 变为 `meta,targets,measured,levels,physics`，只多了 `levels` | — |
| 11 | Playwright 浏览器实测（会话 #2，dist 构建） | — | 下拉选项为 Lv1…Lv10，默认 Lv5。选 Lv10 后写入 `pz_card_level`，刷新页面仍是 Lv10。开人机对局，canvas 正常渲染，console error / pageerror 为 0 | — |

**新增 physics 用例的原始输出**：

`PASS  卡牌等级：按等级表取属性进入出手（Lv1–Lv10）  —  106 名有原表球员 × 10 级 = 1060 格：运行时属性等于 data/levels.json 1060/1060，属性点在映射域 [21, 119] 内 1060/1060；Lv10 的速度、弧线、质量倍率都高于 Lv1 的 106/106 人（数据本身的性质，只记录）；同一场比赛两边同一名球员 p01（srcId 40108）分别 Lv1 / Lv10：power 74 → 105，radian 77 → 110，weight 31 → 44；出手速度 ×1.007 → ×1.057，弧线 ×1.057 → ×1.327，质量 ×0.891 → ×0.944（与表值按 attr-mapping 算出的一致：是）；真实球场 50% 力度直线滑行 4.17 → 4.54 m，满弧线横向偏移 0.83 → 1.16 m`

**30 场随机完整比赛**：`出手 2909 次，进球 55，技能事件 271，非法/越权出手被拒 11636 次，全部正常结束 30/30`。T2-a 当时是 2862 / 51 / 206 / 11448。
- 数字变了是预期内的：Lv5 的属性现在取自原版等级表，不再由 players-2 的 attrs 推算，倍率随之改变，同一种子下的比赛轨迹也就不同了。
- 两次都满足「被拒次数 = 4 × 出手次数」。
- 断言没有弱化：`rulesFuzz` 仍是 `makeRng(777)`，每场最多 200 杆（`guard++ < 200`）。每杆先试 4 种非法输入（对方球员、非本方回合、power 2、dirX NaN），4 种都必须被拒；最后断言 `problems === 0 && ended === matches`（`tools/physics-tests.ts:318-362`）。

## 3. 未动文件（红线核对）

- `shared/physics.ts`：mtime 11-14 21:13:48，未动。
- `data/physics.json`：SHA256 `6C9AC4B291A7328A…`，mtime 11-14 21:25:02，未动，仍是 phys-2。
- 11-16 01:31:56 实测：`shared/ server/ client/ data/ tools/ docs/ art/` 下 mtime 晚于本任务开始时间（11-15 23:12）的文件共 14 个，即 §1 表中的 12 个加 2 张 e2e 截图。项目根目录的文件（含 `package.json`、`tsconfig.json`）0 个。`data/fields|skills|rules|players.json`、`server/**`、`tools/net-tests.ts`、`tools/online-e2e.ts` 都不在其中，`data/rooms/` 下也没有新文件。
- 测试：没有删除、没有 skip、没有弱化。physics 从 14 条增加到 15 条，net 176 条、e2e 7 条、online 17 条都不变。
- 没有编造数值：11 名重建球员没有原表，标为估算（§6-2）；90001 标为 pending-confirmation（§6-6）。

## 4. 校准

- 为什么跑 `npm run calibrate -- --check`，而不是不带参数的全量寻优：
  - 全量寻优会把搜索结果**改写进 `data/physics.json`**（`tools/calibrate.ts:378`），也就是 phys-2 物理常量。
  - T4-a 改的是属性 → 倍率的映射（独立放在 `data/attr-mapping.json`），没有改物理常量，没有理由重新寻优。物理常量又受红线保护。
  - `--check` 用现行 physics.json 做全部实测，并重写 `docs/calibration.md/.json`。新基线就是这样写进去的。
- **phys-2 原基线没有变**：和 `backups/20261115085708/files/docs/calibration.json` 比，`targets / measured / physics` 三块 0 处差异（§2 #10），16 项目标全部 ✅。
- **新基线**：`docs/calibration.md` 第 51–75 行「等级属性 → 物理」。内容是 106 名有原表球员在 Lv1 / Lv5 / Lv10 下的属性点最低 / 中位 / 最高、对应倍率，以及正式 ShotRunner 的空场实测：
  - 满力空场滑行：Lv1 为 0.768 / 0.833 / 0.897 L，Lv10 为 0.789 / 0.878 / 0.978 L
  - 满力满弧线横向偏移：Lv1 为 1.34 / 1.93 / 2.30 m，Lv10 为 1.50 / 2.27 / 2.83 m
  - 正撞足球速度：×1.22–1.35
  - 同样的数据也写在 `docs/calibration.json#levels`。

## 5. 导入摘要（`tools/import-levels.ts` 原始输出要点）

- 总量：`rows 2250`（`1.2.0: 880`、`1.5.5: 1370`）
- players 段：`players 106 / playerRows 1060`
- others 段：`others 119 / otherRows 1190`（`others120 88`、`variants155 31`）
- 取值范围：`valueRange 21–119`
- 双版本对比：`versionDiffs.pairsInBoth 880`、`pairsDiffer 30`，涉及卡 `10303 / 20201 / 40301`
- 缺失：`cardRecordMissing ["1.2.0|90001"]`
- 名册覆盖：`rosterFromTable 106`、`rosterRebuilt p06–p16`（11 人）、`tablePlayersNotInRoster []`

## 6. 遗留问题 / 本任务未做

1. **包体积**：levels.json 同时打进了主包和 AI worker（各约 +73 kB；index 437.40 → 510.88 kB，aiWorker 260.77 → 333.37 kB），也打进了服务端包（113554 → 195636 B）。主包因此第一次超过 vite 的 500 kB 提示线。这只是警告，不影响 exit 0。可以优化：运行时不打包 `others`，因为只有 T4-b 需要它，这样大约能减半。本任务没做，避免越界。
2. **11 名重建球员 p06–p16**（srcId 为空）没有原表，各等级按 `players.json` 的 attrs + growth × (lv−1) 估算，上限 119。这是估算值，不是原版数据；calibration 的等级表也没有收录他们。
3. **倍率区间是重建设计值**，不是原版公式。材料包没有原版公式，`reference_measurements.csv` 为空，因此没有伪造。等以后有原版实测，再调 `data/attr-mapping.json` 并重跑 calibrate。
4. **`others` 段（119 张卡）运行时不使用**，交给 T4-b（卡牌变体 224 条 → `cards.json`）。
5. **双版本差异 30 处**（卡 10303 / 20201 / 40301）：运行时统一取 1.5.5，这是 D5 的复刻策略，不是原版优先级。1.2.0 的值原样保存在 `others`，没有丢失。
6. **1.2.0|90001（早期齐祖）**的卡记录缺失，按 D6 标为 pending-confirmation，不进名册。
7. 30 场随机比赛的统计数字和 T2-a 不同，属于预期变化（§2）。后续会话请以本文件的 2909 / 55 / 271 / 11636 为新参照。
8. **UI 一次只能给全部 5 名球员设同一个等级**。逐人选等级的 UI 没做，协议和服务端都已支持 per-slot。人机对战时电脑固定 Lv5。
9. test:e2e 和 online-e2e 只覆盖默认等级。非默认等级由 net-tests 覆盖（levels [3,4,5,6,7] 广播，加 4 种 bad-level），也由 physics 的 1060 格用例覆盖。
10. `bad-seat-token` 错误码仍然没有经过线上路径（25/26），这是既有问题，不是本任务引入的。
11. 临时文件：
    - 保留作证据：`runs/_t4a_{typecheck,physics,net,build,e2e,online,calibrate,import}.out.txt`、`runs/_t4a_srv.out.txt` / `.err.txt`（err 是 0 B）、`runs/_t4a_xcheck.cjs`、`runs/_t4a_calcmp.cjs`。
    - 已按文件名逐个删除：`runs/_t4a_rooms/BNN5UU.json`（online-e2e 的测试房间，只含测试 seat token）、`runs/_t4a_rooms/`、`runs/_t4a_srv.pid`（进程已退出）。
    - `data/rooms/` 为空；2701/2702/4273 端口都没有残留监听。
    - `dist/_prev_client_T4a/`（238 个文件）和 `dist/_prev_client_T4a_s2/`（272 个文件）是重建前改名保存的旧 `dist/client`，用来避开 vite emptyOutDir 触发的 safe-delete 拦截。可以安全删除，本会话没删。
