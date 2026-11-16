# 碰撞全明星复刻 · 续做指令 v3（干净会话 · 幂等）

> 2026-11-15 20:55 巴蒂签发。**A/B/C/D/E 阶段全部完成**，C 阶段（双端联机）已由 Claude#3 + 巴蒂联合作战交付。
> 本指令面向**全新会话**，不继承任何历史上下文。所有事实以磁盘文件为准。

## 0. 最高铁律

1. **直接干活，不要重新规划、不要输出计划后停下、不要请求确认。** 你是无人值守会话，没人会回复你。
2. **开工第一件事：读 `runs/CHECKPOINT.md`**（这是唯一事实来源，已吸收全部技术结论、实测数字、已核实源码行为、已踩过的坑），然后 `tail -20 runs/PROGRESS_ALL.md`。
   **严禁重新核实磁盘、严禁重读 CHECKPOINT 已列明的文件内容、严禁再打开 `node_modules/@colyseus/core/build/Room.js` 或 `node_modules/colyseus.js/build/esm/Room.mjs`。**
3. **一个子任务 = 一个 checkpoint = 一个会话。** 本会话只做 CHECKPOINT 第 5 节里**下一个未完成的 T 项**（按 `runs/STAGE_*_DONE.md` 判断），做完立刻停，**不许顺手做下一个 T**。watcher 会自动开全新干净会话接力。
4. **每个子任务必须实跑验证命令**，以命令输出为准，不许用"代码写了"代替"测试通过"。
5. 完成判据：写 `runs/STAGE_<T>_DONE.md`（含改动文件清单、实跑命令与原始结果数字、遗留问题）+ 追加 `runs/PROGRESS_ALL.md` 一行，然后结束会话。
6. 全部完成后写 `runs/FINAL_REPORT.md`，watcher 见此文件即停。

## 1. 当前状态（2026-11-15 20:55 快照）

| 阶段 | 状态 |
|---|---|
| A 服务端骨架 / B 权威一杆球 / D 构建 / E 浏览器 E2E | ✅ DONE |
| **C 双端联机 + 重连 + 持久化** | ✅ DONE 20:50（`runs/STAGE_C_DONE.md`） |
| T1 一条命令一个地址 | ✅ DONE 20:55（`server/app.ts` 已托管 `dist/client`） |
| **T2 V0.3 全量数据 + 快速匹配 + 五套球场** | ⬜ **这就是你的活** |
| T3 球门宽度 | ⬜ 等 T2 之后 |

**实测基线（改动后必须保持全绿）**：
```
npm run typecheck        → exit 0
npm run test:physics     → 14/14
npx tsx tools/net-tests.ts   → PASS=176 FAIL=0
npm run build            → exit 0
npm run test:e2e         → PASS=7 SKIP=0 FAIL=0
npx tsx tools/online-e2e.ts  → 15/15 PASS
```

## 2. T2 施工单 · V0.3 全量数据与玩法扩展

### T2-a · 球员数据扩到 106 人（最优先）
- **开工先读 `runs/V03_ROSTER_PREP.md`**（巴蒂已摸清数据源与字段映射坑，**别重复调研**）。
- 源：主表 `materials/pengzhuang_rebuild/02_players_and_data/earlier_exports/players.json`（106 人）；数值表 `card_records.json`（224 卡）；冲突 `parameter_conflicts.json`（20 条）与 `issues.json`（8 条）**必须保留记录，不得静默丢弃**。
- 目标：`data/players.json` 从 16 人扩到 106 人。
- 字段映射：源 `mind/radian/precision` → 目标 `curve/accuracy/mental`，按 `field_dictionary.json` 的映射表来，**不要自己猜**。
- `attrs` 必须落在 40–99；**越界要记录到冲突文件，不得静默 clamp**。
- **不许编造缺失卡牌/技能**：未实现的技能效果写占位，并在 DONE 报告里列明，不得写成完成。
- 改 `players` 版本号会连锁影响 `GameData.version` → `configVersion` → 校准基线 → 所有测试。导入后**必须重跑**：`typecheck / test:physics / calibrate / test:net / build / test:e2e / online-e2e`，全部数字写进 DONE 文件。
- 新增 106 人的美术素材（`tools/gen-art.ts`）是**另一个子任务**，不要在 T2-a 里混做。

### T2-b · 在线快速匹配
等待队列 → 二人自动配对 → 可取消。服务端房间管理，不引数据库。

### T2-c · 五套球场
在现有 `data/fields.json` 与 `FIELD_SKINS` 基础上扩展。

### T2-d · 原图/重绘切换、移动端适配

### T2-e · 公网部署**只写方案文档**
账户、费用、域名、HTTPS/WSS、持久化与备份。**不执行、不购买、不发布、不改 DNS。**

## 3. 上下文纪律（三次崩溃的根因）

**三次实证崩溃**：16:50 会话 6.55MB、18:46 会话 5.96MB（均 `Autocompact is thrashing`）、**20:28 会话报 `Prompt is too long` 后进程存活但零输出**。

- **禁止**把大文件整体读进上下文：`materials/**` 下的 `field_dictionary.json`(118KB)、`card_records.json`(224 卡)、`reference_tables/**`、`node_modules/**` 源码全文。需要时用 `node -e` 做统计/抽样/字段提取，只打印几行结果。
- **禁止**一次 Read 超过 300 行的文件；用 `grep -n` 定位后分段读。
- 所有命令输出用 `| head -40` / `| tail -40` 截断；测试只看 PASS/FAIL 汇总行。
- 感觉上下文变长时，**优先把结论写进 `PROGRESS_ALL.md` 落盘**，而不是在脑子里攒着。
- 单会话只做一个子任务就主动收尾。**主动结束不算失败。**

## 4. 已踩过的坑（别再踩）

1. **客户端首个快照竞态**：服务端 `onJoin` 立刻广播快照，客户端 `await join` 返回后才注册 handler → 首个快照被丢弃。**拿到 room 对象就立刻同步注册 handler**，不要等第二个 await。
2. **`until(fn)` 语义**：条件必须返回 `undefined`（未就绪），不能返回 `false`，否则立即返回、根本没等待。
3. **Colyseus 重连**：`allowReconnection(prev, seconds)` 必须在 `onLeave` 内调用；重连成功**不走 `onJoin`**，要自己在 `reconnection.then()` 里发 `resume`。
4. **服务端 `onMessage` 的 `'*'`** 只捕获没有专用 handler 的 type；有专用 handler 就直接调它。

## 5. 质量红线

- 不许删测试、不许弱化断言、不许把失败用例标 skip 来"通过"。
- 不许用本地双标签页冒充公网联机；联机必须是两个独立客户端连真实 Colyseus 服务端。
- 不许改 `shared/physics.ts` 的物理常量与 `docs/calibration.md` 的校准基线（除非 T2 明确要求并重跑了校准）。
- 不许引入按量计费服务、不许 git init（除非巴蒂另行指示）。
- 遇到真阻塞：把诊断写进 `PROGRESS_ALL.md` 与 `runs/BLOCKER.md`，做完其他能做的再停。

## 6. 收尾

写 `runs/FINAL_REPORT.md`：逐阶段列出**实跑命令 + 原始结果数字**、改动文件清单、未完成项及原因、下一步建议。完成即停。
