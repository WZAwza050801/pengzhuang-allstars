# STAGE T4-b DONE — 卡牌变体 224 条入库 → data/cards.json（1.2.0/1.5.5 并存，20 条冲突保留）

- 作者：Opus。watcher v4 接力会话，在 T4-a 收尾（`STAGE_T4a_DONE.md` mtime 11-16 01:33:26）之后开工，第一个结构探针的输出时间是 01:37:09，02:13 前后收尾。中途经历过上下文压缩，没有重做调研。
- 范围：只做了 T4-b。T4-c..f、T2-b/b2/c/d/e、T3 都没做，也没写 `runs/FINAL_REPORT.md`。
- 状态：**PASS**。
  - 六项基线全绿（§2）。
  - 独立核对脚本 `runs/_t4b_xcheck.cjs` 结果 PASS=31 FAIL=0。
  - 导入器连跑两次，输出的 sha256 一致。

## 0. 结论

1. **入库**：`data/cards.json`（`version: "cards-1"`）收录了 `materials/.../02_players_and_data/card_records.json` 的全部 **224/224** 行。
   - 行顺序和源表相同。21 个源字段逐个原样保留，值、类型、字段顺序都一致（224/224）。
   - 构成：1.2.0 普通卡 87 张；1.5.5 普通卡 106 张、闪卡 31 张。
   - 每张卡在源字段之后追加了派生字段：
     - `playerId`：名册 id
     - `skillIds` / `unlockLevels` / `flashSkillIds`：把源字段里 `;` 分隔的字符串拆成数组
     - `foilKey` / `normalKey`：普通卡与闪卡互相指向，31/31
     - `levelsRef`：指向 `data/levels.json` 的段和键
     - `conflict`：这张卡是否在 20 条冲突里
2. **1.2.0 与 1.5.5 并存**：键是 `版本|card_id`，同一个 card_id 的两个版本各占一条。87 对都在，没有合并，也没有覆盖。
   - 87 对里有 28 对存在字段差异：
     - foil 不同 28 对，全部是「1.2.0 为空，1.5.5 指向闪卡」
     - rarity 不同 2 对
     - 五项属性不同 3 对（10303 / 20201 / 40301，见 §5）
   - 差异汇总写在 `meta.versionPairs`。
3. **关联名册**：`player_id` 按 `data/players.json` 的 `srcId` 关联。224 张卡全部关联到名册里的 106 人。
   - `byPlayer` 有 106 人，每张卡恰好出现一次。
   - 名册 117 人里，另外 11 人是 p06–p16（重建球员，srcId 为空），没有卡，列在 `meta.rosterWithoutCards`。
4. **不造卡**：卡只来自 card_records，没有源表以外的键。三个待确认项都写进了 `pending`，状态均为 `pending-confirmation`：
   - **40109 小罗（候选）**：没有卡，也不进名册（D6，NAME-01）。
   - **1.2.0|90001**：没有卡，因为源表本来就没有这条卡记录。它的等级行原样留在 `data/levels.json` 的 `others/1.2.0|90001`（DATA-02）。名册里的 p116 齐祖对应的是 `1.5.5|90001`。
   - **1.5.5|80206 耳帝**：按原表收录，game_name / real_name 都不替换（NAME-02）。
5. **20 条冲突原样保留**：`conflicts[]` 逐字段保存了 `parameter_conflicts.json` 的 20 条，包括 `card_values`、`level1_values`，以及 `resolution` 原文「两表原值均保留，运行时取值优先级未知。」。
   - 每条另加 `replica` 字段：
     - `replica.values`：1.5.5 等级表的 Lv1 值，等于源表的 `level1_values`，也等于 `data/levels.json` 的对应格。
     - `replica.policy`：「D5 复刻策略，不是原版优先级（见 meta.conflictPolicy）」。
   - card 表的值没有丢：原样留在 `cards[key]` 的五项属性里，也留在 `conflicts[].card_values` 里。
   - 冲突重算了两遍，结果都是 20 = 20：
     - 导入器用 card_records × level_records 重算，结果必须和列出的 20 条一致，否则直接退出（`tools/import-cards.ts:168`）。
     - xcheck 改用 `data/levels.json` 独立再算一遍。
   - 构成：普通卡 18 条、闪卡 2 条，全部是 1.5.5。
6. **D5 的写法**：`data/cards.json` 的 `meta.conflictPolicy` 写了这句话。导入器打印的摘要（导入报告，见 `runs/_t4b_import.out.txt`）里的 `conflictPolicy` 也是同一句原文：
   > D5：card 表基础值与等级表 Lv1 不同时，复刻取 1.5.5 等级表 Lv1 值（运行时属性本来就读 data/levels.json）；card 表的值原样留在 cards[key] 和 conflicts[].card_values。这是复刻策略，不是原版优先级：原版运行时取哪一组未知（issues.json DATA-01）。
   - xcheck 核实：18 张冲突普通卡在运行时的 Lv1，确实来自 `data/levels.json` 的 `players/<card_id>`。
   - 2 张冲突闪卡目前运行时不读。
7. **顺带记下的源表差异**（只记录，不做取舍）：
   - 5 张 1.2.0 卡的 game_name 在 card 表和等级表里不一样，记在 `nameDiffs`，两边的名字都保留。
     - 导入器最初把名字不一致当错误直接退出。实际上是源表本身不一致，所以改成记录。
   - 闪卡 `1.5.5|130108` 的 10 级等级表和对应普通卡 30108 不同。其余 30 张闪卡都与对应普通卡相同。
8. **没有接入运行时**：本任务只产出数据文件。构建产物的文件名和大小都和 T4-a 相同（§2 #7），说明 cards.json 没有被打进任何运行时代码。
9. 以下文件都没动（§3）：`shared/physics.ts`、`data/physics.json`、`data/levels.json`、`data/players.json`、`package.json`。

## 1. 改动文件

| 文件 | 性质 | SHA256 前 16 位 / 大小 / mtime |
|---|---|---|
| `data/cards.json` | 新增（导入器产物） | 4B9CD239751BC04B / 155436 B / 11-16 01:56:14 |
| `tools/import-cards.ts` | 新增，可复现导入器（说明见表下） | 93C007389194ADF6 / 23208 B / 01:52:58 |
| `docs/physics-tests.md` | 由 test:physics 重写（含耗时等每次运行都会变的数字，比 T4-a 时少 1 B） | 18A9099132CF86D7 / 3577 B / 01:57:59 |

- `tools/import-cards.ts` 的断言覆盖：
  - 源表结构
  - 双版本配对
  - 普通卡与闪卡互指
  - 名册关联
  - 等级表逐格
  - 冲突重算

  任何一条不符就退出。写盘前还会做一次 round-trip 比对（`:367`）。
- 构建和测试副产物（不是手写的）：
  - `dist/client/**`：01:58:58 重建
  - `dist/server/index.js(.map)`：01:59:03 重建
  - `docs/screens/e2e-build-boot.png`、`e2e-build-shot.png`：test:e2e 于 01:59:26 / 01:59:32 重写
- 校验脚本：
  - `runs/_t4b_xcheck.cjs`：独立核对，不复用导入器的代码，可以重跑。
  - `runs/_t4b_probe{,2,3,4,5}.cjs`：开工和调试时的结构探针（01:37–01:56）。只统计字段和形状，不整读大文件。

## 2. 实跑命令与原始结果

所有命令都在最后一次源码改动（`tools/import-cards.ts`，01:52:58）之后实跑。

- 工作目录：`D:/ai_for_games/碰撞全明星复刻`。
- 「时间」取输出文件的 mtime。
- 原始输出在 `runs/_t4b_<name>.out.txt`，退出码在 `runs/_t4b_*.rc.txt`（typecheck / physics / net 三项合在 `_t4b_base1.rc.txt`，均为 `exit=0`）。

| # | 命令 | 时间 | 原始结果 | 指令基线 |
|---|---|---|---|---|
| 1 | `npx tsx tools/import-cards.ts` | 01:56:06 | exit 0。`data/cards.json` 155436 B，sha256 `4B9CD239751BC04BF69EA7EDD7DDD4CC5A7806E5C1B6495C482082D579E5A873`；摘要见 §5 | — |
| 2 | 同上，第 2 次（测可复现） | 01:56:14 | exit 0，sha256 与第 1 次相同（`identical=True`）。两次摘要用 `fc` 比较，结果 `FC: no differences encountered`（`runs/_t4b_import.{rc,fc}.txt`） | — |
| 3 | `node runs/_t4b_xcheck.cjs runs/_t4b_xcheck.out.txt` | 01:57:11 | exit 0，`xcheck PASS=31 FAIL=0`（逐项见下） | — |
| 4 | `npm run typecheck` | 01:57:27 | exit 0。输出只有 `> tsc -p tsconfig.json --noEmit` 等两行抬头，没有任何诊断 | exit 0 ✅ |
| 5 | `npm run test:physics` | 01:57:59 | `15/15 passed` | 15/15 ✅ |
| 6 | `npx tsx tools/net-tests.ts` | 01:58:19 | `net-tests: PASS=176 FAIL=0`；`error codes exercised over the wire: 25/26 (not exercised: bad-seat-token)` | PASS=176 FAIL=0 ✅ |
| 7 | `npm run build`（先把旧 `dist/client` 改名为 `dist/_prev_client_T4b`） | 01:59:03 | exit 0，`✓ built in 4.60s`。产物见表下 | exit 0 ✅ |
| 8 | `npm run test:e2e`（`E2E_SERVER_PORT=2701`、`E2E_WEB_PORT=4273`） | 01:59:32 | `[e2e-browser] PASS=7 SKIP=0 FAIL=0`。UI 一杆球 `shotNo 1 -> 2`；console error / pageerror 都是 0；/healthz 的 `dataVersion` 仍是 `field-2/phys-2/players-2/skills-1/rules-1/levels-1/attrmap-1` | PASS=7 SKIP=0 FAIL=0 ✅ |
| 9 | 在线测试，步骤见表下 | 02:00:03 | exit 0。两个独立 colyseus.js 客户端连真实服务端：PASS 行 17、FAIL 行 0，`online-e2e: PASS (0 failure(s))`。测完已停掉服务端（`stopped=True`） | PASS=17 FAIL=0 ✅ |

- **#7 的产物**：
  - `index-CPa6KufZ.js 510.88 kB │ gzip: 130.74 kB`
  - `aiWorker-DCxfrSxD.js 333.37 kB`
  - `index-DFW4i8NI.css 6.04 kB │ gzip: 2.06 kB`
  - `dist\server\index.js 191.1kb`（`.map 522.7kb`）

  文件名和大小都和 T4-a 相同。vite 提示 `(!) Some chunks are larger than 500 kB`，只是警告，T4-a 时就有（§6-10）。
- **#9 的步骤**：
  1. 启动 `node dist/server/index.js`，环境变量 `PORT=2702`、`ROOM_STORE_DIR=runs/_t4b_rooms`，pid 48852。日志为 `[server] listening on port 2702  (GET /healthz)`。
  2. 跑 `npx tsx tools/online-e2e.ts`，`TEST_URL=ws://127.0.0.1:2702`。
  3. 17 条 PASS 分组：room 6、match 3、shot 5、reconnect 2、summary 1。
     - reconnect 段中间有一行 `colyseus.js: onMessage() not registered for type 'room'.`。这是 colyseus.js 客户端的提示，不是断言失败。T4-a 的输出里也有这一行（STAGE_T2a_DONE §16 已记录）。

**xcheck 31 项**（原文见 `runs/_t4b_xcheck.out.txt`）：

- 结构（5 项）：
  - 顶层键是 `version,meta,cards,byPlayer,conflicts,nameDiffs,pending`
  - 版本 `cards-1`
  - 文件里没有时间戳
  - `meta.sources` 的 7 个 sha256 都等于磁盘上的源文件
  - `meta.conflictPolicy` 含「复刻策略，不是原版优先级」
- 原样（6 项）：
  - 共 224 张，顺序与源表相同
  - 21 个源字段原样 224/224
  - 按版本分别是 87 / 137
  - 87 对同 id 卡并存
  - 28 对 foil 差异全部是「1.2.0 为空、1.5.5 指向闪卡」
- 派生字段（4 项）：
  - `playerId` 等于 `srcId` 对应的名册 id
  - `skillIds` / `unlockLevels` / `flashSkillIds` 等于源字符串拆分的结果
  - `foilKey` / `normalKey` 互指，31 / 31
  - `levelsRef` 指向 `data/levels.json`，224 张 × 10 级都等于 level_records（others 段 118 张，players 段 106 张）
- 冲突（6 项）：
  - 用 `data/levels.json` 重算的冲突 = 列出的 20 条
  - `conflict` 标记恰好落在这 20 张上
  - `conflicts[]` 的源字段原样
  - `replica.values` = `level1_values` = levels.json Lv1
  - `card_values` = cards 里的原值
  - 18 张冲突普通卡的运行时 Lv1 读的是 `levels.json players/<card_id>`
- 名册（4 项）：
  - byPlayer 共 106 人
  - 每张卡恰好出现一次
  - id / srcId 和名册、card player_id 都对得上
  - 名册 117 人 = 106 人有 srcId + 11 人没有
- 其他（6 项）：
  - nameDiffs 等于从 level_records 重算的 5 条
  - 没有 1.2.0|90001 的卡，它的等级行在 others，`card_record_present false`
  - 40109 没有卡，也不在名册
  - pending 依次是 DATA-02、NAME-01、NAME-02
  - 没有源表以外的卡
  - 卡上的技能引用 547 条 = skill_links 547 行

第一次跑 xcheck 的结果是 PASS=30 FAIL=1，失败项是 levelsRef。原因是核对脚本自己的 bug：`eqPts` 要求两边都恰好有 5 个键，而 level_records 每行有 12 个字段。加了 `pick()`、只取 5 项属性之后，重跑结果为 31 / 0。数据和导入器都没改。

**30 场随机完整比赛**：`出手 2909 次，进球 55，技能事件 271，非法/越权出手被拒 11636 次，全部正常结束 30/30`，和 T4-a 的参照完全一样，符合本任务没有改运行时的预期。

## 3. 未动文件（红线核对）

以下是 02:00:41 实测的结果（`runs/_t4b_redline.txt`）：

| 文件 | SHA256 前 16 位 | 大小 | mtime | 状态 |
|---|---|---|---|---|
| `shared/physics.ts` | 942E0ED90616EC3A | 18756 B | 11-14 21:13:48 | 未动 |
| `data/physics.json` | 6C9AC4B291A7328A | 892 B | 11-14 21:25:02 | 未动，仍是 phys-2 |
| `data/levels.json` | A197CB0D0FBEE16C | 185033 B | 11-16 01:18:56 | 未动，与 T4-a 记录一致 |
| `data/players.json` | B852E5831AC81A14 | 37010 B | 11-15 21:35:36 | 未动 |
| `package.json` | 66EEF9C3B537ADD9 | 1600 B | 11-15 22:18:14 | 未动 |

- 以 `STAGE_T4a_DONE.md` 的 mtime（11-16 01:33:26）为界，`shared/ server/ client/ data/ tools/ docs/ art/ materials/` 下有更新的文件只有 5 个：§1 表中的 3 个，加 2 张 e2e 截图。
  - 项目根目录下的文件：0 个。
  - `materials/**`：0 个，源材料只读。
  - `docs/calibration.md` 仍是 A18FCDDE8BD6ED8A / 6803 B / 01:18:22。
- 测试：没有删除、没有 skip、没有弱化，本任务也没改任何测试文件。physics 15 条、net 176 条、e2e 7 条、online 17 条，条数都和 T4-a 相同。
- 没有编造数值：没有源记录的卡（40109、1.2.0|90001）一张都没造（§0-4）。

## 4. 校准

- 没跑 `npm run calibrate`，原因：
  - 本任务没改物理常量，没改 `data/attr-mapping.json`，也没改运行时代码。
  - `data/cards.json` 不被运行时读取：构建产物的文件名和大小与 T4-a 相同。
  - 30 场随机比赛的统计也与 T4-a 完全相同（2909 / 55 / 271 / 11636）。
- `docs/calibration.md` / `.json` 没有重写，T4-a 的基线照旧有效。

## 5. 导入摘要（`tools/import-cards.ts` 原始输出要点）

- 总量：`cards 224`（`1.2.0: 87`、`1.5.5: 137`）
  - 按变体：`1.2.0|普通卡 87`、`1.5.5|普通卡 106`、`1.5.5|闪卡 31`
- 名册：`players 106`
  - `playersWith`：两个版本都有卡 87 人，只有 1.5.5 卡 19 人，有闪卡 31 人
  - `rosterRebuilt`：p06–p16，共 11 人，没有卡
- 等级表：`levelCells 2240`（224 × 10）；`levelOnly ["1.2.0|90001"]`
- 技能：`skillRefs` 为 `1.2.0|普通技能 195`、`1.5.5|普通技能 321`、`1.5.5|闪卡天赋 31`，合计 547 = `skillLinks 547`
- 冲突：`listed 20`、`recomputed 20`、`cardValueSets 1`、`byVariant` 普通卡 18 / 闪卡 2
- 双版本：`pairs 87`、`pairsDiffer 28`；`byField` 为 foil 28、rarity 2、五项属性各 3
- 闪卡：共 31 张
  - 与对应普通卡的卡面字段相同 31/31
  - 等级表不同的只有 `1.5.5|130108`
  - 天赋解锁等级 `{"0":31}`
- catalog：`catalogDiffs []`，即 catalog.json 108 行的 `card_variant_ids` 与本文件一致
- pending：`1.2.0|90001`（DATA-02）、`40109`（NAME-01）、`1.5.5|80206`（NAME-02）

**20 条冲突**（全部是 1.5.5）：

- 共性：card 表的值都是 70/70/50/60/70；源表的 resolution 都是「两表原值均保留，运行时取值优先级未知。」
- 普通卡 18 条：30108 西瓜、40110 图蓝、70101 马队、80101 马大腿、80102 费米、80103 司徒、80104 库鸟、80105 纳天王、80106 克莱鹰、80107 莫小雷、80201 师奶、80202 魔兽、80203 拓扑哥哥、80204 波尔蒂王子、80205 功夫熊猫、80206 耳帝、80207 霉洛、90003 小贝
- 闪卡 2 条：180104 库鸟、180202 魔兽
- 有差异的字段组合共 4 种：
  - `power,mind,radian`
  - `weight,power,mind,radian,precision`
  - `weight,mind,radian,precision`
  - `weight,power,radian,precision`

**双版本属性差异 3 对**（五项依次是 weight/power/mind/radian/precision）：

| card_id | 1.2.0 | 1.5.5 | rarity |
|---|---|---|---|
| 10303 | 38/46/50/53/59 | 53/61/65/68/74 | 3 → 4 |
| 20201 | 36/57/43/47/58 | 51/72/58/62/73 | 3 → 4 |
| 40301 | 28/45/48/51/49 | 48/65/68/71/69 | 4 → 4 |

**名字差异 5 条**（都是 1.2.0，格式为 card 表 / 等级表）：

- 10104：得佩 / 嘚佩
- 10201：阿圭罗 / 阿KUN
- 60102：杰马 / J马
- 40205：哈罗 / J罗
- 40208：小小罗 / C罗

## 6. 遗留问题 / 本任务未做

1. **cards.json 还没接入运行时**。运行时属性仍然只读 `data/levels.json` 的 players 段，也就是 1.5.5 普通卡。以下 UI 和规则都还没做，等后续任务需要时再接：
   - 选 1.2.0 版本的卡
   - 选闪卡
   - 按 `skillIds` / `unlockLevels` 解锁技能（技能本身属于 T4-c）
2. **导入报告**：D5「复刻策略，不是原版优先级」已经写在三处：`data/cards.json` 的 `meta.conflictPolicy`、导入器摘要、本文件 §0-5/§0-6。汇总到 `docs/materials-import-report.md`（导入报告 + 冲突清单）是 T4-f 的事，本任务没写 docs。
3. **40109 小罗（候选）**和 **1.2.0|90001（早期齐祖）**：按 D6 保持 pending-confirmation，没有卡，等安安确认后再补。
4. **1.5.5|80206 耳帝**（NAME-02）：名字待确认，卡牌按原表收录。
5. **5 条名字差异**：card 表和等级表的 game_name 不一致。两边的名字都留在 `nameDiffs`，`cards[]` 用 card 表原值。显示名用哪一个待定。
6. **20 条冲突的 card 表值全是同一组 70/70/50/60/70**，看起来像占位值。这只是观察，写在 `meta.observations`，没有据此取舍，取舍仍按 D5。
7. **闪卡 130108 的等级表和普通卡 30108 不同**，抽查了 Lv1 / Lv5 / Lv10：

   | 等级 | 130108 | 30108 |
   |---|---|---|
   | Lv1 | 70/70/50/60/70 | 70/76/69/55/70 |
   | Lv5 | 82/87/68/63/82 | 81/89/78/60/81 |
   | Lv10 | 96/108/90/66/96 | 96/108/90/66/96 |

   - 130108 的 Lv1 等于它自己的 card 表值，所以不算冲突；30108 的 Lv1 与 card 表不同，在冲突里。
   - Lv10 两者相同。
   - 材料里没有说明原版闪卡是否有单独的等级表。两份都原样保存在 levels.json。
8. **catalog 里有 2 行没有卡**：
   - `40109 小罗（候选）`
   - `卡队`：player_id 为 null，源表注明「仅语言表出现，未找到头像、卡牌或属性」
9. **没有技能的卡**：源表里 `skills` 为空的有 1.2.0 普通卡 22 张、1.5.5 普通卡 30 张。
10. 主包 510.88 kB 超过 vite 500 kB 提示线的警告是 T4-a 留下的，本任务没有变化。
11. `bad-seat-token` 错误码仍然没有经过线上路径（25/26），这是既有问题。
12. 临时文件：
    - 保留作证据：
      - `runs/_t4b_{import,import2,typecheck,physics,net,build,e2e,online,srv,xcheck,conf}.out.txt`
      - `runs/_t4b_*.rc.txt`
      - `runs/_t4b_import.{fc,head}.txt`
      - `runs/_t4b_redline.txt`
      - `runs/_t4b_srv.err.txt`、`runs/_t4b_xcheck.err.txt`（都是 0 B）
      - `runs/_t4b_xcheck.cjs`
      - `runs/_t4b_probe{,2,3,4,5}.cjs` 及其输出
    - 已过期：`runs/_t4b_import.sha1.txt`（01:51:27）和 `runs/_t4b_import.tail.txt`（01:52:22）是导入器最后一次修改之前那次运行留下的，里面的 sha256 不是最终值，以 §2 #1–#2 为准。
    - 已按文件名逐个删除：
      - `runs/_t4b_rooms/CBBJPK.json`：online-e2e 的测试房间，2118 B
      - `runs/_t4b_rooms/`
      - `runs/_t4b_srv.pid`：进程 48852 已退出
    - `data/rooms/` 为空；2701 / 2702 / 4273 端口都没有残留监听。
    - `dist/_prev_client_T4b/`（272 个文件）是重建前改名保存的旧 `dist/client`。它和之前的 `dist/_prev_client_T2a`、`_T4a`、`_T4a_s2` 一样可以安全删除，本会话没删。
