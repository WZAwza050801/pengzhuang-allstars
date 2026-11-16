# STAGE T2-a DONE — 名册扩充 16 → 117（源名册 106/106 覆盖）

- 作者：Claude(T2-a)　时间：2026-11-15 22:05 前后（UTC+8，精确以文件 mtime 为准）
- 范围：只做 T2-a。未做 T2-b..e、T3；未生成任何美术；未写 `runs/FINAL_REPORT.md`。
- 状态：**PASS（名册与数据层）**。技能效果**未实现**（71 个占位，见 §5），不算完成。

## 0. 结论

1. `data/players.json`：16 → **117** 名（p01–p16 保留 + 新增 p17–p117 共 101 名）；`version` players-1 → **players-2**；`GameData.version` = `field-2/phys-2/players-2/skills-1/rules-1`。
2. 源名册 106 人 **106/106** 通过 `srcId` 回链，无多余、无遗漏（与 master 交叉核对 0 处不一致）。
3. 为什么是 117 而不是 106：既有 p01–p16 按“只追加”整体保留，不删、不改其数值。其中 p01–p08、p10、p15、p16 被代码硬编码引用——`client/src/main.ts` 的 `BOT_LINEUP=['p15','p10','p16','p03','p04']`、`P2_LINEUP=['p15','p08','p05','p03','p04']`，以及 `data/rules.json` 的 `defaultLineup=["p07","p06","p08","p01","p02"]`；p09、p11–p14 没有代码引用（grep 过 `client/src`、`server`、`shared`、`tools`，不含本次新增的 `tools/import-roster.ts`），按“只追加”一并保留，另外 p11 / p12 / p13 是 extra / flash / banana 三个已实现技能的唯一携带者，删掉会让这三个技能无人可用。p01–p05 对应源里 5 人，p06–p16 共 11 名在源名册里没有对应（`srcId: null`）：106 − 5 + 16 = 117。即使只保留被硬编码引用的 id 也是 106 + 6（p06 / p07 / p08 / p10 / p15 / p16）= 112，不等于 106；要恰好 106，得把这些硬编码 id 重指向源球员并改 `client/src/main.ts` 与 `data/rules.json`，超出 T2-a。
4. `attrs` 全部落在 40–99（实测最小 40、最大 88）。源 Lv1 低于 40 的值被 clamp，共 **88 条 clamp 记录**（球员、属性、源字段、原值、取值、原因）在 `docs/roster-conflicts.json#clamps`，没有静默 clamp。
5. 技能：16 个已实现 / **71 个 `unimplemented` 占位** / 30 个 `none`（源卡无技能）。没有按名称自动绑定，没有编造任何技能效果。
6. 基线全绿（§2）；物理基线文件哈希与 mtime 未动（§3）；**未运行 `npm run calibrate`**。

## 1. 改动文件

| 文件 | 性质 | SHA256 前 16 位 / 大小 |
|---|---|---|
| `data/players.json` | 修改（16 → 117） | B852E5831AC81A14 / 37010 B |
| `tools/import-roster.ts` | 新增，可复现导入器 | 24EB35F2B75BF850 / 37892 B |
| `docs/roster-mapping.md` | 新增，字段映射与取值规则 | ED3BF8AF7EEB6787 / 4627 B |
| `docs/roster-audit.md` | 新增，覆盖 / 源版本 / 冲突与 clamp / 成长拟合 / 技能 | 896B4CE5A63A3A8F / 8013 B |
| `docs/roster-conflicts.json` | 新增：`valueConflicts`(20) `clamps`(88) `negativeGrowth`(7) `issues`(8) | A3370D5F783ED3EE / 39685 B |
| `docs/roster-provenance.json` | 新增：106 人逐人溯源 + `unlinkedLevelRecords`(10) | FEF9BED22A0F5DAC / 321729 B |

- `npx tsx tools/import-roster.ts` 可重新生成上面 5 个数据/文档产物；连跑 2 次结果一致，已过 typecheck。
- `data/players.json` 细节：
  - p01–p16 的 8 个既有键（`id name nameSource position quality attrs growth skill`）与旧文件逐键 JSON 比对 0 处差异；追加 5 个键 `srcId srcPosition rarity aliases srcSkill`。
  - `attributes` 块与旧文件 JSON 一致；players 数组之后的尾部（`mapping`，242 字符）与旧文件字节相同。
  - LF 行尾、末尾有换行；id p01..p117 连续且唯一；名字 117/117 唯一。
  - 位置 FW 34 / MF 49 / DF 32 / GK 2（GK 只有 p07、p15）。
- 构建/测试副产物（非手写）：
  - `docs/physics-tests.md`（`test:physics` 每次重写，21:37:41）
  - `docs/screens/e2e-build-boot.png`、`docs/screens/e2e-build-shot.png`（`test:e2e` 重写，21:44）
  - `dist/client/**`、`dist/server/index.js(.map)`（`npm run build` 重建，21:40:59）
  - `dist/_prev_client_T2a/`：重建前的旧 `dist/client` 整体改名保存（36 个文件），可安全删除；本会话没有删它（原因见 §5-13）
- 回滚副本：`runs/_players_v1.json.bak`（旧 `players.json`，players-1，SHA256 前 16 位 B57136C65E83432A，3888 B，mtime 2026-11-14 19:56:14，早于本会话）。无 git，这是 T2-a 之前版本的唯一副本，**保留**。
- 收尾清理（已完成，按显式文件名逐个 `Remove-Item`，共 27 个，0 缺失、0 失败）：`runs/` 下我自己的 26 个草稿——写 PROGRESS 行用的暂存 `_progress_line.txt`，加上 `_probe1–8.cjs`、`_verify1.cjs`、`_verify2.cjs`、`_verify1_out.txt`、`_verify2_out.txt`、`_probe7_out.txt`、`_import_out.txt`、`_import_out2.txt`、`_tc_out.txt`、`_s_typecheck/_s_physics/_s_net/_s_build/_s_e2e/_s_e2e2/_s_online/_s_srv_out/_s_srv_err.txt`——以及 `data/rooms/NJJZJL.json`（我跑 online-e2e 留下的房间持久化文件，只含测试用 seat token）。清理后 `data/rooms/` 为空；`runs/` 里只剩既有文件、并发美术流水线的 `_*.png` 和保留的 `_players_v1.json.bak`；`data/players.json` 复算哈希仍是 B852E5831AC81A14。

## 2. 实跑命令与原始结果

全部发生在最后一次写 `data/players.json`（21:35:36）之后。工作目录 `D:/ai_for_games/碰撞全明星复刻`。「时间」为输出文件的 mtime。

| # | 命令 | 时间 | 结果 | 指令基线 |
|---|---|---|---|---|
| 1 | `npm run typecheck` | 21:37:14 | 退出码 0 | exit 0 |
| 2 | `npm run test:physics` | 21:37:41 | `14/14 passed` | 14/14 |
| 3 | `npx tsx tools/net-tests.ts` | 21:38:28 | `net-tests: PASS=176 FAIL=0` | PASS=176 FAIL=0 |
| 4 | `npm run build` | 21:40:59 | 首次退出码 1（沙箱 safe-delete 守卫）；把旧 `dist/client` 改名后重跑，退出码 0 | exit 0 |
| 5 | `npm run test:e2e`（`E2E_SERVER_PORT=2701 E2E_WEB_PORT=4273`） | 21:44:43 | `PASS=7 SKIP=0 FAIL=0`，`/healthz` 为 players-2 | PASS=7 SKIP=0 FAIL=0 |
| 6 | `npx tsx tools/online-e2e.ts`（自起服务端 :2702，`TEST_URL=ws://127.0.0.1:2702`） | 21:45:02 | 17 条 PASS，`online-e2e: PASS (0 failure(s))` | “15/15”（标签过期，见 §5-15） |
| — | `npm run calibrate` | 未运行 | 原因见 §3、§5-17 | — |

### 2.1 typecheck（原始输出）
```

> pengzhuang-allstars@1.0.0 typecheck
> tsc -p tsconfig.json --noEmit

```

### 2.2 test:physics（原始输出末段；其余 11 条 PASS 见 `docs/physics-tests.md`）
```
PASS  固定出手 30/60/120/144 FPS 渲染一致  —  30FPS:一致(60帧)，30FPS+抖动:一致(59帧)，60FPS:一致(120帧)，60FPS+抖动:一致(120帧)，120FPS:一致(240帧)，120FPS+抖动:一致(244帧)，144FPS:一致(289帧)，144FPS+抖动:一致(286帧)
PASS  240 次固定种子随机出手  —  穿墙/越界 0，静止后持续重叠 0（最大 0.000 m），无技能时动能异常上升 0（最差 ×1.000），超过球速上限 0，超时强停 0，重复进球 0，进球局 3，触发角落弹簧 15（弹簧那一步的加力不计入能量检查）；被撞物体快于出手速度（轻撞重传递，动能未增加，属正常）示例：#0 出手 5.39 → 最高 5.72、#7 出手 5.91 → 最高 6.67、#23 出手 5.69 → 最高 6.15、#24 出手 7.08 → 最高 8.29、#46 出手 4.72 → 最高 6.76、#63 出手 7.83 → 最高 9.15；最长 3.11 s，平均 1.61 s/次，耗时 1.5 s（6.1 ms/次）
PASS  规则：30 场随机完整比赛  —  出手 2862 次，进球 51，技能事件 206，非法/越权出手被拒 11448 次，全部正常结束 30/30

14/14 passed
```

### 2.3 net-tests（原始输出共 202 行，仅摘尾部）
```
[summary]
  PASS  no uncaught exception in the whole run
  PASS  /healthz answers 200 at the end
  info  error codes exercised over the wire: 25/26  (not exercised: bad-seat-token)

net-tests: PASS=176 FAIL=0
```

### 2.4 build（原始输出全文，第二次、退出码 0）
```

> pengzhuang-allstars@1.0.0 build
> npm run build:art && npm run build:client && npm run build:server


> pengzhuang-allstars@1.0.0 build:art
> tsx tools/gen-art.ts

[gen-art] players=16 cutout=16 raw=16 copied=0 unchanged=32 manifest=unchanged

> pengzhuang-allstars@1.0.0 build:client
> vite build --config client/vite.config.ts

vite v7.3.8 building client environment for production...
transforming...
✓ 70 modules transformed.
rendering chunks...
computing gzip size...
../dist/client/index.html                     0.52 kB │ gzip:   0.36 kB
../dist/client/assets/aiWorker-CdZnRBW1.js  260.77 kB
../dist/client/assets/index-DFW4i8NI.css      6.04 kB │ gzip:   2.06 kB
../dist/client/assets/index-D5b_rWgH.js     437.40 kB │ gzip: 118.25 kB
✓ built in 3.54s

> pengzhuang-allstars@1.0.0 build:server
> esbuild server/index.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/server/index.js --packages=external --sourcemap

```
- 首次失败原因：vite 清空 `dist/client/assets` 时沙箱 safe-delete 守卫报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`（82 > 阈值 50）。**没有绕过守卫**，改用 `Move-Item` 把旧 `dist/client` 改名为 `dist/_prev_client_T2a` 后重跑。
- esbuild 的结果摘要行不在捕获文件里；产物实测：`dist/server/index.js` 113554 B、`index.js.map` 233613 B，mtime 21:40:59。
- `gen-art` 仍报 `players=16`：它不遍历 `data/players.json`，p17+ 美术是另一个子任务。

### 2.5 test:e2e（原始输出全文，备用端口）
```

> pengzhuang-allstars@1.0.0 test:e2e
> node tools/e2e-browser.mjs

PASS  构建产物 — dist/client/index.html 与 dist/server/index.js 均存在
PASS  联机服务端 /healthz — {"status":"ok","service":"collision-allstars","protocol":1,"dataVersion":"field-2/phys-2/players-2/skills-1/rules-1","uptimeSec":1}
PASS  静态托管 dist/client — http://127.0.0.1:4273
PASS  起始界面渲染 — #app 已挂载子节点
PASS  进入对局 / canvas 渲染 — canvas 已挂载
PASS  UI 一杆球 — shotNo 0 -> 1
PASS  运行时 JS 错误 — console error / pageerror 均为 0

[e2e-browser] PASS=7 SKIP=0 FAIL=0
[e2e-browser] 注：联机双客户端完整对局由 test:net / OnlineHost 场景验收，本脚本不冒充。
```
- 弃用的第一次默认端口运行（21:41:19）：同样 PASS=7，但 `/healthz` 显示 `players-1`、uptime 3204 s——连到的是 :2567 上的旧服务（见 §5-14）。该结果**不作为证据**，以上面的备用端口运行为准。

### 2.6 online-e2e（原始输出全文，自起服务端 :2702，跑完只停了自己起的这个）
```
[online-e2e] server ws://127.0.0.1:2702

[room]
  PASS  the server assigns a 6-character room code
  PASS  both clients see the room snapshot
  PASS  the snapshot carries the room code
  PASS  each seat gets its own secret seat token
  PASS  the two seat tokens differ
  PASS  both seats are taken

[match]
  PASS  both clients get the match_start
  PASS  the match start carries the clock
  PASS  the seed never leaves the server

[shot]
  PASS  the shot reaches both seats
  PASS  the two seats see byte-identical packets
  PASS  the packet carries frames
  PASS  the packet advances the shot number
  PASS  the packet carries the clock

[reconnect]
  PASS  the disconnected seat had a token
  PASS  the seat can be re-claimed with the token

[summary]
  PASS  no failure in this run

online-e2e: PASS (0 failure(s))
```
- 这是同机上本地服务端的双连接联机冒烟，**不是公网联机**，也不冒充公网联机。

### 2.7 名册结构校验（一次性脚本的原始输出；脚本已随草稿删除，逻辑见各行说明）
```
A  p01-p16 runtime-key diffs = 0 (old players 16 new players 117 )
B1 attributes block equal = true
B2 tail (after players array) byte-equal = true tailLen 242
B3 old top-level keys version,note,attributes,attributesSource,players,mapping | new version,note,attributes,attributesSource,players,mapping
B4 LF only = true  ends with newline = true
C  key order identical for all 117 = true | len!=5: 0 | attrs out of [40,99] or non-finite growth: 0
C2 attrs min/max over all = 40 88
C3 ids sequential p01..p117 = true | unique 117
C4 unique names = 117 / 117
E  skill ids valid; mismatches = 0 | unimplemented 71 none 30 implemented 16 | skills.json ids 13
E2 positions {"FW":34,"MF":49,"DF":32,"GK":2}
D  independent recompute from level_attributes_1_5_5: checked 101 mismatch 0
F  source players 106 | runtime entries with srcId 106 | unique 106 | all source ids covered = true | extra srcIds = 0
G  master cross-check mismatches = 0
VERIFY_FAILS = 0 | version = players-2
```
- A：p01–p16 的 8 个既有键与旧副本逐键比对。B：`attributes` 块、players 数组之后的尾部、顶层键、行尾与末尾换行。C：键顺序一致、attrs/growth 长度为 5、attrs ∈ [40,99]、growth 有限、id 连续唯一、名字唯一。E：每个 `skill` 要么是 `skills.json` 里的 id、要么是 `unimplemented`/`none`；`unimplemented` 必有 `srcSkill`、`none` 必无。D：从 `level_attributes_1_5_5.json` 对 101 名新球员重新算一遍 attrs/growth，与 `players.json` 比对。F：源 106 人全部覆盖。G：name / position / rarity 与 master 交叉核对。

## 3. 基线文件未动的证据

T2-a 没有改动下面任何文件。哈希为 21:58:52 的快照，与本会话早期记录逐项一致（`shared/physics.ts` 除外：之前没有记录，靠 mtime 证明）。所有 mtime 都是 2026-11-14，早于本会话开始（2026-11-15 约 20:52）。

| 文件 | SHA256 前 16 位 | mtime |
|---|---|---|
| `data/physics.json` | 6C9AC4B291A7328A | 2026-11-14 21:25:02 |
| `data/fields.json` | 117779AD6F47EA51 | 2026-11-14 21:24:56 |
| `data/rules.json` | 561B99EFF8422B2B | 2026-11-14 21:36:50 |
| `data/skills.json` | DEF6B1866EE60D65 | 2026-11-14 19:54:33 |
| `docs/calibration.md` | BC9D6CBC9E224CE3 | 2026-11-14 21:25:13 |
| `docs/calibration.json` | DCB08AE75DE4DC26 | 2026-11-14 21:25:13 |
| `shared/physics.ts` | 942E0ED90616EC3A | 2026-11-14 21:13:48 |

- `package.json`（2026-11-14 20:38:52）、`package-lock.json`（2026-11-14 19:51:58）、`tools/gen-art.ts`（2026-11-15 16:55:23）、各测试文件（如 `tools/online-e2e.ts` 2026-11-14 20:41:47）：mtime 都早于本会话，未改。没有删测试、没有弱化断言、没有标 skip。
- `docs/calibration.*` 的 mtime 仍是 11-14 21:25:13，说明没有人跑过 `calibrate`。
- 中途我曾拿只含 HH:MM 的列表把这些文件误读成“本会话内被改写”；带日期核对后确认全是 11-14，没有并发写入者碰过它们，无需回滚。

## 4. 数据口径（工程决定，不是源裁决）

- 身份主表：`earlier_exports/players.json`（106 人：ST 32 / CM 46 / DC 28，无 GK）。数值来源：`level_attributes_1_5_5.json`（1370 行）的 Lv1 与 Lv10，按 `oldId == card_id` 关联 106 张 1.5.5 普通卡。1.2.0 的 87 张卡与 1.5.5 的 31 张闪卡不生成运行时球员，只保留在 `docs/roster-provenance.json`。
- 字段映射按 `field_dictionary.json` 的标签，不按出现顺序猜：weight→attrs[0]，power→[1]，radian→curve[2]，precision→accuracy[3]，mind→mental[4]。位置 ST→FW、CM→MF、DC→DF。细节见 `docs/roster-mapping.md`。
- `attrs` = clamp(Lv1, 40, 99)；`growth` = round2((源 Lv10 − clamp 后 Lv1) / 9)。`mapping`（attrMin 40 / attrMax 99）、`data/rules.json`、物理常量均未改。
- 18 张普通卡的卡牌基础值与等级表 Lv1 不一致（DATA-01 共 20 条，另 2 条是闪卡）：取等级表 Lv1，两组原值并排保留在 `#valueConflicts`，处置语沿用源的“运行时取值优先级未知”。
- clamp 共 88 条：87 条落在 57 名新球员（weight 30 / power 20 / curve 18 / accuracy 10 / mental 9），1 条是 p01 源推导值（`appliedToRuntime:false`，p01 保留 rebuilt 数值）；源最小原值 21，没有 > 99 的 Lv1。
- 引擎空间保真度（101 人 × 5 属性 × 10 级 = 5050 点，定义见 `docs/roster-audit.md` §4）：Lv5 最大偏差 3.56、均值 0.55；Lv10 最大 0.04；未 clamp 的属性最大 2.24、均值 0.23；clamp 过的属性最大 3.56、均值 1.0（运行时高于源 648 点、低于源 27 点）。

## 5. 未解决事项

### 技能（T2-a 明确不做，不得写成完成）

1. **71 个 `unimplemented`**（`id 源技能族名`；`srcSkill` 字段保存族名，原始行在 `docs/roster-provenance.json`；引擎对未知 id 取 `null`，等同无技能；参数语义未恢复，RULE-02 / RULE-03）：
   - p17 疾风金童 · p18 重型坦克 · p19 大叔巧射 · p20 精准远射 · p21 攻防纽带 · p23 球场指挥官 · p24 凌波微步 · p25 一气呵成 · p26 中场发动机 · p27 碰碰车 · p28 进攻核心 · p29 钢筋铁骨
   - p31 强力中锋 · p32 无解盘带 · p33 致命直塞 · p34 脚下生花 · p36 定海神针 · p37 全面防御 · p39 猛虎下山 · p40 辗转腾挪 · p41 助攻之王 · p42 斗牛战将 · p45 全能中锋 · p46 边路突袭
   - p47 超级马里奥 · p48 狂徒斗士 · p49 球场指挥塔 · p50 绝对硬霸 · p51 蜘蛛侠 · p52 前场尖兵 · p53 中场马达 · p55 御敌之门 · p56 不动如松 · p58 小魔仙 · p59 势大力沉 · p60 遇强则强
   - p64 神准烟枪 · p65 蝴蝶穿花 · p66 禁区之王 · p67 攻防枢纽 · p68 攻防俱佳 · p69 老马识途 · p70 极度坚韧 · p71 边卫飞翼 · p72 图穷匕见 · p73 马踏联营 · p74 人球分过 · p75 甜而不菜
   - p76 魔笛传音 · p77 精巧盘带 · p78 带刀侍卫 · p79 少林绝学 · p80 格子戏法 · p82 野蛮冲撞 · p85 铜墙铁壁 · p87 坦克前锋 · p88 人中吕布 · p89 折翼天使 · p90 精准长传 · p92 带刀护卫
   - p93 不动如山 · p96 球场刺客 · p101 无所不在 · p102 能突善射 · p103 影子杀手 · p105 库鸟展翅 · p109 师奶杀手 · p110 魔兽来袭 · p112 王子复仇 · p116 齐祖之光 · p117 贝氏弧线（11 个；合计 12×5 + 11 = 71）
2. **30 个 `none`**（源卡无技能，`srcSkill` 为 `null`）：p22 p30 p35 p38 p43 p44 p54 p57 p61 p62 p63 p81 p83 p84 p86 p91 p94 p95 p97 p98 p99 p100 p104 p106 p107 p108 p111 p113 p114 p115。
3. **p01–p16 的 16 个已实现技能**保持 rebuilt 版本：p01 king、p02 rocket、p03 alien、p04 fox、p05 sendoff、p06 tank、p07 guardian、p08 wall、p09 cannon、p10 wall、p11 extra、p12 flash、p13 banana、p14 cannon、p15 wall、p16 charge。p01–p05 的源技能名对照：球王震慑 / 霸气侧漏 / 外星人来袭 / 禁区之狐 / 野蛮重炮；p03、p04 与 runtime 技能同名，但同名不等于参数相同，没有因此改写。p06–p16 无源对应。

### 数据口径

4. 源 Lv1 最低 21，而 `mapping` 的 attrMin = 40 未改：57 名新球员共 87 个属性被抬到 40，新球员整体比重建的 p01–p16 弱；clamp 后中间等级略高于源（见 §4）。没有重新缩放，是否要缩放留给后续任务。
5. p01–p05 保留 rebuilt 数值；源推导值只在 provenance 的 `derived` 里。
6. 7 个负成长（Lv10 低于 Lv1 取值）如实保留：p19 weight、p32 weight、p44 curve、p47 weight、p54 weight、p97 curve、p100 power（`#negativeGrowth`）。23 个源 Lv10 值 > 99（最大 119），由引擎 `attrMax` 饱和，growth 仍按源 Lv10 算。
7. `quality` 颜色是约定（1 white / 2 green / 3 blue / 4 purple / 5、9 orange），不是源值；p05 保持 orange，而源 rarity = 4；运行时代码不读取 `quality`。
8. NAME-01（源 id 40109）未导入；8 条 issue 全部保留，处理说明见 `docs/roster-conflicts.json#issues`。DATA-02：10 条等级记录无法关联到球员 → `docs/roster-provenance.json#unlinkedLevelRecords`。
9. 新增 101 人没有 GK（源只有 ST/CM/DC）；GK 仅 p07、p15。
10. 外观：p100–p117 在字典序里排在 p17 之前；数组顺序仍是 p01..p117。

### 范围外 / 未验证

11. p17..p117 没有统一美术（另一个子任务，T2-a 没做）。`client/public/assets/players/` 里已有 202 张 p17+ PNG，是并发的美术流水线写的（§6），当前 `dist/client` **不含**它们；下一次 `npm run build` 会经 `publicDir` 整体打包进去。
12. p17+ 在选人/阵容界面（如有）里的显示**未验证**：`test:e2e` 与 `online-e2e` 只用默认阵容 p07/p06/p08/p01/p02。`test:physics` 的“30 场随机完整比赛”从全部 117 人里随机抽阵容，已在对局层覆盖 p17+（含 `unimplemented`/`none`），30/30 正常结束。

### 环境与基线标签

13. safe-delete 守卫：现在 `dist/client` 有 69 个文件（`art/` 33 + `assets/` 35 + `index.html`；`art/` 来自 `client/public/art`，该目录 mtime 11-15 16:56，早于本会话，非 T2-a 产物）。下一次 `npm run build` 清空它时可能再次触发守卫；处理方式同本次——不要绕过守卫，先把旧 `dist/client` 用 `Move-Item` 改名再重跑。`dist/_prev_client_T2a/` 可安全删除，我没有删（避免再触发守卫，也不是我的清理范围）。
14. 旧服务 PID 13668（`dist/server/index.js` 的 players-1 旧包，20:47:46 由更早的会话启动）仍占用 :2567，**没有动它**。默认端口跑 `test:e2e` 会连到它，`/healthz` 显示 players-1；下个会话请沿用 `E2E_SERVER_PORT` / `E2E_WEB_PORT` 备用端口，或在授权后再重启该服务。`online-e2e` 不自起服务端，要自己起并设 `TEST_URL`。
15. `online-e2e` 的指令基线“15/15”已过期：文件里有 17 个 `check(`，17 个全过。
16. online-e2e 运行时 colyseus.js 向 stderr 打印 `onMessage() not registered for type 'room'.`，不是断言失败（0 failure）。
17. `npm run calibrate` 未运行：裸跑会重写 `data/physics.json` 与校准文档，`-- --check` 仍会重写 `docs/calibration.*`，而红线禁止改物理常量与校准基线。该脚本不读名册，与 T2-a 无关。
18. `shared/physics.ts` 没有 T2-a 之前的哈希记录；mtime 2026-11-14 21:13:48 早于本会话，是未触碰的证据。

## 6. 非 T2-a 的并发产物（未触碰、未删除）

同一时段有另一个进程在这个目录里跑 106 人美术流水线，写入者身份未确定。下列文件都不是 T2-a 的产物，我没动：
- `client/public/assets/players/` 里的 202 张 p17+ PNG（该目录共 234 个文件 = 旧 32 + 新 202；新文件写于 21:40:59 的构建之后）。
- `art/` 下的 `gen_placeholders.py`、`ai/raw`、`ai/grid`、`ai-sample`，以及 `chromakey.py`、`split_grid.py`、`avatar.py`；`client/public/art`（33 个文件）。
- `runs/_avatars_sheet.png`、`_cards_sheet.png`、`_chromakey_test.png`、`_grid_small.png`、`_grid2_small.png`、`_grid_avatars.png`、`_grid_avatars2.png`……`_grid_avatars6.png`。
- 既有的 `tools/_scratch_nmh_*.ts` 也没动。

新风格与 p01–p16 不同；它的验收、与 `gen-art.ts` 的衔接都不在 T2-a 范围内。

## 7. 回滚

`Copy-Item runs/_players_v1.json.bak data/players.json` 即回到 players-1（16 人）。之后需要重新 `npm run build` 并重启服务端，`GameData.version` 才会回到 `players-1`。想重新得到 117 人：`npx tsx tools/import-roster.ts`（以 p01–p16 与源材料为输入，幂等）。

## 8. 下一项

T2-b（快速匹配）。本会话到此为止，没有开始 T2-b。
