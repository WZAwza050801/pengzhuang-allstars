# Agent 执行与交接记录

任务完成状态只维护在 [TASKS.md](TASKS.md)。这里记录过程和证据，不另做一份状态表。

## 当前交接

- 2026-11-16：建立产品化规划、112 项任务、专项规范与清单检查器；功能任务均未勾选。
- 起始代码基线：`70a8df4e134eb3051b35e9343b875a80c39efb9c`。
- 本变更是规划交付，不代表 FND-01 或任何功能任务已由后续实施完成。
- FND-01 已完成本次独立验证；下一可领取 FND-02/FND-03/FND-06。远端同步仍受 403 阻塞。
- 历史会话测试见 BASELINE；后续实施不得重复引用为新代码的测试证据。

## 初始规划交付验证（b60b10e，历史记录）

- `node tools/check-plan.mjs`：112 项、18 工作包、0 项勾选；依赖无环、编号唯一、文档本地链接存在；首个可领取任务为 FND-01。
- `node --check tools/check-plan.mjs`：JavaScript 语法检查通过。
- 内存夹具验证 8 个检查器场景：正常规划、循环依赖、未知依赖、无完成证据、依赖未完成、错误复选框格式、重复编号、合法完成并解锁后续任务，均符合预期。夹具没有改动真实任务状态。
- 本次只变更规划、入口文档及检查器，不修改游戏功能或配置；因此没有把旧游戏测试重复运行当作本次文档的必要验证。
- 提交前 `git diff --cached --check` 通过，无空白错误；后续实施新增代码时需按任务重新验证。
- 已在本地分支 `docs/productization-roadmap` 提交。GitHub 插件创建分支返回 `403 Resource not accessible by integration`；现有 HTTPS Git 连接推送也返回 403。因此本次没有写入远端或创建 PR，交付文档包及可导入补丁；恢复仓库写权限后可提交同一变更。

## 任务执行记录

### UI-07

- 状态：完成
- 开始：2026-11-18 14:54 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 05ad7a5
- 范围：现有已开放 Web 页面的语义/焦点/触控/大字体/减少动画、统一页面异常恢复和本地反馈说明入口；补齐比赛键盘操作，验收页面状态矩阵、快速切页与故障恢复。未开放模式/社交/运营页保持真实关闭，不以占位功能勾选后续任务，不改物理/经济。
- 验收计划：真实数据库/邮箱/浏览器的完整主流程；规定 8 个视口、DPR1/2/3、正常/大字、触控/键盘、弱网/离线/减少动画，按已支持浏览器实测；权限与迟到响应保持现有保障，错误注入不留白、无无效主操作。产出页面状态矩阵、组件说明和可复查交互报告后，完成适当回归再勾选提交。
- 实现：增加页面/初始模块异常恢复、具名主标题/表单反馈焦点、44px 独立操作与大字重排、允许浏览器缩放；设置白名单字号/减少动画（存储失败保留当次偏好），反馈仅生成未发送的本地草稿。比赛增加沿用 ShotInput 的辅助出手，菜单/辅助/结果统一焦点循环、Esc/恢复、背景 inert；账号局外部连接条也锁定并在关闭/销毁时恢复。减少画面运动保留事件文字，不改物理、计时、规则或经济。
- 验证：最终 npm run check 通过（283 格式、186 单元、16 契约及静态/生成检查）；真实 PostgreSQL/Mailpit 完整集成 16 文件/246 项、0 跳过；含 UI-07 15 项、好友房浏览器 21 项。69 次页面/弹窗检查（Chromium/WebKit 46 次 axe 全标签规则、Firefox 23 次原生 DOM 语义），336 组视口/字号、9 条主流程/故障场景通过。联机 176 PASS/0 FAIL；最终 E2E 18 PASS/0 SKIP/0 FAIL、无 console/pageerror；三引擎兼容 6 项通过。弱网首屏 4508ms/670288B、帧 p95 16.7ms、10 局堆增 1024352B，预算通过；正式/测试客户端、服务端构建与 readiness 通过（应用 1671833B、公共资源不变）。收尾删除不可达的重复比赛路由后，类型/lint、构建、E2E/兼容与性能再次通过。
- 证据：本提交（git log -- docs/productization/reports/UI-07.md 可定位）、[UI-07 报告](reports/UI-07.md)、[页面状态矩阵与组件约定](../engineering/web-accessibility.md)、真实浏览器/数据库测试。外部连接条未 inert 的实际失败先复现再修正；截图实际查看，所有实现与勾选一起提交。
- 风险与剩余：Firefox 159 headless 注入 axe 偶发原生崩溃，已用不同构建/通道复现并单列工具限制；该引擎最终为 DOM 语义及完整交互/矩阵，不冒充 axe 或所有辅助技术认证，未禁用执行中的 axe 规则。图片/Canvas 对比度有 incomplete，真机/音频验收仍归 AST-06。新增仅锁定 axe 开发依赖；官方 npm audit 仍 31 项既有问题，素材与平衡发布门槛保留。AST-06/ACC-05 继续未勾选；隔离服务已停止，未使用远端服务器，保留原 .serena/。
- 回滚：还原本提交的 Web/游戏视图、辅助转换、开发依赖与文档；没有新增业务迁移，既有资产/结果数据不需回写。两个显示偏好是本机可忽略设置，不能产生资产权限。
- 下一项：DAT-06；累计 58/112，第 60 项同步 GitHub。

### UI-06

- 状态：完成
- 开始：2026-11-18 14:07 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 9e51061
- 范围：账号结果页/本人战绩入口、已结束与待入账分离、原结果刷新/离线保留/查询重试、本人匹配流水查询、active-match 及已结束回局引导、好友赛再开新局。复用 NET-04 结果/奖励合同、既有资产账本和好友房流程；不开放未接真实积分的正式模式，不改奖励或物理。
- 验收计划：真实数据库/双浏览器验证发奖延迟、广播丢失、刷新后原结果、离线/恢复、查询失败不归零、已结束不重入、越权/切号/迟到响应隔离、重复查询/再来一局不重复写入；验证移动/桌面布局与键盘，并运行必要的完整回归后勾选提交。
- 实现：本人结果/分页记录页，结束画面与顶栏、大厅和结束回局面板连接原结果；严格区分保存/待入账/已结算/失败。按 user/session 隔离 32 场内存副本，退出/换号/销毁清除，离线保留已确认内容、联网刷新原 matchId，迟到响应和较旧状态不覆盖。新增只读本人匹配流水、凭证/条数/金额核验；查询不发奖。再来一局进入当前阵容的新好友房，沿用单次创建保护；已结束局取消重连且关闭后不再发送 leave。
- 验证：`npm run check` 51 文件/183 单元、7 文件/16 契约、274 文件格式与静态/生成检查通过；完整集成 15 文件/231 项、0 跳过，包含账号房/HTTP 34 和好友房浏览器 21。终局关闭连接修正后关联单元 8/8、完整好友房浏览器 21/21 且无意外错误；最终类型/lint/格式通过。旧联机 176 PASS/0 FAIL，最新测试产物浏览器 18 PASS/0 SKIP/0 FAIL、无 console/pageerror；完整及末次客户端构建/readiness 通过。弱网首屏 3995ms，帧 p95 16.8ms，10 局堆增量 951500B，通过原预算且大厅未预载比赛/场地。
- 证据：本提交（`git log -- docs/productization/reports/UI-06.md` 可定位）、[UI-06 报告](reports/UI-06.md)、[结果页/离线/本人流水约束](../engineering/match-results-ui.md)、结果模型及真实数据库/双浏览器测试。实际查看移动、桌面正数奖励/流水和 320 大字号画面，键盘新局和分页验证通过。
- 风险与剩余：离线副本只覆盖已确认登录的仍运行会话，不声称冷启动离线或未读结果可恢复；新会话联网刷新读服务端。积分按现有好友赛真实不计排位，growth/ranked 未开放且不虚构零变更，真实记录由 MM-02 接入。无新依赖/业务迁移或物理/经济改动，运行中服务重启接管留 NET-05；真机/微信/素材/审计/平衡门槛保持。未使用远端，隔离服务/浏览器正常停止。
- 回滚：协调回退结果页/导航/平台与只读流水合同，保留已有 outcome/outbox/账本；无新增迁移，原好友房和服务端结算继续可用，不删除历史数据或重放奖励。
- 下一项：UI-07；累计 57/112，第 60 项同步 GitHub。

### NET-04

- 状态：完成
- 开始：2026-11-18 12:44 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 0796e79
- 范围：权威终局/冻结结算配置、事务 outcome+outbox、可重放待结算意图、幂等资产消费者、本人战绩/结果与奖励查询、真实 pending 提示。复用 DAT-04 账本和 BAL-05/BAL-06 既有奖励/模式规则；好友赛零正式奖励，实际排位由 MM-02 接入后开放，不能以空排名方法宣称完成。
- 验收计划：同局同载荷幂等/异载荷冲突、事务每个提交边界/广播失败、并发消费者/同用户多局/封禁与越权、DB/文件故障、服务进程死亡后真实意图与 outbox 恢复、日限额与参与卡、历史配置固定及原完整回归。成功前保留恢复依据，不将 pending 当成已发奖。
- 实现：配置 hash 随开局事务固定；终局先保留不可变意图，再事务写 outcome/matches/outbox，后台消费者原子写资产/账本/奖励、共享日上限/参与卡进度与可选排名端口。私有 fsync 日志作为 DB 故障恢复依据，DB/日志双故障冻结同一 RAM 候选且不发终局接受确认；已保存后才回收房间，结算成功才关闭恢复标记/清日志。同载荷幂等，冲突保留证据并停重试；12 次有界退避与失败通知。本人只读战绩/结果 API、平台合同校验和现有比赛 pending/recorded/settled/failed 顶栏已接通。
- 验证：最终 `npm run check` 50 文件/177 单元、7 文件/15 契约、268 文件格式与静态/生成检查通过；完整 `npm run test:integration` 15 文件/226 项、0 跳过（结算 19、账号房 34、真实好友房浏览器 16）。三个实际进程 kill 边界、六类事务写入边界、双消费者/多局/日限额/跨日参与卡、冻结配置、哈希冲突、权限/分页、广播丢失、DB/文件双故障与延迟消费均验证。test:net 176 PASS/0 FAIL，e2e 18 PASS/0 SKIP/0 FAIL 且无 console/pageerror；构建与 readiness 导出、diff 检查通过。
- 证据：本提交（`git log -- docs/productization/reports/NET-04.md` 可定位）、[NET-04 报告](reports/NET-04.md)、[结算接口与故障语义](../engineering/match-settlement.md)、真实进程夹具及集成测试。移动视口结算提示截图实际查看，未当作真机。
- 风险与剩余：实际生产排名由 MM-02 接入前不开放 growth/ranked；SQL 测试排名标记只验证事务，不假装 Elo。独立结算/刷新回局页留给 UI-06，运行中账号局服务重启接管留给 NET-05，12 次后管理重试/补偿留给 ADM-03/DAT-06。无新依赖或玩法/经济变更；未使用远端，隔离服务/子进程已停止。AST-06/ACC-05 和素材/审计/平衡门槛保留。
- 回滚：先停止新局/消费者、备份并保留 outcome/outbox/日志与账本，再部署兼容版本；已有结算历史时不直接执行删除表的 down。空测试库迁移回滚已随全量验证。
- 下一项：UI-06；累计 56/112，第 60 项按约定同步 GitHub。

### NET-03

- 状态：完成
- 开始：2026-11-18 12:05 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 702e64e
- 范围：持久化比赛/本人参赛关系；登录查询 active-match 与短期一次性重入票据；大厅/新页面按原冻结阵容恢复，覆盖刷新、关闭/杀客户端与切换网络。按任务验证条目，NET-03 的跨进程指客户端进程；服务端重启快照接管由 NET-05 实施，本轮返回明确不可用状态，不冒充已具备服务端接管。
- 验收计划：真实 PostgreSQL/SDK 与新浏览器进程验证本人权限、切号/封禁/撤销、改阵容后恢复、过窗/终局/服务端消失、并发重入/票据重放与数据库失败；保持协议/物理/经济，完整回归后勾选并提交。
- 实现：复用 matches/match_participants 事务保存开局和原持有卡，记录恢复关闭原因；本人 active-match API 和 protocol-only 重入票据，原云阵容 revision 变化不阻断原局。大厅/好友房恢复面板，旧响应/换号/离页隔离，恢复 Host 后仍按原 matchId 换新票重连；窗口、终局和原服务不可用分别明确响应。
- 验证：最终 `npm run check` 49 文件/173 单元、6 文件/14 契约、261 文件格式及全部静态/生成检查通过；完整 PostgreSQL 17.12/Mailpit/Chromium 集成 14 文件/200 项，0 跳过（账号房/恢复 28 项，好友房浏览器 15 项）。旧联机 176 PASS/0 FAIL，最终浏览器 18 PASS/0 SKIP/0 FAIL、0 console/pageerror；最终构建/readiness 和迁移回滚重放通过。
- 证据：本提交（git log -- 本记录可定位）；[NET-03 报告](reports/NET-03.md)、[恢复接口与状态机](../engineering/match-recovery.md)。BrowserServer.kill 实际结束旧进程，再由不同 PID/空 origins 的新进程仅凭登录 Cookie 找回同场 side 0；刷新/改阵容/二次断线换票均通过。320px 恢复提示和比赛画面已实际查看。
- 风险与剩余：本任务验收无已知阻塞。NET-04/05/06 继续处理 durable outcome/奖励、服务端重启快照/关闭标记修复与计算容量；账号房不写游客文件，无服务端接管时明确 unavailable。微信、真机、素材/依赖/平衡发布门槛保留；本轮未使用远端服务器，原 .serena/ 保留。
- 回滚：停新局并排空账号房，配套回退客户端/服务端后撤销 202611180014；移除恢复定位/关闭字段，比赛和参赛历史保留。不得在新版仍运行时删列。
- 下一项：NET-04；累计 55/112，第 60 项同步 GitHub。

### NET-02

- 状态：完成
- 开始：2026-11-18 11:24 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / fd5712f
- 范围：账号 v2/游客 v1 兼容、冻结版本、按 match/user/shot 比较载荷并返回原 seq；串行处理出手/时钟/认输与过期计算保护；有界帧和消息。保留物理/玩法与既有游客恢复语义，不代替 NET-03/04/05 的账号持久恢复/结算。
- 实现：账号协议 2 与游客 1 分流，迁移绑定票据版本；426 明确升级错误；SHA-256 回执区分账号/比赛/出手，原样重试回原 seq/acceptedRevision，异载荷冲突。房间有界串行队列、单调到达 revision、时钟 generation、克隆计算提交 epoch 检查；过期重连不因排队延长。入包 2048 bytes、回放 512 KiB/1024 帧及冻结时长限制；客户端忽略旧状态，ACK 漏包只同步。
- 验证：最终 `npm run check` 48 文件/172 单元、5 文件/12 契约、256 文件格式及全部静态/生成配置检查通过；`npm run test:integration` 隔离 PostgreSQL 17.12/Mailpit/Chromium，14 文件/189 项通过、0 跳过；其中账号票据/新协议 19 项，好友房浏览器 13 项。最终构建/readiness 通过；旧 `test:net` 176 PASS/0 FAIL，`test:e2e` 18 PASS/0 SKIP/0 FAIL、0 console/pageerror。
- 证据：本提交（git log -- 本记录可定位）；[NET-02 报告](reports/NET-02.md)、[协议定义](../engineering/match-protocol.md)；新增回执/队列/帧 4 项、真实连接竞态/故障 7 项及客户端排序 3 项，全部实际执行。
- 风险与剩余：本任务验收无已知阻塞。账号回执目前在房间内存，NET-03/05 负责跨进程恢复与崩溃持久性；NET-04/UI-06 负责可靠结果和奖励，NET-06 负责 worker/计算容量。微信、真机与既有素材/依赖/平衡发布门槛保留。全程本地验证，临时服务正常关闭，未使用远端服务器；保留原 .serena/。
- 回滚：停止账号入口并排空账号房，按顺序回退 202611180013 迁移和本任务代码/客户端；旧票据应过期后重签，不能在新代码仍运行时移除协议列。游客记录格式 1 保留缺哈希兼容。
- 下一项：NET-03；累计 54/112，第 60 项同步 GitHub。

### UI-05

- 状态：完成
- 开始：2026-11-18 10:31 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / c55760b
- 范围：登录好友房、持有阵容选择、邀请与准备；一次性票据接既有 Host/Canvas；区分待确认、双方回合、播放与断线；音量、认输和退出确认。保留既有输入/物理，恢复和奖励的后续任务不提前勾选。
- 验收计划：真实账号双浏览器建房/邀请/准备、双方视角鼠标/触屏弧线、服务端超时/认输；请求重复/迟到、掉线禁用与新票据重连、切号/快速退出/重复挂载、窄屏热区与声音设置；必要单元/契约/数据库/旧浏览器回归。独立提交回滚，复用既有设计规范。
- 实现：friendRoomsEnabled 与真实服务/manifest 对齐，维护在服务端阻止新票据；匿名邀请登录/恢复回跳，持有阵容选择和双方准备。OnlineHost 接账号票据、即时 pending 锁与换票恢复；借用 Host 的 GameView 支持 StrictMode、首个 resume、旧回调隔离；全屏双方视角/HUD、对手断线、音量/菜单焦点及确认退出/认输。公共维护不冻结原局；资源声音源 hash 同步导出。
- 验证：Node 24.22.1/npm 11.9.0；check 157 单元/11 契约、251 文件格式及其余门槛通过；最终完整 PostgreSQL/Chromium 集成 14 文件/187 项，0 跳过；原 net 176/0；生产构建与资源 readiness 一致；最终 e2e 18/0/0，0 console/pageerror。13 项房间浏览器涵盖完整交互与权限，320/768/1440 双方全部球员命中 Canvas。
- 证据：本提交（git log -- docs/productization/reports/UI-05.md 可定位）；reports/UI-05.md、docs/engineering/friend-rooms.md、rooms-pages.integration.test.ts。work/ui05-browser 截图已实际查看，完整命令/行为摘要入报告，不把局部跳过或截图当真机证据。
- 风险与剩余：本任务验收无已知阻塞；NET-03/04/05 与 UI-06 继续负责通用 active-match/跨进程恢复、可靠结果和奖励；真机听感/iOS 中断、微信真实资格与现有素材/依赖/平衡发布门槛保留。未使用远端服务器。
- 回滚：独立提交；无数据库迁移或新依赖，回退能力/页面/音频及生成资源为同一版本；保留 NET-01 服务与旧游客语义。
- 下一项：NET-02；累计 53/112，第 60 项同步 GitHub。

### NET-01

- 状态：完成
- 开始：2026-11-18 10:00 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / dfe65a3
- 范围：长期账号房间与旧游客试玩隔离；事务保存合法阵容和短时一次性票据；onAuth 原子消费并复查账号/会话；跨房间建房与连接限流。复用现有物理与模式，不提前实现 NET-02/03/04 的出手协议、跨进程恢复和奖励结算。
- 计划与验收：真实 PostgreSQL 并发重放、过期/封禁/撤销/越权与失败回滚；真实 SDK 双账号入局、伪身份与阵容篡改拒绝、旧 seatToken 不绕过账号；全局限流/建房滥用与原 net 回归。独立任务提交回滚；新增迁移仅在无依赖数据时回退。
- 实现：60 秒随机 nonce 的 hash 与合法持有快照同事务保存，消费锁用户/session并条件 UPDATE；账号房绑定 userId/原阵容，拒绝客户端等级与旧 token，重入仍复查状态。服务端创建 grant、两个席位及一个临时鉴权连接位；全运行时 HTTP/WS/IP/建房共用有界预算，数据库每账号签发上限；明确隔离旧游客恢复文件。
- 验证：Node 24.22.1/npm 11.9.0；check 153 单元/11 契约及 244 文件格式通过；完整集成 13 文件/173 项，0 跳过；票据与迁移定向 22 项、最终准入 4 项通过；原 net 176/0；生产构建通过；真实 Chromium 18/0/0，0 console/pageerror。全量中发现的迁移旧断言/CORS 回归均已修正复验。
- 证据：本提交（git log -- docs/productization/reports/NET-01.md 可定位）；reports/NET-01.md、docs/engineering/account-rooms.md、真实数据库/SDK/HTTP/WS 测试。临时资源正常停止，无远端服务器资源占用。
- 风险与剩余：本任务验收无已知阻塞；active-match/跨进程恢复、持久结果/奖励及正式比赛 UI 由 NET-03/04/05、UI-05 推进；单进程准入不冒充跨实例网关容量验收。真实微信、真机、素材/依赖/平衡发布门槛保留。
- 回滚：独立任务提交；停止账号入场后按迁移规范回退新票据表，旧试玩仍按原语义。生产回退不可恢复未用票据。
- 下一项：UI-05；累计 52/112，第 50 项已同步 GitHub，下一同步点第 60 项。

### 本地验证恢复（BAL-06 前置）

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 1eb0cc4
- 范围：修复 Windows 端口占用测试的地址族不一致，并让 Lint 排除 Git 已忽略的历史临时脚本；不提前勾选 QA-01。
- 复现：上轮实跑单元测试 60/61，端口占用场景未拒绝；npm run check 在 .qwen 和 runs/_*.cjs 报 113 个 Lint 错误。
- 实现：占用端口的测试夹具使用与运行时相同的通配监听地址；增加两个对应的 Lint ignore。资源来源策略升级 v3，排除 .gitignore 已列明的美术生成中间目录与 Python 缓存；原有 987 项资源的 hash、来源与权利状态均未改变。
- 验证：Node 24.22.1/npm 11.9.0；server.test.ts 2/2；完整 npm run check 退出 0，单元 61/61、契约 4/4、资源与数值/经济检查全部通过。
- 证据：本提交（git log -- tests/server.test.ts 可定位）；未改游戏规则或提前勾选任何产品任务。
- 下一项：BAL-06。

### BAL-06

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 6878ab0
- 范围：四模式版本化规则、共享摘要契约、权威等级/持有权校验、隔离榜单及奖励资格、房间摘要与恢复、先后手配对实验。游客只开放练习与均衡好友赛；不代替 ACC/DAT/NET 的账号、事务结算或 MM 的排行榜。
- 计划：contracts/modes 定义 DTO；config/modes 固定工程默认；game-core/modes 提供纯规则；房间与 Host 共用；补契约/边界/真实 SDK 测试和 ADR、报告。回滚采用独立任务提交，旧游客房间缺少 mode 时保持练习语义。
- 实现：modes-1 与共享 DTO/纯规则接入房间、等待室和本地 Host；统一好友等级、验证正式模式持有权并隔离结果资格；冻结/恢复摘要，修正 OnlineHost 的第二座位视角；浏览器联机夹具使用独立临时存档。
- 验证：Node 24.22.1/npm 11.9.0；完整 check（单元 70/70、契约 5/5）；build；physics 18/18、net 176/0；真实 Chromium 15/15，0 SKIP、0 FAIL、0 JS 错误；8 场固定种子配对实跑完成。
- 证据：本提交（git log -- docs/productization/reports/BAL-06.md 可定位）；reports/BAL-06.md、reports/mode-pairs.json、reports/mode-lobby.png。
- 风险与剩余：游客不能进入正式排位/成长模式；正式账号、可靠结果与账本留给 ACC/DAT/NET/MM。8 场不是充分平衡证据。
- 回滚：独立任务提交；旧协议可选字段和旧练习存档继续兼容，不改物理配置。
- 下一项：BAL-07。

### BAL-07

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / b524d9e
- 范围：1000 场固定种子配对实验、可复现报告与敏感性分析；发布校验器；基于现有配置注册表的差异、按服务端分组灰度、停用/回滚和旧局回放验证。保留已确认的物理、技能和奖励默认，不为过门槛修改玩法。
- 计划：先复用 8 场实验器扩展批次与统计；为注册表增加灰度和停用，房间使用服务端生成的 cohort；验证旧快照/历史回放不变并保存基线配置档案。发布校验失败会如实记录，不作为自动调参授权。
- 实现：1000 场/500 seed 配对 + 40 场敏感性、配置指纹及真实历史重放校验；稳定服务端 cohort 灰度、停用/回滚、完整 diff、物理与模式基线归档。修正 test:balance 在 Windows 上不展开 shell 通配符导致漏跑的问题。
- 验证：完整 npm run check 退出 0（单元 77/77、契约 5/5）；test:balance 31/31；build；physics 18/18、net 176/0；Chromium PASS=15/SKIP=0/FAIL=0。实验报告校验退出 0；严格发布检查按预期退出 1。
- 证据：本提交（git log -- docs/productization/reports/BAL-07.md 可定位）；reports/BAL-07.md、reports/balance-experiment.json、reports/BALANCE_REPORT_TEMPLATE.md；docs/engineering/balance-release.md。
- 风险与剩余：先手半分得分率 57.3%，近似 95% 区间 54.30%–60.30%，未达到 5pp 放量门槛。保持现有参数与灰度关闭；正式账本及跨重启控制留给 DAT/OPS，未声称平衡或生产灰度完成。
- 回滚：独立任务提交；register 不激活、activate 旧版会清灰度、disable 不删除历史包；旧局及回放继续原快照。
- 下一项：AST-02。

### AST-02

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 39c93e6
- 范围：全部 117 名球员的原创程序化占位图、五品质三状态卡框、带 2px 留边的图集与严格映射；资源来源记录及全卡联系表/DPR 加载验收。保留旧 Demo 的原版头像入口，本项新增可供后续组件和发布替换使用的资源。
- 计划：contracts 的图集契约与纯布局；可复现导出器；与目录校验器绑定；Canvas 卡片绘制与独立验收页；输出尺寸/锚点/裁切规格及实际加载证据。名字、等级及位置标签动态绘制，不烘焙进纹理。
- 实现：严格图集与身份契约、原创程序化导出器、Canvas 绘制与隔离验收页；目录增加 data 类型使元数据变更参与缓存版本，来源/权利状态显式保留；修复 Node 单元测试传输与并发配置。
- 验证：完整 check（单元 80/80、契约 5/5）；build；cards-browser 全量 117 卡/15 框/3 页、528 留边采样、DPR1/2/3、断图重试；游戏 Chromium 15/15，0 SKIP/FAIL/JS 错误；房间/重启连续 30 次通过。
- 证据：本提交（git log -- docs/productization/reports/AST-02.md 可定位）；reports/AST-02.md、reports/card-atlas/browser.json 与三张已检查截图；docs/engineering/card-atlas.md。
- 风险与剩余：新增图是明确标记的原创几何占位；商用批准仍为 0，未替代 REL-01；运行时缓存与发布裁剪留给 AST-05，真机留给 AST-06。
- 回滚：独立任务提交；旧头像入口和玩法数据保持兼容。
- 下一项：AST-03。

### AST-03

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 2fdde64
- 范围：按现有足球/卡牌语义建立亮暗 tokens、无文字九宫格按钮/面板、原创图标与五套球场展示缩略图；复用九种程序音效，记录源码指纹与来源。不给占位资源虚构商业许可，不更改碰撞几何或原版 Demo 入口。
- 计划：严格资源包契约、纯布局/九宫格切片与边界测试；浏览器程序化导出；目录绑定与设计索引；隔离预览验证亮暗、状态、大字体、资源失败重试和音频解锁。
- 实现：亮暗 tokens、39 个带留边图形、九宫格切片、导出/校验器与总目录绑定；原始音源指纹、动态文字、隔离的可操作预览和设计索引。
- 验证：完整 check（单元 83/83、契约 5/5）；build；UI 浏览器四组亮暗/字号/DPR、键盘、音频手势/静音、断图重试通过，0 控制台错误/警告；游戏 Chromium 15/15，0 SKIP/FAIL/JS 错误。
- 证据：本提交（git log -- docs/productization/reports/AST-03.md 可定位）；reports/AST-03.md、reports/ui-assets/browser.json 与四张截图；docs/engineering/ui-assets.md。
- 风险与剩余：原创占位不等于最终美术或商业批准；平台音频中断与真机视觉留给跨端验收。
- 回滚：独立提交；旧 Demo 入口兼容，不改玩法。
- 下一项：AST-04。

### AST-04

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 0f973a1
- 范围：从 ui-tokens 单一输入生成 Web CSS 与 Canvas 数据；实现可复用语义组件和隔离样例页，列明 props/状态/动作；用同一状态模型验证 Web/Canvas 语义、对比度、焦点和失败重试。业务账号/资产接入仍按 UI/ACC/DAT 依赖推进。
- 计划：生成一致性和状态/大整数格式边界测试；共享展示语义；Web 组件与窄 Canvas 绘制适配；真实浏览器组件交互、空错加载/禁用、模态焦点、亮暗与大字体验收；独立提交可回滚。
- 实现：单源 Web CSS/Canvas 数据、构建时生成一致性检查；19 类组件目录/可操作样例和共享状态；卡品质色接入同一输入，PNG 不变；修复非可操作状态颜色和模态反向焦点循环。
- 验证：完整 check（单元 86/86、契约 5/5）；build；19 类/六状态 DOM-Canvas 像素与资格、焦点循环/恢复、重试、卡牌、分页、亮暗/200%/DPR1/2/3；卡牌与 UI 图集浏览器回归通过；游戏 Chromium 15/15，0 SKIP/FAIL/JS 错误。
- 证据：本提交（git log -- docs/productization/reports/AST-04.md 可定位）；reports/AST-04.md、reports/components/browser.json 与六张截图，实看联系表与暗色 Canvas；docs/engineering/ui-components.md。
- 风险与剩余：演示数据仅用于组件验收；微信实际组件/输入适配、React 业务壳和真实账号/资产仍按后续依赖实施。
- 回滚：独立提交；保留旧 Demo 兼容入口。
- 下一项：AST-05。

### AST-05

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 91b2651
- 范围：按场景取消/释放、基于 hash 的有界内存/持久缓存、损坏重取与远程失败回退；接入实际比赛图片加载，保留程序化降级；低分辨率场地档与按引用过滤构建资源，生成场景包体报告。商业发布批准仍遵守 REL-01。
- 计划：先验证去重/取消/损坏/版本/容量；实现可注入字节管理与 Web 适配，比赛宿主释放；导出低分辨率资源及过滤发布目录；真实浏览器注入缓存损坏/离线/取消与游戏回归。
- 实现：共享/取消的 hash 字节管理与 Web 有界缓存、比赛与新图集场景接入、原有程序化降级、十张低纹理、有限动态引用枚举、过滤构建和五类包索引；修复包体统计重复计图和裁剪遗漏旧动态卡框/属性/技能图标。
- 验证：完整 check（单元 92/92、契约 5/5）；build/最终过滤客户端重建；真实 CacheStorage 损坏/离线/版本/取消/容量、低纹理和断图出手；真实构建逐张检查 106 张详情、864 次图片解码、0 控制台错误/警告；卡牌/UI/组件浏览器回归通过；游戏 E2E 16/16，0 SKIP/FAIL/JS 错误；商用资源门槛按预期退出 1。
- 证据：本提交（git log -- docs/productization/reports/AST-05.md 可定位）；reports/AST-05.md、reports/asset-cache/browser.json 与实看截图、reports/asset-packages.json；docs/engineering/asset-loading.md。
- 风险与剩余：过滤去掉 72 项/17,188,681 B，批准仍为 0；逻辑 Web 场景包不等于微信分包或真机预算通过；旧大厅静态 HTTP 资源由后续 UI 壳迁移。
- 回滚：独立提交；取消过滤可恢复原全量本地包，旧兼容入口与物理数据不变。
- 下一项：AST-06。

### AST-06

- 状态：Web 子集已验证；真机依用户要求暂缓，整项未完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 99b04b2
- 范围：Web 多视口/DPR/引擎资源检查、许可清单与平台预算审查。用户随后更正：仅有 iPhone 15 Pro、没有 Android，明确暂时搁置真机验收；不启动手机验收服务，不将桌面模拟器记作真机。
- 计划：补已发现的普通局域网 HTTP 缺少 WebCrypto 的资源 hash 兼容并按官方资料锁定依赖；测试真实非安全上下文；导出三引擎 Web 矩阵与当前资源批准/预算状态。真机部分依用户要求暂缓，复选框保持未完成；继续后续可独立开发任务。
- 实现：三引擎资源矩阵、许可/包体清单；无 WebCrypto 的 SHA-256 动态回退；头像预载等待、解码状态和 WebKit 模态焦点修正；动态模块改写之后核对最终包体。
- 验证：check（单元 93/93、契约 5/5）；build/最终客户端重建；三引擎 144 视图、432 几何组、每引擎 117 原头像与卡片、0 错误/警告；真实非安全上下文加载；资产故障浏览器与游戏 E2E 16/16。
- 证据：本提交（git log -- docs/productization/reports/AST-06.md 可定位）；reports/AST-06.md、reports/asset-matrix/browser.json 与截图、reports/asset-readiness.json。
- 剩余：iOS/Android 真机及平台实际包预算未验收；批准为 0；WebKit 冷缓存批量写入需后续性能量化。按用户更正不开展真机工作，不勾选 AST-06。
- 下一项：UI-01（不依赖 AST-06）。

### UI-01

- 状态：完成
- 开始：2026-11-17 Asia/Shanghai
- 负责人：Codex desktop
- 分支与起始提交：docs/productization-roadmap / 205d315
- 范围：五主入口的信息架构、内部页面意图/视图模型、访问与功能开关语义、页面流程/线框。保留 BAL-06 的游客练习/均衡好友赛；正式持有卡/排位要求账号。原型明确为演示，不冒充业务 API 已实现。
- 计划：纯 client-model 页面定义与导航准入；匿名登录回跳、关闭功能、离线/维护/版本边界验证；交互线框与跨端差异/API权限对照；Web 浏览器走读后独立提交。
- 实现：无平台依赖的 client-model、封闭内部意图与准入、12 页状态/返回/路径、五主入口；登录回跳/取消/失败重试、功能开关及离线/维护；交互线框、流程图和 API/权限/平台差异对照。复用既有 ModeId/Queue schema。
- 验证：完整 check（96/96 单元、5/5 契约）、build、游戏 E2E 16/16（含生产隔离）；最终导航/线框迭代经 lint/typecheck/38 文件边界检查、导航单测和桌面1280/手机390/320走读通过。0 业务写请求、0 控制台错误/警告，实看手机截图。
- 证据：本提交（git log -- docs/productization/reports/UI-01.md 可定位）；reports/UI-01.md、reports/workflow/browser.json 与三张截图；docs/engineering/client-navigation.md。
- 风险与剩余：原型模拟状态明确标记；现有服务器未挂完整账号/资产服务，默认新壳功能关闭；前端准入不能代替服务端鉴权。AST-06 真机继续按用户要求暂缓。
- 回滚：独立提交，旧可玩 Demo 保持原入口。
- 下一项：UI-02。

### FND-01

- 状态：完成
- 开始：2026-11-16 22:26 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / b60b10eed31715daf54dde8150526f5c81e2df8f
- 范围：从已提交代码导出隔离副本，按锁文件安装，重新核实环境、类型、构建、物理、联机、真实浏览器与双客户端恢复；更新基线和持久验证报告。暂不改游戏玩法或完成后续任务。
- 实现：全新归档副本与锁定安装，更新 BASELINE、旧文档差异及持久证据；测试生成的四个已跟踪文件均留在副本，玩法代码与锁文件未改。
- 验证：npm ci/typecheck/build 退出 0；physics 18/18；net PASS=176/FAIL=0；Chromium PASS=7/SKIP=0/FAIL=0；双 SDK 客户端 17 项 PASS/0 failure。环境和每条命令见报告，本次未沿用旧测试结果。
- 证据：本提交（git log -- docs/productization/reports/FND-01.md 可定位）；reports/FND-01.md、reports/FND-01/results.json 和 8 份原始文本日志。
- 风险与剩余：本地验收无阻塞。GitHub 写入仍为 403，远端未同步；既有构建体积提示、未覆盖错误码与 SDK 警告已在报告记录，后续按相关任务处理。
- 回滚：本任务只修改基线、报告、执行记录与对应复选框，可独立回退。
- 下一项：FND-02/FND-03/FND-06；未执行或勾选后续任务。

### FND-02

- 状态：完成
- 开始：2026-11-17 12:13 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 03b550bc971c45045dac31ea005ac2e8899c789f
- 范围：锁定运行时与包管理器、记录依赖兼容元数据、全新安装并验证现有核心命令。
- 实现：锁定Node/npm及安装前校验；核查候选依赖元数据，现有游戏依赖不变。
- 验证：全新npm ci、工具链正反例、typecheck/build、physics18/18及net176均通过。
- 证据：本提交（git log -- docs/productization/reports/FND-02.md 可定位）；docs/productization/reports/FND-02.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FND-03

- 状态：完成
- 开始：2026-11-17 12:16 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 57e3b8966c92607f068ee40707fa7b120dd0896b
- 范围：扫描全部运行时及源素材，形成可重复生成的来源、哈希、许可证与发布范围盘点。
- 实现：生成985项来源/哈希/发行范围盘点，记录public与私有描述冲突及许可证缺口。
- 验证：全量扫描和确定性复查通过；新增未登记文件反例被拒绝，移除后通过。
- 证据：本提交（git log -- docs/productization/reports/FND-03.md 可定位）；docs/productization/reports/FND-03.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FND-04

- 状态：完成
- 开始：2026-11-17 12:18 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / db5a3662c7e98ac1a1fdcb0e1f0a0d70627a8fcf
- 范围：实现分环境配置校验、生产弱密钥与开发绕过防护、启动接入和脱敏错误。
- 实现：实现分环境schema、脱敏错误及服务端启动校验；测试库独立选择，生产禁止开发绕过。
- 验证：5项配置行为测试、typecheck、server构建通过；真实生产错误启动拒绝且脱敏，本地health200。
- 证据：本提交（git log -- docs/productization/reports/FND-04.md 可定位）；docs/productization/reports/FND-04.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FND-05

- 状态：完成
- 开始：2026-11-17 12:23 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / aa7c348911590d6e73f9493c82a75bacb1bcfc22
- 范围：接入真实lint、格式检查、Vitest单元测试与check聚合，验证错误会使检查失败。
- 实现：真实ESLint/Prettier/Vitest与check聚合，明确增量格式范围和精确旧工具例外。
- 验证：check全通过，5项配置单测通过；类型/格式/lint/未知依赖四类反例均非零。
- 证据：本提交（git log -- docs/productization/reports/FND-05.md 可定位）；docs/productization/reports/FND-05.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FND-06

- 状态：完成
- 开始：2026-11-17 12:29 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 502d5f34e17a47db926177f6a8ce09cf32578a32
- 范围：建立平台、认证、公平模式、持久化、客户端、几何、运营及依赖版本ADR，区分工程默认与外部待定。
- 实现：建立8份ADR和默认实施路线，记录真实凭证/设备/权利等外部边界。
- 验证：ADR编号、链接和架构/任务交叉复核通过；不以默认设计冒充真实平台验收。
- 证据：本提交（git log -- docs/productization/reports/FND-06.md 可定位）；docs/productization/reports/FND-06.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### ARC-01

- 状态：完成
- 开始：2026-11-17 12:29 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / d09dc938bfaee29a4d5eabd7c5b238970f853f7e
- 范围：提取纯TypeScript游戏核心到workspace，旧shared路径重导出；增加依赖方向检查并回归原命令。
- 实现：建立私有game-core workspace，迁移实际RNG实现并保留shared重导出；AST检查可移植边界。
- 验证：workspace链接、check/6项unit、build、physics18/18和net176通过；node:fs边界反例被拒绝。
- 证据：本提交（git log -- docs/productization/reports/ARC-01.md 可定位）；docs/productization/reports/ARC-01.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### ARC-02

- 状态：完成
- 开始：2026-11-17 12:33 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 702c774b98ff06fb44e7a4d730af63b6c572346d
- 范围：提取共享消息校验，新增严格HTTP DTO、稳定错误码/版本和可校验接口文档，保留v1网络行为。
- 实现：共享v1消息校验和严格HTTP DTO/错误/版本，自动生成OpenAPI并保持旧入口兼容。
- 验证：4项契约、check、OpenAPI一致性、server构建和176项原联机回归通过。
- 证据：本提交（git log -- docs/productization/reports/ARC-02.md 可定位）；docs/productization/reports/ARC-02.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### ARC-03

- 状态：完成
- 开始：2026-11-17 12:38 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 10c2a442844fba210d347309d848cf6fc089504d
- 范围：实现平台接口、Web存储/网络/生命周期/viewport适配及可取消宿主桥，接入实际比赛暂停和释放。
- 实现：新增Web平台存储/网络/viewport/生命周期和异步宿主桥，实际GameView接入暂停恢复及完整释放。
- 验证：check含11项unit/4项契约通过；真实HTTP/WS文本二进制、build和Chromium9项（0skip/0error）通过。
- 证据：本提交（git log -- docs/productization/reports/ARC-03.md 可定位）；docs/productization/reports/ARC-03.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### ARC-04

- 状态：完成
- 开始：2026-11-17 12:50 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / ae8d2d4ce6882f1ed68cc6f54dcb0ab7a1710b90
- 范围：接入真实PostgreSQL17、参数化SQL与跨repository事务、受控并发迁移和隔离数据库集成测试。
- 实现：真实PostgreSQL17与pg事务/repository、advisory并发迁移和隔离集成runner，生产禁止隐式down。
- 验证：check通过；真实PG17的并发迁移、跨repo回滚、SQL参数/精度、DDL失败回滚和down/up共5项通过。
- 证据：本提交（git log -- docs/productization/reports/ARC-04.md 可定位）；docs/productization/reports/ARC-04.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### ARC-05

- 状态：完成
- 开始：2026-11-17 13:00 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 5d4b947e67be719eeb116653041d1735733bdeed
- 范围：实现版本化配置/资源manifest、内容hash验证和不可变快照，新旧版本共存与明确兼容策略。
- 实现：实现领域schema注入的版本/hash注册表、资源manifest及全GameData清单，实际房间绑定不可变版本。
- 验证：15项unit/4契约、build、physics18/net176、Chromium9通过；hash篡改和同版本替换/源码启动反例被拒绝。
- 证据：本提交（git log -- docs/productization/reports/ARC-05.md 可定位）；docs/productization/reports/ARC-05.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### ARC-06

- 状态：完成
- 开始：2026-11-17 13:17 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / bc06086589b3b68b671ec15a659b24e109caa800
- 范围：整理服务装配、注入模块边界、HTTP错误与requestId、API404和健康/就绪及优雅关闭。
- 实现：拆出实际游客/配置目录/对战服务与组合根，注入仓储时钟和结果端口，补API错误及完整关闭。
- 验证：check含17unit/4契约、server构建和net176通过；关闭等待调整后2项真实HTTP/启动清理测试再通过。
- 证据：本提交（git log -- docs/productization/reports/ARC-06.md 可定位）；docs/productization/reports/ARC-06.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FLD-01

- 状态：完成
- 开始：2026-11-17 13:27 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 0a25539eec144f8a279e4838efb5e459b8fccd7b
- 范围：校验唯一球场几何，提取边界生成和严格schema，保留原尺寸及皮肤共享约束。
- 实现：提取唯一纯几何入口及严格数据schema，补来源字典并拒绝皮肤私有碰撞尺寸。
- 验证：check含19unit/4契约、physics18/18及完整build通过，原配置hash未变。
- 证据：本提交（git log -- docs/productization/reports/FLD-01.md 可定位）；docs/productization/reports/FLD-01.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FLD-02

- 状态：完成
- 开始：2026-11-17 13:29 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / b315b53f07eddb14e7e8b31b261eccc91c2e56f7
- 范围：统一相机、内容布局、DPR与拖拽数学，接入渲染/输入/HUD并验证双视角。
- 实现：相机/布局/DPR和拖拽数学统一并实际接入渲染、HUD与输入，保留原手感常数。
- 验证：48种布局4800点误差与意图一致；check21unit/4契约、build、Chromium10项0skip/0error通过。
- 证据：本提交（git log -- docs/productization/reports/FLD-02.md 可定位）；docs/productization/reports/FLD-02.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FLD-03

- 状态：完成
- 开始：2026-11-17 13:37 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 7525887f50e2ecaf412f76c14e7070be539c11d6
- 范围：核实唯一碰撞体与合法球门整体越线，补门线/柱/斜墙/高速/多接触回归。
- 实现：统一墙柱网与渲染轮廓，修复既定整体越线判定缺少合法门口/新越线检查的缺口。
- 验证：field7/7、check24unit/4契约、physics18/net176、server构建通过，数据参数未改。
- 证据：本提交（git log -- docs/productization/reports/FLD-03.md 可定位）；docs/productization/reports/FLD-03.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FLD-04

- 状态：完成
- 开始：2026-11-17 13:39 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 33723aa337edfd9864a78bf971305396c738129d
- 范围：验证四角弹簧、低速/足球/固定体组合与门后合法移位，补事件去重与无重叠约束。
- 实现：补弹簧单步去重、合法移位与确定搜索失败路径，完善特殊事件契约和组合验证。
- 验证：field11/11、check28unit/4契约、physics18/net176、server构建通过，原参数保持。
- 证据：本提交（git log -- docs/productization/reports/FLD-04.md 可定位）；docs/productization/reports/FLD-04.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### AST-01

- 状态：完成
- 开始：2026-11-17 13:43 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / afa2b2204b522d5f19997a9f346a1b3e66f55726
- 范围：作为FLD-05前置统一资源ID/哈希/尺寸/锚点/来源/授权/优先级，建立真实引用及构建校验。
- 实现：统一322条资源与145条语义绑定，校验尺寸锚点来源授权优先级并在构建前验证真实引用。
- 验证：check30unit/4契约及build通过；真实缺图/重复ID构建均失败后恢复；Pillow独立复核319张尺寸。
- 证据：本提交（git log -- docs/productization/reports/AST-01.md 可定位）；docs/productization/reports/AST-01.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FLD-05

- 状态：完成
- 开始：2026-11-17 13:48 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / a920673bd97d850b5b22577ba1d363638609afb2
- 范围：统一crop/rotate/source-world变换与比赛/大厅用途，制作所有皮肤双视角数值及几何叠加证据。
- 实现：统一裁切旋转标定与整场/HUD映射，修复4.52mm显示偏差，区分大厅等距图并生成实际叠加证据。
- 验证：field13/13、check32unit/4契约、build、Chromium10通过；18格双视角叠加已查看、最大变换误差2.22e-16m。
- 证据：本提交（git log -- docs/productization/reports/FLD-05.md 可定位）；docs/productization/reports/FLD-05.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FLD-06

- 状态：完成
- 开始：2026-11-17 13:53 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / a228cf4f9ad5422cce6ea91c2e0a103d5dc49f26
- 范围：拆静态/棋子/轨迹/表现层，画质仅影响表现，提取只读回放并验证缓存释放与暂停恢复。
- 实现：拆渲染层与画质菜单，接入只读回放和后台跳终态，缓存与生命周期释放有界。
- 验证：check34unit/4契约、build及最终Chromium12项通过；15次DPR3资源循环释放为0，heap差419272字节已记录。
- 证据：本提交（git log -- docs/productization/reports/FLD-06.md 可定位）；docs/productization/reports/FLD-06.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### FLD-07

- 状态：完成
- 开始：2026-11-17 14:00 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 348baeeba92f4cfe1f43e1b7526ee4914be2ff70
- 范围：完善开发几何/法线/锚点/相机工具，补规范视口矩阵与拖拽场景，验证生产关闭调试入口。
- 实现：完成开发几何/法线/锚点/相机与拖拽工具，144项视口矩阵和生产调试隔离验收。
- 验证：check34unit/4契约、field15、physics18、build、Chromium13通过；8截图逐一查看，144项最大误差1.8763e-14。
- 证据：本提交（git log -- docs/productization/reports/FLD-07.md 可定位）；docs/productization/reports/FLD-07.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### BAL-01

- 状态：完成
- 开始：2026-11-17 14:06 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 76cc9f8e47128f2a48d19bd0ddd4ac4cfe61e8d0
- 范围：核实117球员/106原表/11重建数据，建立完整数值schema、引用与来源校验及损坏输入反例。
- 实现：完整数值schema与跨表/概率/时序校验接入实际加载，逐值核对2250源记录和117球员来源并澄清旧说明。
- 验证：check36unit/4契约、physics18/net176、build及Chromium13通过；源码数值和hash未改。
- 证据：本提交（git log -- docs/productization/reports/BAL-01.md 可定位）；docs/productization/reports/BAL-01.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### BAL-02

- 状态：完成
- 开始：2026-11-17 14:18 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 30776ded3c7091421417583f3fa1d1801614ec8b
- 范围：提取纯等级/属性/状态/倍率/出手公式，保存旧实现全表对照并输出1170行版本化映射快照。
- 实现：集中纯等级/状态/物理映射并冻结1170行快照，隔离可变副本，保留旧入口与现有手感。
- 验证：2340组对照逐值相等；check38unit/4契约、physics18/net176、build通过，同版本替换反例被拒绝。
- 证据：本提交（git log -- docs/productization/reports/BAL-02.md 可定位）；docs/productization/reports/BAL-02.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### BAL-03

- 状态：完成
- 开始：2026-11-17 14:31 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 716c043ca9c5b96af33d2b76a146808ba6030bbd
- 范围：规范13个已实现技能的触发/持续/叠加/额外行动，补结束态防重触发及真实重连不重抽验证。
- 实现：集中技能策略和时序契约，补终局保护/权威输入验证、组合及真实重连不重抽验证。
- 验证：check46unit/4契约、技能8项、physics18/net176、build通过；seed42一万次2022触发可复现并给出置信区间。
- 证据：本提交（git log -- docs/productization/reports/BAL-03.md 可定位）；docs/productization/reports/BAL-03.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### BAL-04

- 状态：完成
- 开始：2026-11-17 14:41 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 5179e6bf14af0c0366c8174e7ded2b83019d9065
- 范围：以正式ShotRunner核实校准，测AI耗时分位并接入可取消、超预算降级和不阻塞交互的真实路径。
- 实现：校准目标保留并接入真实可取消AI预算/Worker截止/回退，旧输出一致且阻止过期作业污染状态。
- 验证：check54unit/4契约、physics18/net176、build/Chromium13通过；10校准目标通过；27旧输出一致，真实Worker截止1501ms仍响应。
- 证据：本提交（git log -- docs/productization/reports/BAL-04.md 可定位）；docs/productization/reports/BAL-04.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### BAL-05

- 状态：完成
- 开始：2026-11-17 15:21 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 2a8d71047943242d7b9d09efed87c1195fcab9da
- 范围：设计非付费初始卡组/升级/奖励/重复转碎片配置与纯规则，验证幂等边界并模拟7/30天成长经济。
- 实现：实现非付费经济配置/BigInt纯规则/资格上限/重复转碎片/合成和跨日进度，冻结报价hash并输出7/30天模拟。
- 验证：最终check61unit/4contract、test:balance18项、build通过；4个同版本篡改反例被拒绝；模拟守恒与非负余额通过。
- 证据：本提交（git log -- docs/productization/reports/BAL-05.md 可定位）；docs/productization/reports/BAL-05.md
- 风险与剩余：本任务验收完成；远端同步权限与后续产品任务按各自记录处理。
- 回滚：独立任务提交可回退；不覆盖其它任务。
- 下一项：按任务依赖选择。

### UI-02

- 状态：完成
- 开始：2026-11-17 23:58 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 632693c1a1b90178d6821be832dd0de32fe49b9b
- 范围：增量建立 React 19 + React Router 7 Web 页面壳、路由状态机与 Canvas 对战宿主，保留既有 DOM 入口直到新路径闭环。
- 实现：引入 React 19 + React Router 7 页面壳和响应式安全区布局；client-model 管理可取消的视图请求与内部路径；练习赛经 HostBridge 挂载既有 Canvas GameView，退出时释放订阅、音频、宿主和本地 Host。账号、资产及在线比赛保持后续任务接入，未伪造远端数据。
- 验证：完整 `npm run check` 通过（100 单元、5 契约）；完整 build 通过；navigation 与 web-shell 单元 7 项通过；web-shell Chromium 覆盖 1280/390/320、禁止入口和连续两次进入/退出，0 console error，并注入一次 Canvas 挂载失败后确认可重试；既有 Chromium E2E 16/16 通过，包含出手、触屏弧线、前后台、画质、资源预算、双端好友赛与宿主释放。
- 证据：本提交；docs/productization/reports/UI-02.md；docs/productization/reports/UI-02-browser.json。
- 风险与剩余：账号、资产、正式匹配和结算 API 由后续 ACC/DAT/NET/UI 任务接入；本任务不伪造远端业务数据。React Router 已升至 7.18.5 并消除本次新增依赖的审计高危项；审计余下 Express/Colyseus 传递高危项需要跨主版本迁移，留待独立架构任务处理。
- 回滚：独立任务提交可回退；保留旧入口以便恢复。
- 下一项：选择依赖已满足的未完成任务；UI-03 待 ACC-04、DAT-02。

### ACC-01

- 状态：完成
- 开始：2026-11-18 00:40 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 738bf39
- 恢复：2026-11-18，Codex / 62649f7；补齐本地隔离 PostgreSQL 17 runner 与真实 migration/账户验收，现有仓储与 schema 先复核再验证。
- 范围：建立长期用户、身份、密码凭据、验证令牌和会话的 PostgreSQL schema、数据字典与账户仓储；不提前实现注册登录 API 或密码派生。
- 实现：新增 users/auth_identities/password_credentials/verification_tokens/sessions migration、账户仓储和数据字典；身份全局唯一按 provider/appId/subject，账户状态有单向删除终态，所有 credential/token/session hash 均不作为仓储输出返回。
- 验证：首次因缺少 Docker 未能运行；2026-11-18 恢复后采用官方 EDB PostgreSQL 17.12 原生工具，在本地一次性集群实际运行 integration：2 文件 / 14 项通过，其中账户 8 项、持久化 6 项，包含真实 FK/唯一约束、并发身份绑定、appId 隔离、token 并发消费、事务失败及 migration down/up。补充原生 runner 失败退出/清理反例；无测试文件时退出 1，结束后 PostgreSQL 进程与临时集群目录均为 0。
- 证据：schema/仓储提交 07186dd；本提交中的 tests/accounts.integration.test.ts、tools/run-pg-tests.mjs、docs/engineering/database.md；docs/productization/reports/ACC-01.md。
- 风险与剩余：ACC-01 已满足验收；ACC-02 才引入 Argon2id、邮件和令牌流程。原生二进制仅在本地工具链目录，未注册服务或占用远端服务器；CI integration 已接入，远端执行结果待同步后确认。
- 回滚：独立 migration 和提交可回退；migration down 只允许本地/测试显式执行。
- 下一项：ACC-02（待 ACC-01）。

### WEB-01

- 状态：完成
- 开始：2026-11-18 00:52 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 07186dd
- 范围：完善 React Web 大厅的桌面三栏与移动布局，覆盖安全区、dvh、大字体、软键盘可见区域和 320–1920px 主操作不裁切；不接入尚未实现的账号、资产或远端数据。
- 实现：桌面大厅采用左侧主导航、中央本地练习球场和右侧辅助面板；移动端保留顶部状态与底部主导航。以 visualViewport 高度驱动应用壳，安全区内边距、dvh 回退、大字体缩放和可滚动内容区均不改变 Canvas 比赛几何。云端内容明确标注为待接入，未伪造账号、资产、公告或阵容数据。
- 验证：`npm run test:web-layout` 通过；Chromium 覆盖 320x568、360x800、390x844、430x932、768x1024、1280x720、1440x900、1920x1080，均无横向溢出、球场预览/主操作/导航可见，桌面辅助面板仅在 >=1024px 显示；1.4 倍大字体和 420px 软键盘可见视口均通过。`npm run test:web-shell` 通过；完整 `npm run check` 通过（100 单元、5 契约）；完整 `npm run build` 通过；`npm run test:e2e` 16/16 通过。
- 证据：本提交；docs/productization/reports/WEB-01.md；docs/productization/reports/web-01/browser.json 与同目录规范视口截图。
- 风险与剩余：本任务验收完成。WEB-02 负责比赛输入与双方视角；WEB-03 再做多引擎可访问性兼容。真实账号/公告/阵容摘要依赖 ACC/DAT/UI 后续任务。
- 回滚：独立任务提交可回退；保留 UI-02 Canvas 桥接和旧入口兼容路径。
- 下一项：选择依赖已满足的未完成任务；WEB-02 仍待 FLD-02。

### WEB-02

- 状态：完成
- 开始：2026-11-18 01:14 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 733db3f
- 范围：在既有 FLD-02 相机/手势数学与 Canvas 宿主上补齐鼠标、触摸、键盘输入边界和 side 1 视角验收；不改变物理、球场几何或线上权威规则。
- 实现：GameView 只接收首个主指针；输入框/选择框/文本域/可编辑节点获得焦点时不截获 Esc 或方向键。Esc、pointercancel、pointerleave、lostpointercapture、窗口失焦和 viewport 变动均取消瞄准并释放捕获；释放已丢失的捕获安全忽略。补充 Chromium 场景，实际鼠标、CDP touch、文本焦点、多指、失捕获、离场、缩放和双方联机视角均由真实 Canvas/服务端通路验收。
- 验证：`npm run format` 通过；`npm run test:e2e` 18 PASS / 0 SKIP / 0 FAIL（桌面 DPR 1 side 0 鼠标、移动 390x844 DPR 3 side 1 CDP touch）；`npm run check`、`npm run build` 与 `node tools/check-plan.mjs` 在本提交前通过。
- 证据：本提交；`docs/productization/reports/WEB-02.md`；`tools/e2e-browser.mjs`。FLD-02 已验证 4 视口 × 2 视角 × 3 DPR × 2 布局的 48 组统一坐标/手势矩阵，本任务未改动该数学。
- 风险与剩余：本任务验收完成。WEB-03 承担 Firefox/Safari/辅助技术矩阵；真机与 App/WebView 验收不以本任务 Chromium 自动化替代。
- 回滚：独立任务提交可回退；保持 FLD-02 相机与输入数学接口兼容。
- 下一项：WEB-03（待 WEB-02、UI-07）。

### WEB-04

- 状态：完成
- 开始：2026-11-18 01:45 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / bcc5f5e
- 范围：在 AST-05 的可校验有界资源缓存和 FLD-02/WEB-02 的 Canvas 实现上，补齐首屏/比赛运行性能观测与必要的无玩法变更优化；不改变球场几何、瞄准、物理或线上权威规则。
- 实现：练习赛 React 路由改为 Suspense 动态导入，比赛视图成为独立 chunk；大厅初始加载不请求比赛 chunk 或 `assets/fields` 场地资源。新增性能 Chromium runner，记录弱网首屏、帧时间和热身后连续 10 局的 JS 堆增量；既有质量档继续限制 Canvas DPR（1/1.5/2.5）且 Renderer 静态场地缓存不变。资源浏览器回归固定使用遗留比赛入口，使真实缓存损坏、离线、取消、低清纹理与断图出手验证不再因页面壳路由漂移而失效。
- 验证：`npm run test:web-performance` 通过：390x844 DPR 3、150ms 延迟、200KiB/s 下载下首屏 3933ms，初始资源 592583B，比赛 chunk/场地资源均未预取，帧 p50/p95 16.7ms，10 局热身后堆增长 884920B。`npm run test:assets-browser` 与 `npm run test:web-shell` 通过；`npm run check`、`npm run build`、`npm run test:e2e` 与 `node tools/check-plan.mjs` 在本提交前通过。
- 证据：本提交；`docs/productization/reports/WEB-04.md`；`docs/productization/reports/web-04/browser.json`；`tools/web-performance-browser.mjs`。AST-05 的资源 hash、失败回退、持久缓存/内存上限与低清资源矩阵继续生效。
- 风险与剩余：本任务验收完成。数据为本机 Chromium 头显仿真，非物理移动设备、Safari 或微信小游戏性能结论；这些平台矩阵由 WEB-03、AST-06、WX/APP 后续任务处理。
- 回滚：独立任务提交可回退；保留 AST-05 资源 hash/失败回退协议和既有性能质量档。
- 下一项：选择依赖已满足的未完成任务；WEB-03 仍待 UI-07。

### QA-01

- 状态：完成
- 开始：2026-11-18 02:18 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / c3c2fc5
- 补验：2026-11-18 / 121495e；同步第 40 项前发现 test:qa 依赖已有测试客户端构建产物，补齐显式 build:test-client 步骤。移开旧目录、确认不存在后实跑 `npm run test:qa`：两轮单元/契约、4 次并行 E2E 及故意失败清理检查全部通过。
- 范围：稳定本地基础测试的端口、临时存储、构建产物与进程清理；补充可重复 runner 和不依赖生产数据的基础 CI。不覆盖真实 PostgreSQL、真实设备或后续业务集成验收。
- 实现：测试环境唯一允许 `PORT=0` 交由系统分配；E2E 从服务端 `server_started` 事件读取实际端口，静态服务也默认使用临时端口。E2E 截图和模式诊断改写入忽略的 `work/e2e-artifacts`（可由 `E2E_ARTIFACT_DIR` 覆盖），并等待子服务退出后再清除临时房间存储。新增 `test:qa`：构建后连续两轮单元/契约、每轮两个并行 E2E，另保留端口验证失败非零及清理。GitHub Actions 基础作业固定 Node 24.22.1、Chromium、静态检查和同一 runner。
- 验证：先补 `APP_ENV=test, PORT=0` 配置用例（6/6 通过）。`npm run typecheck`、`npm run lint`、`npm run build` 通过。`npm run test:qa` 通过：两轮单元与契约、每轮两个并行 E2E 均通过；占用 Web 端口的 E2E 按预期非零退出，runner 断言未留下 `allstars-e2e-*` 临时房间目录。E2E 独立单跑为 18 PASS / 0 SKIP / 0 FAIL。
- 证据：本提交；`tools/qa-runner.mjs`；`.github/workflows/ci.yml`；`docs/productization/reports/QA-01.md`。CI 工作流未在本地伪称已运行，等待远端 GitHub 触发。
- 风险与剩余：真实 PostgreSQL integration 仍因本机没有 Docker 而属于 ACC-01/QA-02 的外部阻塞；真机/跨引擎矩阵留给 QA-03、AST-06、APP/WX 任务。构建仍含第三方 React Router/Zod 的既有 Rollup 注释提示，无新增构建错误。
- 回滚：独立任务提交可回退；常规运行端口下限和生产配置约束不变，端口 0 只在 test 模式有效。
- 下一项：QA-03（依赖满足）；APP-01、ACC-01、AST-06 分别仍受原生工具链、PostgreSQL、真机条件限制。

### QA-03

- 状态：完成
- 开始：2026-11-18 02:40 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 9d1dc2b
- 范围：定义当前 Web 的支持/验收矩阵并实际运行 Chromium、Firefox、WebKit 代表路径；提供 iOS/Android/微信后续真机记录模板。真实设备、原生壳和微信环境均不在本轮冒充完成。
- 实现：新增兼容策略、物理设备记录模板和 `test:compatibility`。该 runner 使用构建后的静态 Web 客户端，在 Chromium、Firefox、WebKit 的桌面 1280×720 DPR 1 与移动 390×844 DPR 3 真实引擎中走“大厅→练习赛→退出”；捕获 page error 与页面 console error/warning。Firefox 的 `chrome://juggler` 自动化内部 warning 单独保留在报告，不与应用页面错误混同。默认结果写入忽略的 `work/compatibility`，显式环境变量才写入验收快照。
- 验证：PowerShell 下 `$env:COMPATIBILITY_REPORT='docs/productization/reports/QA-03/browser.json'; npm run test:compatibility` 通过，Chromium 159.0.8154.6、Firefox 159.0、WebKit 27.2 共 6/6 代表用例通过；所有页面 error 列表为空。既有 WEB-01 的 8 视口/大字体/软键盘证据、WEB-02 的鼠标/真实 CDP touch/键盘输入边界和 WEB-04 的弱网/资源恢复证据已纳入策略，未重新标记为物理设备。
- 证据：本提交；`docs/productization/COMPATIBILITY.md`；`docs/productization/reports/QA-03.md`；`docs/productization/reports/QA-03/browser.json`；`docs/productization/reports/QA-03-device-template.md`；`tools/compatibility-browser.mjs`。
- 风险与剩余：Playwright WebKit 不是 iPhone Safari 真机。iPhone 15 Pro、Android Chrome/WebView、微信双系统和 App 仍为未测；解除条件和记录字段已写入模板，对应 WX-06/APP-05/AST-06 不得使用此报告代替真机结果。
- 回滚：独立任务提交可回退；不改变游戏、资源、网络协议或生产支持范围。
- 下一项：选择依赖满足的未完成任务；APP-01 仍需原生构建工具链，ACC-01 仍需真实 PostgreSQL，AST-06 仍需真机资源验收。

### DAT-01

- 状态：完成
- 开始：2026-11-18 02:53 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 15b9c44
- 范围：建立云存档与资产/比赛/outbox 的 PostgreSQL schema、参数化 repository 和数据字典；真实验证持有权约束、余额/精度、索引及迁移。初始化奖励与升级/结算业务留给依赖本结构的后续任务。
- 实现：新增 10 张业务表，静态定义/持有卡/用户/本场 piece 标识分离；组合 FK 保证阵容卡归属、BAL-05 单定义单卡、非负钱包与金额 int64、账本业务域唯一键、比赛版本/参与者快照、outbox 待处理部分索引。UserDataRepository/MatchDataRepository 注入同一 SqlExecutor，金额显式字符串输出，分页限制 1–100。
- 验证：隔离 PostgreSQL 17.12 集成 3 文件 / 22 项通过，新增 8 项覆盖数据库约束、跨用户阵容、金额精度/JSON、账本唯一、跨仓储事务回滚、比赛快照及 outbox due/EXPLAIN；最新迁移 down/up 通过。全套 `npm run check`（101 单元、5 契约）、`npm run build` 和规划检查通过。
- 证据：本提交；packages/persistence/migrations/202611180002_user_data.mjs；packages/persistence/src/user-data.ts；tests/user-data.integration.test.ts；docs/engineering/user-data.md；docs/productization/reports/DAT-01.md。
- 风险与剩余：业务表及仓储验收完成；DAT-02 负责幂等初始化/云存档读取，DAT-03 校验整套阵容，DAT-04 提供真实报价/锁/幂等资产操作，NET-04 接入可靠结算，均未在本任务中冒称完成。
- 回滚：本地测试显式 migration down 按逆序删除本次业务表；生产使用前向兼容迁移，不回滚真实资产数据。
- 下一项：DAT-02 与 ACC-02，依赖均满足。

### ACC-02

- 状态：完成
- 开始：2026-11-18 03:10 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 0324161
- 范围：Argon2id 密码、注册/验证/找回/密码校验 API、真实 SMTP adapter、本地 Mailpit 收信与 PostgreSQL 事务验收，包含防枚举/持久化限流/失败回滚。安全 Cookie 与刷新旋转由 ACC-03 接入。
- 实现：Argon2id v19/64MiB/t3/p1、四个并行 KDF 上限；邮箱验证/找回/重发与一次性 token hash；锁账户原子消费、密码重置撤销会话；持久化 IP/邮箱限流和一致的不存在账号响应。加密数据库邮件队列同注册事务提交，worker 在真实 SMTP 投递后清除密文，有界退避/重启恢复；运行时接入路由及 worker 启停。staging/production 禁止 Mailpit/开发绕过，SMTP 要求 TLS 与明确发件地址。
- 验证：真实 PostgreSQL 17.12 + Mailpit 1.34.0，4 文件 / 33 集成项通过（邮箱 HTTP/SMTP/运行时 11 项），无跳过。全套 check 通过（104 单元、5 契约），生产客户端构建通过；最初生产 E2E 发现工作区 import 打包错误，改为现有 server 相对源码导入后重建服务端并真实 E2E 18/18 通过。五次本机 KDF 78/78/82/85/72ms；官方 npm audit 中新增依赖无条目，已有树仍 15 high/14 moderate/2 low/0 critical，保留发行门槛。
- 证据：本提交；tests/email-auth.integration.test.ts；tests/passwords.test.ts；docs/engineering/email-accounts.md；docs/productization/reports/ACC-02.md；契约文档与 CI 固定 Mailpit 下载校验。
- 风险与剩余：本地 SMTP 真实投递已验收；外部邮件供应商的凭证/域名/到达率未在此冒称通过。登录当前验证凭据并返回可信 userId，ACC-03 接入签名会话/Cookie，ACC-07 接入邮件链接页面。密钥轮换前排空邮件队列或对未送达项重新签发；已有依赖审计项和平衡/素材发布门槛仍未解除。
- 回滚：新增 migration 仅本地/测试显式 down；生产前向兼容。邮箱流程默认 disabled，可停入口并保留待处理记录；不擅自删除凭据或修改生产权限。
- 下一项：ACC-03（依赖满足）。

### ACC-03

- 状态：完成
- 开始：2026-11-18 03:31 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 00bd571
- 范围：签名访问凭证、数据库即时撤销校验、安全 Cookie/CSRF/CORS、持久化刷新旋转及并发宽限；登录与会话签发同事务，复用 ACC-02 邮箱入口。当前用户/设备管理 API 留给 ACC-04。
- 计划与验收：新增会话迁移、仓储、签名及 HTTP 中间件；真实 PostgreSQL 验证错误签名/claims、撤销、并发刷新幂等、宽限外重放与重置竞争；核对浏览器 Cookie 行为、契约和构建。默认关闭邮件的旧本地 Demo 继续可启动。
- 实现：jose HS256/typ/issuer/audience/必需 claims 及 15 分钟寿命校验；访问鉴权每次查账户、数据库会话到期和撤销。Secure/HttpOnly/Host Cookie、签名并绑定会话的 CSRF、精确 CORS 预检；数据库实际时钟计算 30 天绝对会话。刷新 hash/history/family 原子旋转，10 秒并发幂等，宽限外重放先提交撤销再拒绝。邮箱登录强制同事务签发会话；旧无绑定会话由迁移显式撤销。
- 验证：真实 PostgreSQL 17.12 + Mailpit 1.34.0，5 文件 / 46 集成项通过、0 跳过，含 Chromium HttpOnly/双标签四次并发刷新；完整 check 为 105 单元/5 契约及静态检查通过。生产构建和游戏 E2E 18/18 通过；最后 SQL 撤销时间修正后再次 check 与 build:server 通过。先以失败回归复现再修正：等待用户锁后旧密码快照、撤销事务起始时间早于新会话 createdAt；30 天毫秒边界也由数据库单次时钟消除。官方 audit 新增 jose 无条目，原树仍 31 项审计记录。
- 证据：本提交；tests/access-tokens.test.ts、tests/sessions.integration.test.ts、tests/email-auth.integration.test.ts；docs/engineering/sessions.md；docs/productization/reports/ACC-03.md；生成契约文档。
- 风险与剩余：ACC-04 当前用户/设备管理、ACC-07 页面与 NET 房间鉴权未在此冒称完成；真机继续暂缓，已有发行门槛仍保留。测试遇到 Windows 临时文件锁，runner 增加有界清理重试，之后成功/预期失败运行均停止数据库并清理；旧 allstars-pg-test-9LdS5w 的手动删除被自动审批拒绝，目录暂留、进程已停止。本轮未使用远端服务器资源。
- 回滚：独立提交可回退，数据库只在隔离测试显式 down；不删除真实会话记录。
- 下一项：ACC-04（依赖满足）；第 50 项完成时按用户要求同步 GitHub。

### ACC-04

- 状态：完成
- 开始：2026-11-18 03:55 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 18c42ed
- 范围：可信当前用户、本人会话游标列表/撤销、当前及全部退出、Web 调用适配器与登录状态 client-model。档案未初始化时如实返回 null，DAT-02 负责初始化；房间实际票据仍由 NET-01 实现并复用会话即时校验。
- 计划与验收：固定请求/响应 schema；用户→会话锁序、退出持久幂等及安全 Cookie 清除；真实 PostgreSQL/HTTP/浏览器验证跨用户隔离、退出/全部撤销/响应丢失重试、刷新竞争与客户端迟到响应。无权限依赖、凭证或真机阻塞时不假勾选。
- 实现：/me 与真实可空档案、本人活跃会话微秒游标分页/粗粒度设备信息、撤销及当前/全部退出；业务事务重新锁定校验可信会话，回执与撤销原子提交。全局退出幂等键 + 原会话 CSRF 绑定可确认清 Cookie 后的丢失响应，新登录不被旧重试撤销或清 Cookie。新增平台实际网络 adapter 与可移植 LoginStateModel，原请求最多重试一次、合并刷新含失败结果、退出意图/迟到响应隔离。
- 验证：真实 PostgreSQL 17.12 + Mailpit 1.34.0，5 文件 / 54 集成项通过、0 跳过；会话 20 项与真实 SMTP 邮箱 12 项，含 Chromium 实际 adapter 四请求一次刷新、跨标签退出后恢复为匿名；包含跨用户越权、微秒分页、零年游标、全部撤销/响应体丢失/已清 Cookie/之后新登录、事务失败回滚、刷新竞争。完整 check 为 112 单元/6 契约及静态校验通过；生产构建与游戏 E2E 18/18 通过。
- 证据：本提交；tests/account-state.test.ts、tests/account-client.test.ts、tests/accounts.contract.test.ts、tests/sessions.integration.test.ts、tests/email-auth.integration.test.ts；docs/engineering/account-management.md；docs/productization/reports/ACC-04.md；生成请求/响应契约。
- 风险与剩余：档案初始化归 DAT-02，账号界面/生命周期归 ACC-07；真实房间票据尚属 NET-01/03，必须绑定 sessionId 与即时状态检查，本项不把游客 Demo 房间标为已鉴权。仅补齐已有依赖声明，无新增外部版本；真机、已有发行门槛未解除。测试数据库/Mailpit 均已停止，本轮未使用远端服务器。
- 回滚：任务独立提交可回退；迁移 down 仅隔离本地/测试，不恢复已撤销的会话。
- 下一项：先核实 ACC-05 的真实微信环境；若缺失则保持未勾选，继续已满足依赖的 ACC-06 / DAT-02。第 50 项同步 GitHub。

### ACC-05

- 状态：阻塞
- 开始：2026-11-18 04:30 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / b84103b
- 范围：微信小游戏 code 服务端交换、应用隔离映射、持久化单次 code 防重放、配置/错误脱敏与 Cookie 会话接入。先完成官方契约、mock provider + 真实数据库/HTTP 验证；不将本地契约测试记为真实微信验收。
- 外部条件：进程/用户环境无 WECHAT_ENABLED、WECHAT_APP_ID、WECHAT_APP_SECRET，仓库仅有 .env.example；当前未提供授权测试 app 的新鲜 code。真实交换/过期/重放未验证前保持未勾选，之后继续不依赖微信条件的 ACC-06/DAT 工作。
- 实现：固定官方 HTTPS 交换、5 秒整体超时/8192 字节上限/禁重定向/错误脱敏；AppID/OpenID 唯一身份映射，未核实 UnionID 不合并。持久 HMAC code 占用与 IP 限流，网络结果不明也不能重放，身份/账号/会话/成功标记同事务，唯一竞争只重试本地事务一次。Web Cookie 适配接入真实运行时，默认关闭；原生凭据交付留给 WX 平台 adapter。
- 验证：核对官方 code2Session、wx.login、小游戏登录、UnionID 文档。6 文件 / 65 集成项通过、0 跳过，微信 11 项为 mock 上游 + 真实 PostgreSQL/HTTP；原真实 SMTP/浏览器回归保留。完整 check 为 116 单元/7 契约及静态检查通过；生产构建和原游戏 E2E 18/18 通过。verify:wechat 缺配置时按预期在 configuration 阶段非零退出，不连数据库/上游、不生成成功报告；修改验收工具隔离目录/报告后再次 format/typecheck/lint 与缺配置守卫通过。没有真实微信验收结果。
- 证据：本提交；tests/wechat-provider.test.ts、tests/wechat.integration.test.ts；共享真实 JSON HTTP helper；docs/engineering/wechat-identity.md；docs/productization/reports/ACC-05.md；tools/verify-wechat-login.ts。
- 风险与剩余：未取得已授权测试 app 的 AppID/Secret 及有效/过期 code，整项保持未勾选；不能把 mock 当真实登录。真实验收命令只允许本机 _test 数据库及独立房间目录，成功且清理完成后才写独立不含凭证的报告。已异步询问测试资格，未收到配置。无新增外部依赖，本轮未使用远端服务器；临时数据库/Mailpit 均停止。
- 回滚：默认关闭微信；独立代码提交可回退。迁移 down 仅隔离本地/测试，凭证不写入 Git/日志。
- 下一项：继续 ACC-06；具备私有配置后按验收文档运行 verify:wechat，补充真实有效/过期/重放及会话证据才勾选 ACC-05。

### ACC-06

- 状态：完成
- 开始：2026-11-18 05:06 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 5c84a2b
- 范围：近期会话重新认证、邮件/微信身份绑定与冲突隔离、注销申请/取消/后台去标识、内部封禁/解封、追加审计和保留说明；无普通玩家封禁接口。微信复用已实现的单次 code 服务，真实平台验证仍由未勾选 ACC-05 承担。
- 计划与验收：真实 PostgreSQL/SMTP 验证被盗会话无重新认证不可绑定/注销、邮件证明绑定当前会话、过期与冲突/跨用户拒绝；注销/封禁原子撤销全部会话，保留钱包/账本/比赛约束；工作任务失败回滚及重复运行安全。生产注销默认关闭，启用需显式政策版本/冷静期，REL-02 继续核实渠道规则。
- 实现：会话独占五分钟重新认证；真实邮件 token 与发起用户/session 绑定，微信复用单次 code 服务；冲突不并号。注销排期/立即撤销、凭据查询/取消、到期去标识与追加审计同事务，单任务故障不阻塞同批账户，重启恢复；内部封禁/到期解封，数据库状态触发器保证旧会话永不复活。生产默认关闭并要求显式政策配置，保留边界详见隐私说明。
- 验证：`npm run test:integration` 7 文件/78 项通过，含生命周期 13 项；真实 PostgreSQL 17.12、HTTP、Mailpit 1.34.0 SMTP、审计故障注入/跨实例重试、运行时自动任务。`npm run check` 117 单元/8 契约及静态/生成检查通过；生产 build 通过；浏览器 e2e 18 PASS/0 SKIP/0 FAIL，无 console/pageerror。首轮失败的 DELETE 传输和解封复活问题已复现并修正，最终全量通过。
- 证据：本提交（`git log -- docs/productization/reports/ACC-06.md` 可定位）、[ACC-06 报告](reports/ACC-06.md)、[接口及保留说明](../engineering/account-lifecycle.md)。
- 风险与剩余：ACC-05 真实微信、AST-06 真机仍保持未完成；NET 房间票据与 ADM 权限由后续任务接入；REL-02/OPS 核实生产保留期限/备份处理。已有依赖、素材和平衡发布门槛未解除。未使用远端服务器，无新增临时 PostgreSQL/Mailpit 进程。
- 回滚：独立提交回退；新增迁移 down 仅隔离测试；生产不可回退恢复已经移除的个人资料。
- 下一项：ACC-07，或依赖已满足的 DAT-02；累计 44 项，第 50 项按用户规则同步 GitHub。

### ACC-07

- 状态：完成
- 开始：2026-11-18 05:48 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 27947f4
- 范围：复用 WebAccountClient/LoginStateModel 和现有 React 页面壳，完成邮箱注册/收信/验证/找回/登录、设备会话、近期认证/绑定/注销入口及登录回跳；不伪造大厅资产，不暴露生产微信 code 输入工具。
- 计划与验收：扩展严格请求/响应契约和公共客户端；账号状态驱动导航，写请求单次提交，token fragment 仅内存并立即移除，跨标签失效恢复。真实 PostgreSQL/SMTP/Chromium 验证注册到退出、找回/限流/跨标签、401 无风暴、匿名练习和小屏键盘/溢出；不在 localStorage 存密码或 token。
- 实现：真实 React 账号页面、能力/绑定状态读取及严格公共客户端；邮箱注册/收信/验证/找回、登录守卫与回跳、设备/全部退出、绑定与注销查询/取消。token 启动即移除 fragment、仅留内存；敏感失败不重放密码，跨标签只广播固定事件，旧响应不覆盖新身份，单次提交和组件销毁清理。注销确认后完整加载恢复页，避免匿名守卫竞争。关联只读服务和布局/性能 fixture 是本界面所需，不改玩法/经济。
- 验证：真实 PostgreSQL 17.12/Mailpit 1.34.0/Chromium `npm run test:integration` 8 文件/87 项，含账号页 9 项；`npm run check` 119 单元/8 契约、195 文件格式及静态/生成检查通过；build 通过；web-shell 三档与 web-layout 八档/大字体/键盘通过；web-performance 首屏 3961ms、帧 p95 16.7ms、十局堆增长 896448B，通过；当前构建产物 `node tools/e2e-browser.mjs` 18 PASS/0 SKIP/0 FAIL，0 console/pageerror。
- 证据：本提交（`git log -- docs/productization/reports/ACC-07.md` 可定位）、[ACC-07 报告](reports/ACC-07.md)、[Web 账号说明](../engineering/web-accounts.md)、账号截图及更新布局/性能证据。
- 风险与剩余：真实微信/设备、素材授权、既有依赖和平衡门槛保留；绑定 UI 的无邮箱初始身份为可信测试 fixture，后续 SMTP/KDF/API 均真实，不冒称微信平台通过。纯微信操作由小游戏提供；后续 DAT/UI/NET 才提供真实资产大厅/房间票据。未新增依赖、未使用远端，临时数据库/Mailpit 正常停止。
- 回滚：独立提交回退，保留 ACC-06 服务与数据库迁移。
- 下一项：DAT-02。

### DAT-02

- 状态：完成
- 开始：2026-11-18 06:17 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 441eed4
- 范围：按现有 BAL-05 starter-v1 固定五卡/300 金币/0 碎片初始化资料、钱包和默认阵容；持久一次性回执、账本、同事务失败回滚；本人 profile/cards/wallet 读取及资料乐观版本更新。初始化接入真实注册/登录，旧非空数据无回执不覆盖，交 DAT-06 迁移。
- 计划与验收：并发/重试只授予一次，配置升级不重发；跨设备同一读模型；非法昵称/头像/等级/资产/他人目标拒绝；封禁/注销不重建；真实 PostgreSQL/SMTP 和既有账号页面回归。
- 实现：复用冻结 BAL-05 grantStarter，用户锁与唯一回执保证五卡/钱包/阵容/profile/账本/outbox 同事务一次授予；接真实邮箱注册/登录、微信登录与 /me。新增本人 profile/cards/wallet API、分页和资料乐观版本；旧非空数据无回执 409 保留，封禁/注销不重建。内置默认头像 ID 不接受任意 URL；Web 单字符昵称对齐既有规则；revision 上限匹配 PostgreSQL int32。
- 验证：`npm run test:integration` 9 文件/96 项，含云存档 9 项、真实 SMTP/运行时/跨设备/八并发/末尾故障回滚及完整账号页面；`npm run check` 119 单元/8 契约、198 文件格式及静态/生成检查通过；build 通过；`npm run test:e2e` 18 PASS/0 SKIP/0 FAIL，无 console/pageerror。大版本号回归先复现 500，边界修正后返回 400、全量通过。
- 证据：本提交（`git log -- docs/productization/reports/DAT-02.md` 可定位）、[DAT-02 报告](reports/DAT-02.md)、[接口与初始化](../engineering/player-data.md)。
- 风险与剩余：旧非空账号需 DAT-06 审计迁移；阵容保存/参赛快照、资产升级、真实大厅分别由 DAT-03/04/UI-03 接入。真实微信、真机、素材、平衡和依赖审计门槛保留，未新增外部依赖、未使用远端，临时数据库/Mailpit 正常停止。
- 回滚：独立提交回退；新增 schema down 仅隔离测试，已发放资产不做反向删除。
- 下一项：DAT-03。

### DAT-03

- 状态：完成
- 开始：2026-11-18 06:32 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 1af09ac
- 范围：本人阵容读取/保存、持有卡与版本/重复/位置/模式校验、服务端参赛快照；复用既有模式等级和技能规则，不信任客户端定义/等级。房间票据和实际入局由 NET 后续接入。
- 位置证据：旧 client/src/lineup.ts 的 valid/place 允许跨职业落位，ROLE_POS 只用于 defaultSet/randomLineup 推荐；shared parseSetLineup/createMatch 同样没有职业硬绑定。固定初始 p07/p06/p08 是 GK/DF/DF，与 DC/CM/CM 槽并不相等，因此不新增职业限制。位置校验按既有五槽顺序、边界和唯一占用，具体职业保留展示；初始单元失败暴露了错误假设，已按当前代码修正。
- 必要关联：新增阵容服务时发现四处业务事务重复同一用户/会话 active 校验，抽取 requireActivePrincipal 并让原会话/生命周期/云存档复用，保持用户→会话锁顺序和拒绝语义，防止后续资产操作继续复制后产生偏差。
- 计划与验收：保存使用用户/会话/阵容/卡锁和 revision，失败不半写；同一旧版本只一项成功。真实 PostgreSQL/HTTP 验证合法、越权、重复、未知/不支持卡、模式固定/持有等级、卡变化与快照冻结、失败回滚和封禁即时失效。
- 实现：阵容分页/本人读取/PUT 原子保存与 revision 冲突；卡归属/唯一/active/等级和五槽验证。新增 owned_cards 状态迁移，服务端构建深冻结模式快照，分别保留持有等级和实际参赛等级、版本、槽/职业及实际属性/技能；复用既有 BAL 规则，跨职业落位保持原玩法。提供与 NET 票据同事务组合的内部入口，未开放客户端快照上传。
- 验证：`npm run test:integration` 10 文件/107 项（阵容 11），包括真实 HTTP/数据库、并发、槽插入故障回滚、卡锁等待后取新等级、禁用和未实现技能、快照冻结、实际 createMatch 等级及生产挂载；`npm run check` 122 单元/8 契约、204 文件格式及静态/生成检查通过；build 通过；e2e 18 PASS/0 SKIP/0 FAIL，0 console/pageerror。
- 证据：本提交（`git log -- docs/productization/reports/DAT-03.md` 可定位）、[DAT-03 报告](reports/DAT-03.md)、[位置/模式/API 说明](../engineering/lineups.md)。
- 风险与剩余：NET-01/03 需把快照与票据签发同事务并在消费/重连复核；创建/删除预设和资料页面后续按实际产品范围接入。真实微信、真机、素材、平衡及依赖审计门槛保留；无新外部依赖，未使用远端，临时 PostgreSQL/Mailpit 正常停止。
- 回滚：独立提交回退，保留已保存数据；若需迁移仅隔离测试 down。
- 下一项：DAT-04。

### DAT-04

- 状态：完成
- 开始：2026-11-18 06:51 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / f73c167
- 范围：真实升级/合成报价与事务、内部受信 grant/debit 端口、精确钱包/卡版本/账本/幂等回执/outbox、本人账本分页和有界数据库事务重试；不开放客户端任意加减资产，不改 economy-2 参数。
- 计划与验收：真实 PostgreSQL/HTTP 验证并发、相同意图跨实例/响应丢失重试、同键异载荷冲突、陈旧价格/卡版本、禁用或非本人卡、余额不足/int64 精度/溢出、事务各阶段故障回滚；模拟 SQLSTATE 及实际锁竞争证明重试有界。
- 实现：真实升级/合成报价、持有权和价格/revision 校验；用户/会话/钱包/卡锁，同事务写余额/等级/流水/成功回执/outbox；同键同载荷返回历史结果、异载荷冲突，grant/debit 另按业务来源去重。金额 BigInt/int64 字符串，账本本人游标分页、微秒不漏页、历史禁止改删；内部可信端口可组合外层事务，输入与历史配置先复制冻结。
- 验证：`npm run test:integration` 11 文件/131 项通过（资产 24），包含实际 HTTP/数据库、并发与锁等待、五处写入故障回滚、响应 body 丢失后重试、精度/溢出、真实运行时挂载；注入 SQLSTATE 验证 40P01/40001 最多三次完整事务重试。`npm run check` 122 单元/10 契约、211 文件格式及静态/生成检查通过；build 通过；e2e 18 PASS/0 SKIP/0 FAIL，0 console/pageerror。
- 必要关联：分页 query/cursor 第三处重复提取公共 schema；定义注册排序避免跨用户注册顺序相反；outbox 旧测试将自己 ready 事件前排以适应真实积压，未改生产 50 条上限。首轮同步抛错和分页测试失败修正后全量通过，既有视觉 assets 模块保持原样。
- 证据：本提交（`git log -- docs/productization/reports/DAT-04.md` 可定位）、[DAT-04 报告](reports/DAT-04.md)、[资产端口/API 说明](../engineering/asset-operations.md)。
- 风险与剩余：NET/LIV/ADM 需验证各自来源资格/日上限/RBAC 并组合内部端口；outbox 消费与受控纠正由后续任务完成。真实微信、真机、素材、平衡及依赖审计门槛保留；无新依赖，未使用远端，隔离 PostgreSQL/Mailpit 正常停止。
- 回滚：独立提交回退；新增 schema down 仅隔离测试，不回退已入账资产。
- 下一项：DAT-05 / UI-03。

### DAT-05

- 状态：完成
- 开始：2026-11-18 07:30 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 8e16192
- 范围：检查旧 pz_* 存储，明确预览后将合法球场/静音设置、昵称草稿及本人持有卡阵容偏好一次性保存到账号；损坏项隔离、重复导入幂等、账号切换不串档。保留旧练习数据，不迁移资产/等级/凭据/服务器地址，不自动覆盖云昵称或正式阵容。
- 计划与验收：严格契约、账号域导入回执和事务、真实账号页入口与提示；单元覆盖新旧/损坏/存储失败，真实 PostgreSQL/HTTP 与浏览器验证篡改资产无效、并发/失败重试、重复不重发新手资产、跨账号隔离与注销清除草稿。
- 实现：允许列表解析四个旧偏好键，账号页检查/预览/确认/查询/本机应用；服务端按当前本人持有权过滤阵容，保存 ownedCardId 偏好和昵称草稿；账号一次性事务回执比较载荷 hash，GET/POST 核对预览账号，切换后异步结果丢弃。旧练习读取保留，不修改正式阵容/昵称/等级/货币；到期注销删除含草稿的导入记录。
- 验证：6 项解析边界单元；目标集成 19 项（8 PostgreSQL/HTTP + 11 账号页含真实浏览器）；全量 `npm run test:integration` 12 文件/141 项、`npm run check` 128 单元/10 契约与 217 文件格式/静态检查通过。build 通过；e2e 18 PASS/0 SKIP/0 FAIL，0 console/pageerror。最终格式与 OpenAPI --check 通过。
- 证据：本提交（`git log -- docs/productization/reports/DAT-05.md` 可定位）、[DAT-05 报告](reports/DAT-05.md)、[导入/API/保留边界](../engineering/local-import.md)。本地手机宽度截图已查看；未用浏览器截图代替真机证据。
- 风险与剩余：偏好是草稿，UI-03/04 后续按用户确认应用云资料/正式阵容并复核卡状态；本机设置仅显式应用。首轮 fixture schema/类型错误已修正，全量通过；无新增依赖、未使用远端，隔离 PostgreSQL/Mailpit 正常停止。既有真实微信、真机、素材、依赖审计和平衡门槛保留。
- 回滚：独立提交回退，保留旧练习存储；新增 schema down 仅隔离测试。
- 下一项：UI-03。

### UI-03

- 状态：完成
- 开始：2026-11-18 07:45 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / 1acd04e
- 范围：真实账号大厅，接当前用户、钱包、持有卡/阵容摘要、服务端模式与版本化公告；游客练习/登录回大厅、刷新与失效、慢网/错误/空态/离线/维护/协议不兼容界面。不启用尚未接入的正式比赛或运营功能，不改玩法/经济。
- 计划与验收：共享严格契约和服务端公开配置只读端口；复用当前账号鉴权和云数据，异步读取按账号隔离，金额字符串无假余额；真实数据库/浏览器验证登录回跳、余额变化刷新、失败重试、401、空公告/资料、维护/版本/离线与小屏。
- 实现：大厅实际读取 /me 与账号摘要，真实资料/钱包/卡数/初始阵容可用槽；服务端模式 manifest 和版本化有效公告；大厅登录回跳、按账号隔离异步结果、主动/焦点/联网刷新，加载/失败不造假 0，维护/过旧/离线状态和重试。未载入练习模块时明确离线限制，已载入可继续练习。
- 验证：全量 `npm run test:integration` 12 文件/146 项（账号页浏览器 14、云存档 11），真实 SMTP 登录回大厅、资产授予后刷新、大整数/禁用卡/封禁及运行时公开状态；浏览器明确注入慢网/503/空 DTO/维护/不兼容协议，真实断网练习。`npm run check` 134 单元/10 契约、225 文件格式及静态/生成检查通过；build、e2e 18 PASS/0 SKIP/0 FAIL 通过。Web layout 8 标准+大字/键盘、web shell 3 桌面/移动与反复挂载通过，0 unexpected console/pageerror；最终 lint/format/OpenAPI/diff 检查通过。
- 证据：本提交（`git log -- docs/productization/reports/UI-03.md` 可定位）、[UI-03 报告](reports/UI-03.md)、[大厅/API 边界](../engineering/lobby.md)。本轮手机截图已实际查看；未用浏览器截图代替真机。
- 风险与剩余：大厅维护呈现不替代 NET/OPS 的停新局/drain/readiness；正式模式和运营发布仍按后续任务接入。无新依赖、资产迁移或经济/物理改动；未使用远端，隔离 PostgreSQL/Mailpit 正常停止。既有真实微信、真机、素材、依赖审计和平衡门槛保留。
- GitHub 同步点：完成数 50/112，本提交及同一提交内代码/报告为每十项同步点；下一次为第 60 项。
- 回滚：独立提交回退；无资产 schema 或数值变更。
- 下一项：UI-04。

### UI-04

- 状态：完成
- 开始：2026-11-18 08:07 Asia/Shanghai
- 负责人：Codex
- 分支与起始提交：docs/productization-roadmap / acc638a
- 范围：真实持有卡列表/筛选/详情、五槽点选阵容与 revision 保存；服务端升级报价、金额精确展示、幂等升级与结果不明时原意图重试；登录与账号切换、失败/冲突/空态、旧偏好草稿应用。不改变职业可跨槽规则，不启用正式对战。
- 计划与验收：先验证放卡/保存草稿和升级重试模型，再接现有接口和懒加载页面；仅提交持有卡 UUID 和已获报价的版本。真实数据库/浏览器验证保存、槽位完整/唯一、他人卡/禁用、409/余额不足、双击、响应丢失及重载重试、切换账号、分页/筛选/详情和小屏/键盘操作。
- 实现：真实持有卡/预设/钱包并行分页读取，12 张/页筛选与图集/详情/属性技能；五槽点选/交换/清空、revision 保存，冲突保留草稿并比较服务器状态，未知保存结果只读核对。服务端报价、按账号 sessionStorage 先存原意图再升级，同步防双击、重载后原 key/body 显式重试，重读当前库存；旧偏好只填草稿，未知定义与停用卡不能保存或升级。
- 必要关联：新增可选账号目标头与 ACCOUNT_CHANGED 区别业务冲突，复用至既有必需头检查；读到新 sessionId/403 时按代失效旧 CSRF 缓存，迟到旧响应不覆盖新缓存，不自动重放写入。页面能力只在实际服务挂载时开放；未放开正式对战。
- 验证：`npm run check` 149 单元/10 契约、240 文件格式与静态/生成检查通过；全量 `npm run test:integration` 12 文件/157 项、0 跳过（账号页浏览器 24、资产 25）。真实 SQL/HTTP 验证保存/冲突/越权/停用、并发扣款/陈旧报价、丢响应重载后单次效果、跨账号及多页持有卡；定向视觉/键盘/日志 2 项复核通过。build、e2e 18 PASS/0 SKIP/0 FAIL、8 标准+大字/键盘与 3 页面壳视口通过；最终 lint/format/type/OpenAPI/diff 通过。
- 证据：本提交（`git log -- docs/productization/reports/UI-04.md` 可定位）、[UI-04 报告](reports/UI-04.md)、[持有卡页面/API/重试说明](../engineering/owned-inventory.md)。手机/桌面截图已实际查看，未当作真机验收。
- 风险与剩余：NET-01 需把真实账号/阵容快照绑定正式票据和房间；本地存档意图不构成可信资产。无新依赖或资产迁移，经济/物理未改；未使用远端，隔离 PostgreSQL/Mailpit 正常停止。真实微信、真机、素材、依赖审计和平衡门槛保留。
- 回滚：独立提交回退；无资产迁移或经济/物理参数变更。
- 下一项：NET-01。

## 记录模板

复制模板时将示例 ID 改成真实任务。完成记录标题用 `### TASK-ID`，检查器据此核对已勾选任务的完成证据。

```markdown
### TASK-ID

- 状态：进行中 / 阻塞 / 完成（只能保留一个）
- 开始：YYYY-MM-DD HH:mm Asia/Shanghai
- 负责人：Agent/人员标识
- 分支与起始提交：...
- 范围：本次完成什么、相关文件与必要关联修改
- 实现：具体行为和接口/配置/数据迁移
- 验证：实际命令、环境、结果数量；未执行的明确标注
- 证据：提交/PR、仓库内报告或日志路径、真机信息等可复查位置
- 风险与剩余：没有则写“无已知阻塞”；有阻塞不得标完成
- 回滚：代码/配置/迁移如何恢复
- 下一项：依赖满足的任务 ID
```

在同一次提交中记录证据可写“本提交（git log -- <file> 可定位）”及报告路径，避免为填写尚不存在的 commit hash 制造自引用循环。日志文件若不入库，应上传到用户授权的 CI/artifact 服务或把关键命令/输出摘要写入仓库报告，不能只留其他人访问不到的临时绝对路径。

## 阻塞记录规范

明确缺少什么（凭证/设备/产品选择/外部依赖）、已完成什么、复现方式、解除后运行哪条验证。相关任务保持未勾选。不要把“等待批准”当成所有普通实现工作的默认状态；已有授权内继续完成不依赖该条件的部分。

## 完成勾选规范

1. 确认前置任务已勾选且相应代码在当前分支可用。
2. 完成该任务所有验收，写实际验证与证据，状态改为完成。
3. 只改对应任务 `- [ ]` 为 `- [x]`，不勾选整包或其它未验证任务。
4. 运行 `node tools/check-plan.mjs`，审阅 diff，提交实现和记录。
5. 若后续回归发现任务验收失效，取消该勾选，并说明受影响后续任务；不能只保留绿勾掩盖失败。
