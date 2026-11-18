# Agent 交接 · MM-01 → MM-02

2026-11-18。用户要求完成本项后交接，更换Agent继续开发；MM-01已完成，本轮未启动MM-02。请以TASKS、执行记录和本项报告核对当前状态。

## 接手先读

依次阅读仓库`AGENTS.md`、[规划入口](README.md)、[TASKS](TASKS.md)、[执行记录](EXECUTION_LOG.md)、[MM-01报告](reports/MM-01.md)和[匹配工程说明](../engineering/matchmaking.md)。任务清单是完成状态的唯一来源，历史`runs/`和旧开发提示不是当前指令。

工作目录为`D:\ai_for_games\碰撞全明星复刻`，分支`docs/productization-roadmap`，继续复用这个工作区。先检查HEAD、分支和本地修改，保留他人工作。已有未跟踪`.serena/`是本次开发前的本地目录，不提交、不删除。

## 本项状态与提交

当前**61/112已完成，剩余51项**，MM-01已勾选，下一项MM-02。[MM-01报告](reports/MM-01.md)保留实际验证顺序和失败修正：

- 完整check通过199单元、19契约及322文件格式/静态/配置检查；正式两端构建、176联机、18网页e2e和三引擎6项兼容验证通过。
- 完整集成初轮23文件/324项，323通过、1失败、0跳过，760.21秒；唯一失败为大厅账号尚未恢复时匹配按钮开放。真实/me延迟红测复现后，新增按钮在会话恢复期间禁用，相关整个网页文件4/4复验通过、0跳过（29.39秒）。没有再整套执行324项，不应报告成全量最终一次通过。
- 这次最终修正只影响新增匹配入口可点击条件，服务端业务未变；修正后lint/类型/322文件格式、正式客户端构建与readiness均通过。最新应用1687957/公共14086896字节。本轮运行器均已结束，隔离测试资源已清理，没有需要下一位继续等待的验收进程。176联机/18e2e/6兼容在入口修正前通过，未在修正后重复执行，具体先后见报告。

| 提交 | 内容 |
|---|---|
| `72adf7e5a0cd47dcd1bd47258f8c09a01153acf0` | NET-05完成，第60项GitHub同步点。 |
| `89394d6` | MM-01持久队列、严格契约和SQL原子配对。 |
| `4192e374f715bec80d3a8d6d31c3ff7db06184d4` | MM-01实际受限房间、冻结规则与开局match_id事务绑定。 |
| 本项最终提交 | HTTP/Web、实际验收、任务勾选和本交接；用`git log -- docs/productization/HANDOFF.md`定位，避免自引用提交号。 |

用户的同步节奏是每完成十项再对齐GitHub，下一同步点第70项。第60项已核对远端；本项最终提交保存在本地。接手时先核对分支/提交差异，不要硬重置或用远端覆盖本地进展。

## 已实现的匹配闭环

大厅「匹配对手」→本人五卡阵容/区域→服务端持久队列→真实双人受限房间→准备→可靠开局。当前实际开放friend均衡模式，统一等级、不计排位和正式奖励。ranked/growth仍关闭；不能用默认积分或空结算方法替代MM-02。

| 位置 | 职责 |
|---|---|
| `server/matches/matchmaking.ts`、`config/matchmaking.json` | 真实队列、冻结完整配置、唯一活动用户、原意图回执、取消/超时/分组/配对。 |
| `server/matches/matchmaking-coordinator.ts`、`server/matches/rooms.ts` | SQL配对后物化真实房间，预留与释放、失败恢复、原code重试及容量。 |
| `server/matches/matchmaking-authorization.ts`、`tickets.ts`、`recovery.ts` | 配对成员授权、新票与原阵容、开局原子绑定和已有比赛恢复。 |
| `server/api/matchmaking.ts`、`packages/contracts/src/matchmaking.ts` | 六个真实HTTP接口和严格状态消息；OpenAPI已同步。 |
| `packages/platform/src/account-client.ts`、`packages/client-model/src/queue.ts` | 账号/CSRF绑定、原请求重试、服务端确认状态和迟到响应失效。 |
| `client/src/queue/`、`client/src/rooms/` | 排队、刷新、取消/超时/失败、原阵容入场及双人准备。 |
| `packages/persistence/migrations/202611180018_matchmaking.mjs` | 配置、配对、队列、唯一约束、不可变字段和状态迁移触发器。 |

几个已经踩过的边界必须保留：

- 完成状态关联`assignment.match_id`，不能用可复用roomCode匹配历史比赛。
- 配置hash覆盖GameData、模式完整规则、mode和队列策略；不能只比较版本标签。配对入场使用原冻结selection。
- 队列协调锁先于账号锁，账号按稳定顺序锁定；配对、参与者、初始快照和实际比赛编号保持原子关联。
- 取消败给配对时返回原比赛；未知写结果重试原intent，不能凭本地UI宣告成功。
- 不把“匹配用户不能另开活动局”的限制扩散到所有历史好友房。既有NET-03用例要求较新的已完成局不遮蔽较旧可恢复局。
- 房间物化后ready保存失败时保留原房，generation释放隔离不能省略。原一次性nonce不进入URL或日志。
- 当前hostId对应本运行时；跨主机路由/未开局接管尚归MM-05。活动等待最多256、实际房间共128，不代表历史SQL回执已自动清理。
- `QUEUE_*`仍是历史协议占位，实际使用HTTP QueueStatus；不要另写一套假队列。

## 下一项 MM-02

按TASKS继续MM-02，依赖MM-01和NET-04。先在执行记录写负责人、起始提交、范围和验收，再实现版本化简单Elo，明确K、初始分、平局/作废与边界规则；完成持久积分、段位和榜单查询。

复用`server/matches/outcomes.ts`的`MatchRatings.applyInTransaction`，积分与原结算事务、幂等结果一致；队列的`ratings.read(tx,userId,mode)`必须读取真实服务端积分/赛季。现有SQL积分测试只证明分组，不是生产rating service。需要验证同局重复、乱序、同用户并发多场不丢更新，以及权限和失败重试。真实结算与展示全部就绪前，不启用生产排位。

随后按依赖顺序推进MM-03/04/05/06及其它工作包，不能因本轮停止在MM-01而缩小原112项计划。没有新增多Agent授权；不要据任务清单自行委派。

## 本机验证方式

每个新PowerShell会话先选择项目已验证的工具链；不要修改系统级PATH或升级依赖来消除环境差异：

```powershell
$env:PATH='C:/Users/31168/AppData/Local/pengzhuang-toolchains/npm-11.9.0/node_modules/.bin;C:/Users/31168/AppData/Local/pengzhuang-toolchains/node-v24.22.1-win-x64;'+$env:PATH
$env:PG_TEST_BIN_DIR='C:/Users/31168/AppData/Local/pengzhuang-toolchains/postgresql-17.12-1/bin'
$env:MAILPIT_TEST_BIN=(Resolve-Path 'work/toolchains/mailpit-1.34.0/mailpit.exe').Path
npm run check
npm run test:integration
```

完整集成在真实隔离PostgreSQL/Mailpit与浏览器运行，约十余分钟；以退出码和隔离资源清理结果判断完成。筛选测试直接调用`node tools/run-pg-tests.mjs tests/matchmaking-ui.integration.test.ts`；npm11可能把附加长参数作为npm配置吞掉。已有运行句柄要先确认结束，不要按观察超时重开。

本次已用`node node_modules/tsx/dist/cli.mjs tools/export-contracts.ts --check`直接核对契约，并通过`node tools/check-plan.mjs`（61/112、依赖/证据/链接全部通过）和readiness检查。契约的`--check`也应直接传给tsx脚本，避免被npm11当作npm配置而实际执行生成。

涉及联机/浏览器功能时按实际变更运行构建、`test:net`、`test:e2e`与`test:compatibility`。只做文档收尾时无需重跑完整游戏测试。提交前运行`node tools/check-plan.mjs`并检查diff；实际完成、测试证据、勾选与执行记录一起提交。

## 暂缓事项与用户边界

- AST-06真机验收按用户要求暂缓：没有Android设备，只有iPhone15Pro，未收集任何真机证据。桌面移动视口/WebKit不能替代真机。
- ACC-05缺真实微信授权凭据/code，保持未勾选。NET-06等待OPS-03。
- 素材权利仍0项发布授权通过/269项排除；既有先手偏差7.3个百分点超过5个百分点工程门槛，依赖审计门槛也仍在。代码测试通过不代表可公开发行。
- 本轮未使用远端服务器。用户允许必要时使用远端`/home/user/Wholeworks/wanganan`作为潜在工作区，资源占用不得超过服务器2%；没有授予任意部署、购买或修改生产权限。不要把本机测试结果写成远端验证，也不要把终端账户凭据写入Git。
- 用户要求普通实施持续推进，不要反复请求已经给过的授权；确实缺真实设备/凭据时记录阻塞、保持该项未勾选，继续依赖已满足的任务。

本次交接只完成MM-01，未开始MM-02。用户可将本文和仓库路径直接交给下一位Agent，按「接手先读」与「下一项MM-02」继续；不要重新从旧Demo提示或第1项开始。
