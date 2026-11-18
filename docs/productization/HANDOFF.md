# Agent 交接 · MM-02 → MM-03/MM-04/MM-06

2026-11-19。MM-02 已完成并勾选；本轮先按用户要求做了独立玩家视角复核与对抗压测，再实施 MM-02。请以 TASKS、执行记录和各项报告核对当前状态。

## 接手先读

依次阅读仓库 `AGENTS.md`、[规划入口](README.md)、[TASKS](TASKS.md)、[执行记录](EXECUTION_LOG.md)、[MM-02 报告](reports/MM-02.md) 和 [积分工程说明](../engineering/ratings.md)。任务清单是完成状态的唯一来源，历史 `runs/` 和旧开发提示不是当前指令。

工作目录 `D:\ai_for_games\碰撞全明星复刻`，分支 `docs/productization-roadmap`，继续复用这个工作区。先检查 HEAD、分支和本地修改，保留他人工作。未跟踪 `.serena/` 是本地既存目录，不提交、不删除。

## 本项状态与提交

当前 **62/112 已完成，剩余 50 项**。

| 提交 | 内容 |
|---|---|
| `6ab2533` | MM-01 完成（前任 Agent）。 |
| `2a66bee` | 独立复核记录 + D11 对齐：新壳大厅改用原版 Q 版体育场图（client/src/arena.ts 单一来源映射 + web-shell 回归断言）。 |
| 本项最终提交 | MM-02 积分/段位/榜单、迁移 202611180019、契约/OpenAPI、测试、勾选与记录；用 `git log -- docs/productization/reports/MM-02.md` 定位。 |

独立复核结论（详见执行记录「独立玩家视角复核」）：check 199/19 与交接一致；完整集成 324/324 重跑通过（前任未整套重跑的部分）；22/22 玩家实测+对抗探针通过（真实注册邮件、双人匹配开局、双方出手、刷新与真实服务端重启接管、认输结算越权拒绝、队列/升级并发幂等、登录风暴 KDF 卸载）。MM-01 及账号/资产/结算/恢复链路声称可信。

MM-02 验证：check 207 单元/19 契约；定向集成 9/9；全量集成第二轮 332/333（唯一失败为既有 UI-07 负载敏感焦点/WebKit canvas 抖动，隔离重跑与 WebKit 单测 3/3 均绿，客户端与 324/324 验证态逐字节一致，非回归）；dist+startRuntime 生产冒烟通过。**已知抖动**：ui-accessibility 的「delayed reads」焦点断言与「webkit keyboard practice」canvas 5s 断言在全量并行负载下交替偶发失败；后续若再遇，先隔离/重试判定，不要直接归因新代码，也不要删改断言。

## 已实现的积分闭环

结算（NET-04 consumer）→ `Ratings.applyInTransaction` 同事务写 `rating_applications`（不可变）+ `ratings`；队列 `readForQueue` 读真实积分/赛季。`GET /api/v1/me/rating`、公开 `GET /api/v1/ratings/leaderboard`。

| 位置 | 职责 |
|---|---|
| `config/ratings.json`、`config/ratings.ts` | ratings-1 冻结配置：初始 1000/K32/scale400/下限 0/赛季 season-1/段位阈值。 |
| `packages/game-core/src/ratings.ts` | 纯 Elo/段位/结果映射（无平台依赖）。 |
| `packages/persistence/src/ratings.ts`、迁移 `202611180019_ratings` | RatingRepository；ratings/rating_applications 表与不可变触发器、榜单索引。 |
| `server/matches/ratings.ts` | Ratings service：结算端口、队列读取端口、own/leaderboard、游标编解码。 |
| `server/api/ratings.ts`、`packages/contracts/src/ratings.ts` | 两个 API 与严格契约；OpenAPI 已同步。 |
| `server/runtime.ts` | 装配真实积分端口；**生产 enabledModes 仍 ['friend']**。 |

必须保留的边界：

- 只对「权威+落盘+账号验证+非作废」计分；认输/断线判负计分，abandoned/server-fault/shot-limit 作废不计分也不创建积分行；平局 delta 0 计 draws。
- `rating_applications` 主键 (match_id,user_id)、append-only；applyInTransaction 先查已应用再按 userId 序锁行，用赛前积分计算，整体在结算事务内。
- delta 记录含下限钳制（after-before），边界零和不保证（有意取舍）。
- 队列入队冻结 rating_season 快照；配对要求同 scope+season 且分差≤窗口。直接 UPDATE 入队行会被 MM-01 不可变触发器拒绝——测试模拟切季用双赛季 Ratings 实例切换读取端口。
- 榜单最小身份：nickname/points/tier/wins/draws/losses，无 userId/邮箱；keyset 游标 base64url；非当前赛季空榜（历史榜 MM-03）。
- **生产排位/成长不开放**：展示 UI 与发布决策就绪前 enabledModes 保持 ['friend']（MM-01 交接门槛）。开放排位是产品决策，需老板确认。
- 测试房间码必须随机（room_code 全局唯一），不得复用其他套件固定码。

## 下一项

按依赖可领取：**MM-03**（赛季重置/历史榜，依赖 MM-02）、**MM-04**（等待策略/异常比赛，依赖 MM-02）、**MM-06**（练习 AI 难度/离线隔离，依赖 BAL-04+MM-01）。MM-05 仍待 NET-06（NET-06 待 OPS-03）。推荐 MM-03 以闭合赛季口径。先在执行记录写负责人、起始提交、范围与验收，再实现；复用 `ratings` 表与 `RATINGS_CONFIG.season`，切季幂等、跨季结算口径明确、历史榜冻结。

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

完整集成约 11–15 分钟（真实隔离 PG/Mailpit/浏览器）；以退出码与隔离清理判断完成。筛选：`node tools/run-pg-tests.mjs tests/<file>`。契约 `--check` 直接传 tsx 脚本（`node node_modules/tsx/dist/cli.mjs tools/export-contracts.ts --check`），避免 npm11 吞参数。cmd.exe 下注意 `if exist X cmd & rest` 会把整行并入条件分支；vite build 会污染进程 NODE_ENV，子服务环境需显式覆盖。

涉及联机/浏览器功能按实际变更运行构建、test:net、test:e2e、test:compatibility。提交前 `node tools/check-plan.mjs` 并检查 diff；代码、测试、勾选、记录同提交。

## 暂缓事项与用户边界

- AST-06 真机验收按用户要求暂缓（仅 iPhone 15 Pro，无 Android）；ACC-05 缺真实微信凭据/code；NET-06 待 OPS-03。均未勾选。
- 素材权利 0 项发布授权/269 项排除；先手偏差 7.3pp 超 5pp 工程门槛；依赖审计门槛保留。代码测试通过不代表可公开发行。
- D11 已对齐：大厅展示用原版 Q 版体育场图（老板本轮确认「Q版的！」），新旧壳共用 arena.ts 映射，web-shell 有回归断言，别删改。
- 未使用远端服务器。用户允许必要时远端 `/home/user/Wholeworks/wanganan` 作潜在工作区（占用≤服务器 2%），未授予任意部署/购买/生产权限。不要把本机结果写成远端验证，凭据不入 Git。
- 用户要求普通实施持续推进，不反复请求已给授权；缺真实设备/凭据时记录阻塞、保持未勾选，继续依赖已满足的任务。