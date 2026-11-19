# Agent 交接 · MM-04 → MM-06

2026-11-19。MM-02、MM-03、MM-04 已完成并勾选；本轮按用户要求做独立玩家视角复核与对抗压测，实施 MM-02/03/04，并定期对齐 GitHub。请以 TASKS、执行记录和各项报告核对当前状态。

## ⚠️ 接手第一件事：补跑全量集成

MM-04 验收的隔离测试全绿，但**全量集成因本机被用户其他工具/会话重度占用（多 MCP server、多 Qwen/Codex 会话、Chrome、serena LSP）而未能干净跑完**——vitest 多 worker 在导入阶段卡死（6 次尝试：默认并行/单 worker/2 worker 均停在 RUN）。请在**低负载时段**补跑 `npm run test:integration` 确认 MM-02/03/04 无回归（MM-03 曾在低负载下 25 文件/339 全过）。若浏览器套件（ui-accessibility/rooms-pages/account-pages）出现 5s/90s 启动超时型偶发失败，先隔离/重试判定是否负载抖动，不要直接归因新代码、不要删改断言。轻量 tsx 冒烟（work/mm0X-smoke.ts）在重负载下仍可跑通，可作快速 sanity。

## 接手先读

依次阅读仓库 `AGENTS.md`、[规划入口](README.md)、[TASKS](TASKS.md)、[执行记录](EXECUTION_LOG.md)、[MM-04 报告](reports/MM-04.md)、[MM-03 报告](reports/MM-03.md)、[MM-02 报告](reports/MM-02.md)、[匹配策略工程说明](../engineering/matchmaking-strategy.md)、[赛季工程说明](../engineering/seasons.md) 和 [积分工程说明](../engineering/ratings.md)。任务清单是完成状态的唯一来源，历史 `runs/` 和旧开发提示不是当前指令。

工作目录 `D:\ai_for_games\碰撞全明星复刻`，分支 `docs/productization-roadmap`，继续复用这个工作区。先检查 HEAD、分支和本地修改，保留他人工作。未跟踪 `.serena/` 是本地既存目录，不提交、不删除。

## 本项状态与提交

当前 **64/112 已完成，剩余 48 项**。

| 提交 | 内容 |
|---|---|
| `6ab2533` | MM-01 完成（前任 Agent）。 |
| `2a66bee` | 独立复核记录 + D11 对齐：新壳大厅改用原版 Q 版体育场图（client/src/arena.ts 单一来源映射 + web-shell 回归断言）。 |
| `1f0e356` | MM-02 积分/段位/榜单、迁移 202611180019。**已同步 GitHub**。 |
| `50fdfbe` | MM-03 赛季/历史榜/软重置/赛季奖励、迁移 202611180020。**已同步 GitHub**（主域被断，经 api.github.com Git Data API 精确复刻，SHA 逐字一致）。 |
| 本项最终提交 | MM-04 扩窗/等待估计/异常统计、queue-2 配置、契约/OpenAPI、测试、勾选与记录；用 `git log -- docs/productization/reports/MM-04.md` 定位。 |

独立复核结论（详见执行记录「独立玩家视角复核」）：完整集成 324/324 重跑通过；22/22 玩家实测+对抗探针通过（真实注册邮件、双人匹配开局、双方出手、刷新与真实服务端重启接管、认输结算越权拒绝、队列/升级并发幂等、登录风暴 KDF 卸载）。MM-01 及账号/资产/结算/恢复链路声称可信。

MM-02 验证：check 207/19；定向 9/9；全量第二轮 332/333（唯一失败为既有 UI-07 负载抖动，隔离/重试均绿）。MM-03 验证：check 211/19；seasons 6/6 + ratings 回归 9/9；**全量 25 文件/339 全过**（531.50s）；冒烟通过。MM-04 验证：check 216/19；单元 5/5；隔离集成 7/7；匹配回归 28/28（含取消风暴）；冒烟通过（queue-2/cap800/insights/匿名401）；**全量环境阻塞待补跑**。

## 已实现的积分与赛季闭环

结算（NET-04 consumer）→ `Ratings.applyInTransaction` 同事务写不可变 `rating_applications` + `ratings`；队列 `readForQueue` 读真实积分/赛季。`SeasonService.runJob` 按服务端时钟幂等切季：冻结 `season_history` → 按段位经账本发 `season.reward` → 软重置写入下赛季。API：`/me/rating`、`/ratings/leaderboard`（活榜）、`/seasons`、`/ratings/history`（冻结历史榜）。

| 位置 | 职责 |
|---|---|
| `config/ratings.json`、`config/seasons.json` | ratings-1 / seasons-1 冻结配置（初始 1000/K32/scale400/下限 0；软重置 factor 0.5；段位奖励建议值）。 |
| `packages/game-core/src/ratings.ts` | 纯 Elo/段位/结果映射/软重置（无平台依赖）。 |
| `packages/persistence/src/ratings.ts`、`seasons.ts` | 仓库；迁移 202611180019/202611180020（不可变触发器、榜单索引）。 |
| `server/matches/ratings.ts`、`seasons.ts` | Ratings（动态当前赛季 provider）/ SeasonService（时钟定赛季、幂等切季）。 |
| `server/api/ratings.ts`、`seasons.ts` | API 与严格契约；OpenAPI 已同步。 |
| `server/runtime.ts` | 装配真实积分/赛季端口；**生产 enabledModes 仍 ['friend']**。 |

必须保留的边界：

- 积分只对「权威+落盘+账号验证+非作废」计分；认输/断线判负计分，abandoned/server-fault/shot-limit 作废不计分也不创建积分行；平局 delta 0 计 draws。
- `rating_applications` 主键 (match_id,user_id)、append-only；applyInTransaction 先查已应用再按 userId 序锁行，用赛前积分计算，整体在结算事务内。delta 记录含下限钳制，边界零和不保证（有意取舍）。
- 切季 `closeSeason` 先以条件 UPDATE 锁赛季行作并发闸门；冻结/发奖/软重置同事务，失败整体回滚重跑安全。赛季奖励 `operationId=season:{id}:{scope}:{userId}`、`sourceId=season:{id}:{scope}`（含 scope 区分双池），账本+season_rewards 双幂等。软重置 `ON CONFLICT DO NOTHING`，不覆盖下赛季已存在行。
- 队列入队冻结 rating_season 快照；配对要求同 scope+season 且分差≤窗口。**跨季口径**：配对按入队冻结赛季，结算按消费时当前赛季（有意默认，文档明确）。直接 UPDATE 入队行会被 MM-01 不可变触发器拒绝——测试模拟切季用 runJob(nowMs) 或双赛季 provider。
- 榜单最小身份：nickname/points/tier/wins/draws/losses，无 userId/邮箱；keyset 游标 base64url；历史榜只读冻结快照，活赛季历史榜为空。
- **生产排位/成长不开放**：展示 UI 与发布决策就绪前 enabledModes 保持 ['friend']。软重置 factor/段位奖励额度/赛季日历为 engineering-default 建议值，放量前需老板确认。
- 测试房间码必须随机（room_code 全局唯一），不得复用其他套件固定码。
- MM-04 扩窗在 pair SQL 按 `clock_timestamp()-created_at` 计算（行不可变，禁止 UPDATE rating_window/created_at）；`effectiveWindow` 纯函数同公式。queue-2 默认 base200/30s+100/cap800；schema 扩窗字段默认 0/0/缺省=关闭（queue-1 兼容）。
- MM-04 异常统计 `MatchmakingInsights` 只读、无封禁端口（误判不可逆处罚不可能）；阈值 engineering-default。server-fault 作废不计负、disconnect 判负，分别计数。不引入无提示机器人。
- MM-04 扩窗/等待测试已稳健化：基础窗口用大步长确定性验证、扩窗只断言睡眠后状态、wait 用边界范围——别改回壁钟精确边界断言（重负载下会抖）。

## 下一项

按依赖可领取：**MM-06**（练习 AI 难度/离线隔离，依赖 BAL-04+MM-01）。MM-05 仍待 NET-06（NET-06 待 OPS-03）。**先补跑全量集成确认 MM-02/03/04 无回归**，再领取 MM-06。先在执行记录写负责人、起始提交、范围与验收，再实现。

随后按依赖推进其它工作包，不因本轮停止而缩小 112 项计划。没有新增多 Agent 授权；不要据任务清单自行委派。

## 本机验证方式

每个新 PowerShell 会话先选择项目已验证工具链；不改系统 PATH、不升级依赖：

```powershell
$env:PATH='C:/Users/31168/AppData/Local/pengzhuang-toolchains/npm-11.9.0/node_modules/.bin;C:/Users/31168/AppData/Local/pengzhuang-toolchains/node-v24.22.1-win-x64;'+$env:PATH
$env:PG_TEST_BIN_DIR='C:/Users/31168/AppData/Local/pengzhuang-toolchains/postgresql-17.12-1/bin'
$env:MAILPIT_TEST_BIN=(Resolve-Path 'work/toolchains/mailpit-1.34.0/mailpit.exe').Path
npm run check
npm run test:integration
```

完整集成约 9–15 分钟（真实隔离 PG/Mailpit/浏览器）；以退出码与隔离清理判断完成。筛选：`node tools/run-pg-tests.mjs tests/<file>`。契约 `--check` 直接传 tsx 脚本（`node node_modules/tsx/dist/cli.mjs tools/export-contracts.ts --check`），避免 npm11 吞参数。cmd.exe 下注意 `if exist X cmd & rest` 会把整行并入条件分支；vite build 会污染进程 NODE_ENV，子服务环境需显式覆盖。

**GitHub 对齐**：用户节奏每 10 项同步（下一第 70 项），本轮已按用户提醒提前对齐至 MM-02（1f0e356）。github.com 主域可达性会翻转，每次网络操作前先探测（`curl -s -o NUL -w "%{http_code}" --max-time 12 https://github.com` 与 api.github.com）。主域被断、api 子域通时，用现成脚本经 Git Data API 精确复刻：`node C:\Users\31168\.qwen\tmp\eco-world-sync-github-api.mjs WZAwza050801 pengzhuang-allstars docs/productization-roadmap <sha...>`（按序，父提交须已在远端；逐 blob/tree/commit SHA 校验，全一致才 force:false 更新 ref；凭据 gh auth token，进程内清空失效 GITHUB_TOKEN）。推送后 `git update-ref refs/remotes/origin/docs/productization-roadmap <sha>` 同步跟踪引用（主域被断无法 fetch）。直推可用时：`set "GITHUB_TOKEN=" && git -c credential.helper= -c credential.https://github.com.helper= -c credential.https://github.com.helper="!gh auth git-credential" push`。

涉及联机/浏览器功能按实际变更运行构建、test:net、test:e2e、test:compatibility。提交前 `node tools/check-plan.mjs` 并检查 diff；代码、测试、勾选、记录同提交。

## 暂缓事项与用户边界

- AST-06 真机验收按用户要求暂缓（仅 iPhone 15 Pro，无 Android）；ACC-05 缺真实微信凭据/code；NET-06 待 OPS-03。均未勾选。
- 素材权利 0 项发布授权/269 项排除；先手偏差 7.3pp 超 5pp 工程门槛；依赖审计门槛保留。代码测试通过不代表可公开发行。
- D11 已对齐：大厅展示用原版 Q 版体育场图（老板确认「Q版的！」），新旧壳共用 arena.ts 映射，web-shell 有回归断言，别删改。
- 未使用远端服务器。用户允许必要时远端 `/home/user/Wholeworks/wanganan` 作潜在工作区（占用≤服务器 2%），未授予任意部署/购买/生产权限。不要把本机结果写成远端验证，凭据不入 Git。
- 用户要求普通实施持续推进并定期 GitHub 对齐，不反复请求已给授权；缺真实设备/凭据时记录阻塞、保持未勾选，继续依赖已满足的任务。