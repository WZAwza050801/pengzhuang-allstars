# 碰撞全明星复刻 · 续做指令 v2（干净会话 · 幂等）

> 2026-11-15 16:52 巴蒂签发。前一个会话因 **Autocompact thrashing**（上下文反复爆满）异常退出，已废弃。
> 本指令面向**全新会话**，不继承任何历史上下文。所有事实以磁盘文件为准。

## 0. 最高铁律（19:20 修订：一个 checkpoint = 一个会话）

1. **直接干活，不要重新规划、不要输出计划后停下、不要请求确认。** 你是无人值守会话，没人会回复你。
2. **开工第一件事：读 `runs/CHECKPOINT.md`**，然后 `tail -20 runs/PROGRESS_ALL.md`。CHECKPOINT.md 已吸收全部已核实的技术结论（Colyseus 源码行为、协议导出、接口定义、验收数字、C1–C5 施工单）。**严禁重新核实磁盘、严禁重读里面已列明结论的文件、严禁再打开 `node_modules/@colyseus/core/build/Room.js`。**
3. **一个子任务 = 一个 checkpoint = 一个会话。** 本会话只做 CHECKPOINT.md 第 3 节里**下一个未完成的 Ci**（按 `runs/STAGE_C*_DONE.md` 判断），做完立刻停，**不许顺手做 Ci+1**。watcher v2 会自动开全新干净会话接力。这是防止第三次 thrashing 的硬约束。
4. **每个子任务必须实跑验证命令**，以命令输出为准，不许用"代码写了"代替"测试通过"。
5. **完成判据**：写 `runs/STAGE_Ci_DONE.md`（含改动文件清单、实跑命令与原始结果数字、遗留问题）+ 追加 `runs/PROGRESS_ALL.md` 一行，然后结束会话。C5 通过后继续 V0.3，同样一个子任务一个 checkpoint。
6. 全部完成后写 `runs/FINAL_REPORT.md`，watcher 见此文件即停。

## 1. 上下文纪律（**上次崩溃的根因，必须遵守**）

- **禁止**把大文件整体读进上下文：`materials/**` 下的 `field_dictionary.json`(118KB)、`card_records.json`(224 卡)、`reference_tables/**`、`node_modules/**` 源码全文。需要时用 `node -e` 脚本做统计/抽样/字段提取，只打印几行结果。
- **禁止**一次 Read 超过 300 行的文件；用 `sed -n '1,120p'`、`grep -n` 定位后分段读。
- 所有命令输出用 `| head -40` / `| tail -40` 截断；测试只需看 PASS/FAIL 汇总行，不要贴全量日志。
- 不要重复通读 `docs/OPUS55_DEVELOPMENT_PROMPT.md`（14KB）；本文件 + `runs/PROGRESS_ALL.md` 就是你的任务书。需要协议细节时只读 `shared/protocol.ts` 与 `materials/pengzhuang_rebuild/05_online/PROTOCOL.md` 的相关段落。
- 感觉上下文变长时，**优先把结论写进 `PROGRESS_ALL.md` 落盘**，而不是在脑子里攒着。

## 2. 当前磁盘现状（16:52 历史快照 · **19:20 后一律以 `runs/CHECKPOINT.md` 为准**）

> 下面是首轮 v2 会话启动时的旧快照，仅作背景。**C 阶段真实进度、已落盘文件、C1–C5 施工单全部以 CHECKPOINT.md 第 2/3 节为准**，本节若与之冲突，以 CHECKPOINT.md 为准。

**已有且 A 阶段验收通过**：
- `server/index.ts`、`server/app.ts`（含 `/healthz`）、`server/validation.ts`、`server/auth.ts`、`server/rooms/MatchRoom.ts`（12.4KB，含 `__no_message_handler` 远程崩溃漏洞补丁）、`shared/protocol.ts`、`.env.example`
- 15:38:03 实跑：`npm run typecheck` 0 错误；`node --import tsx server/index.ts` 冷启动约 13.5s；`GET /healthz` → 200；端口无残留
- 16:20:48 安全探针实测通过（`tools/_scratch_nmh_2.ts`）：保留键/原型链/模糊帧全部 bad-message，`uncaughtException=0`
- 巴蒂独立复核：16:46 左右 `npm run test:physics` **14/14 PASS**
- 详情见 `runs/PROGRESS_AB.md`

**缺失（这就是你的活）**：
| 文件 | 对应脚本 | 阶段 |
|---|---|---|
| `tools/net-tests.ts` | `npm run test:net` | B |
| `client/src/onlineHost.ts`（OnlineHost 接入 + 双端） | — | C |
| 断线重连、房间状态持久化 | — | C |
| 全量 106 人数据与技能标注 | — | V0.3 |
| 在线快速匹配、五套球场、原图/重绘切换、移动端适配 | — | V0.3 |
| `runs/FINAL_REPORT.md` | — | 收尾 |

**`tools/gen-art.ts`、`tools/e2e-browser.mjs`、`tools/backup.ts` 已由巴蒂于 16:57 完成并实跑验证**：`npm run build:art` PASS（16 人 cutout+raw 同步进 `client/public/art/` + manifest.json，`--check` IN SYNC）、`tools/backup.ts` 快照 19 文件通过、`npm run typecheck` 0 错误（含上述新增 ts）。**禁止删除或重写这三个文件**，D/E 阶段直接调用即可。
`e2e-browser.mjs` 目前是「构建产物真实 Chromium 冒烟」：起 dist/server + 静态托管 dist/client，校验 `/healthz`、canvas、无 JS 错误、尽力一杆球；**若要补真实双客户端联机完整对局，允许在文件末尾追加 scenario，但不得删除或弱化现有校验项，也不许把 SKIP 写成 PASS。**

## 3. 阶段任务（按顺序，验收过就进下一个，不停机）

### B 收尾：`tools/net-tests.ts`
- 依据 `shared/protocol.ts` 与 `server/rooms/MatchRoom.ts` 的校验链写真实网络测试，用 Colyseus 客户端连本机 `ws://127.0.0.1:2567`。
- 至少覆盖：重发 `clientShotId` 去重、非行动方拒绝、NaN/Infinity 拒绝、`configVersion` 不符拒绝、房间码非法、断线后状态、整局 `end` 只触发一次、超长 payload 不崩服务端。
- 验收：`npm run test:net` 全 PASS；`npm run typecheck` 0 错误；`npm run test:physics` 14/14 不回归。

### C：双端 OnlineHost 接入 + 重连 + 持久化
- 实现 `client/src/onlineHost.ts`，实现 `client/src/host.ts` 的接口，在 `client/src/main.ts` 提供**本地/在线模式选择**（默认仍是本地，不破坏现有玩法）。
- 服务端权威：`shared/match.ts` 与 `shared/physics.ts` **禁止重写**，只做接入与序列化。
- 断线重连：按座位 token 恢复，重连不丢局内状态；房间状态落盘（本地文件即可，不引数据库）。
- 验收：`test:net` 仍全绿；起两个真实客户端进程跑完一杆球，双方状态一致；typecheck / physics 不回归。

### D：构建链路打通
- `npm run build` 必须成功产出 `dist/`（`build:art` → `build:client` → `build:server` 三段全过）。
- 只修你自己引入的构建错误；若失败源于巴蒂负责的三个脚本，记一行到进度文件并继续。
- 验收：`npm run build` 退出码 0，且 `dist/client/index.html`、`dist/server/index.js` 存在。

### E：真实双客户端 E2E
- `npm run test:e2e` 通过（脚本由巴蒂提供），真实起服务端 + 浏览器/客户端，跑完整一局。
- 若环境缺浏览器依赖，如实记录并给出可执行替代校验（用 headless 客户端脚本跑完整局），**不许编造通过**。

### V0.3：全量数据与玩法扩展
- **开工先读 `runs/V03_ROSTER_PREP.md`**（巴蒂已摸清数据源与字段映射坑，别重复调研）。
- `data/players.json` 从 16 人扩到资料包**可验证**的全量人物：主表 `materials/pengzhuang_rebuild/02_players_and_data/earlier_exports/players.json`（106 人），数值表 `card_records.json`（224 卡），冲突 `parameter_conflicts.json`（20 条）与 `issues.json`（8 条）必须保留记录。
- **不许编造缺失卡牌/技能**；未实现的技能效果写占位并在报告中列明，不得写成完成。
- 源字段 `mind/radian/precision` ≠ 目标 `curve/accuracy/mental`，必须按 `field_dictionary.json` 映射；`attrs` 必须落在 40–99，越界要记录而非静默 clamp。
- 改 `players` 版本号会连锁影响 `GameData.version` → `configVersion` → 校准基线，**导入后必须重跑** `typecheck / test:physics / calibrate / test:net`。
- 在线快速匹配（等待队列、二人配对、取消）、五套球场、原图/重绘切换、移动端适配。
- 公网部署只写方案文档（账户、费用、域名、HTTPS/WSS、持久化与备份），**不执行、不购买、不发布、不改 DNS**。

## 4. 质量红线

- 不许删测试、不许弱化断言、不许把失败用例标 skip 来"通过"。
- 不许用本地双标签页冒充公网联机；联机必须是两个独立客户端连真实 Colyseus 服务端。
- 不许改 `shared/physics.ts` 的物理常量与 `docs/calibration.md` 的校准基线。
- 不许引入按量计费服务、不许 git init（除非巴蒂另行指示）。
- 遇到真阻塞（缺依赖需付费、架构冲突、测试反复修不好）：把诊断写进 `PROGRESS_ALL.md` 与 `runs/BLOCKER.md`，做完其他能做的阶段再停。

## 5. 上下文预算（18:46 第二次 thrashing 后新增，务必遵守）

**两次实证崩溃**：16:50 会话 6.55MB / 2h03m、18:46 会话 5.96MB / 1h52m，均因 `Autocompact is thrashing` 退出（exit=1），日志只有 258 字节。崩溃不会丢已落盘代码，但会白白损失末尾十几分钟。

- **单会话只做一个 Ci 子任务就主动收尾**（见第 0 节铁律 3 与 `CHECKPOINT.md` 第 3 节施工单），不要试图在一个会话里连做整个阶段。例如本轮只做 C1（`MatchRoom.ts` 重连+时钟+落盘），写完就停，C2 交给下一个干净会话。
- 收尾条件：代码已落盘、`PROGRESS_ALL.md` 追加一行「已完成 X / 下一段从 Y 开始」、`npm run typecheck` 至少跑通（若正在改到一半，如实写明未验收，下一段补）。
- **主动结束不算失败，是在省时间**：watcher v2 检测到会话结束会自动开全新干净会话、按进度文件幂等续做，无需你汇报或等待确认。
- 上下文纪律（硬性）：禁止整体读取超过 300 行的文件、禁止整体读 `materials/` 下任何大 JSON、工具输出用 `head` / `tail` 截断后再看、优先用 `Grep` 定位行号再分段 `Read`。

## 6. 收尾

写 `runs/FINAL_REPORT.md`：逐阶段列出**实跑命令 + 原始结果数字**、改动文件清单、未完成项及原因、下一步建议。完成即停，watcher 会自动收工。
