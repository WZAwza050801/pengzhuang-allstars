# 匹配队列（MM-01）

服务端、HTTP与Web已装配并完成任务验收；任务状态以TASKS为准。下文阶段记录保留各检查点当时的范围，当前验证汇总见[验收报告](../productization/reports/MM-01.md)。完整集成初轮323通过/1失败，大厅恢复会话竞态修正后相关四项网页用例全部通过；未再整套重跑，报告保留验证先后。

队列复用账号、五卡持有快照、协议2和现有账号房。首个实际开放入口是friend规则的均衡匹配，不计积分/奖励；ranked/growth仍需既有能力门槛和MM-02真实积分来源。未实现Elo前不会填假积分：friend在无积分池匹配，其它模式必须取得服务端积分/赛季快照。客户端不能提交userId、卡牌、等级或积分。

持久队列按mode、完整配置/规则/队列策略hash、区域、积分scope/赛季和固定分差分组。queue-1仅提供“当前服务器”区域，等待120秒、配对后入场120秒、积分分差200；这些是独立队列策略，不改比赛3分钟/20秒/60秒规则。渐进扩窗与等待估算属于MM-04。不同GameData/策略版本不混配。

队列意图UUID按用户幂等；同意图异载荷冲突，取消后重放原意图仍返回取消结果。数据库唯一约束保证同用户全模式最多一条queued/matched记录。全局队列事务锁按固定顺序串行化入队、取消、超时和配对，复查真实用户/会话与持有卡；配对一次分配原assignment/房间码，取消败给成功时返回该原分配。每运行时队列最多256名等待玩家，实际房间沿用128上限。

实现分为持久状态、实际房间协调和HTTP/Web入口三个检查点。数据库提交配对后才物化受限房间；房间只允许原两名账号和冻结阵容进入。创建失败保存明确失败结果并释放资源，不能回报假成功。票据仍短时一次性，只存nonce hash；入场重试签发新票，不把nonce写URL/队列记录。已开局仍按NET-03/05恢复；本任务不宣称跨实例路由与未开局房间故障接管已完成（MM-05）。

验证必须覆盖真实SQL并发取消/配对、重复意图与新意图、过期、版本/区域/积分隔离、外人/撤销会话/禁用卡、SQL回滚和相同分配重试；随后再验证真实SDK双人开局、过期新票、HTTP鉴权与浏览器刷新/切号/取消竞态。状态和证据以TASKS/EXECUTION_LOG为准。

## 已验证的存储阶段（2026-11-18 20:09）

迁移202611180018增加不可变配置、配对分配和用户队列；配置/入队身份、冻结阵容与积分有数据库约束，终态不能重新排队。同一已接受intentId重放原回执；不同intentId在已有活动队列时返回CONFLICT，客户端应读取原队列，不自动替用户新建意图。queued状态返回可解释的等待原因；其它运行时的记录明确other-server，不假定已实现路由。会话只保存内部关联UUID，不存任何token，也不以该UUID授予身份。

`node tools/run-pg-tests.mjs tests/matchmaking.integration.test.ts tests/persistence.integration.test.ts tests/lineups.integration.test.ts`：32项通过、0跳过（新队列15项），7.30秒，原生隔离PostgreSQL正常清理；日志work/mm01-foundation-final.log。包括真实SQL双实例并发、取消/配对、会话撤销、禁用卡、冻结等级、不同mode/config/区域/积分/赛季和相同房间码重试。积分测试端口读隔离SQL中的真实记录，只证明匹配分组，不构成生产Elo实现。

两个边界先失败再修正：普通SQL改写冻结阵容/重新打开终态被触发器阻止；旧比赛复用同房间码曾误把新分配报为完成，现改以assignment.match_id外键读取权威比赛。SQL触发器故障验证分配及双方状态整体回滚，解除后同码成功。`npm run check`通过192单元/19契约、311文件格式及lint/类型/边界/工具链/规划/生成数据；日志work/mm01-foundation-check-final.log。

## 存储阶段交接（20:09，历史）

20:09时尚无运行时装配、HTTP路由或网页队列。后续协调器须先在128房上限内预留房间码，再调用pair；取得配对的原data/mode/两份selection后创建受限房间，不能先按当前配置创建房间再套旧局。SQL响应不明时保留原code重试；物化成功后ready失败不能随意销毁已经开放的原房间。SQL成功但物化失败须明确标记failed并释放资源。

开局还需在队列协调锁先于用户锁的顺序下，检查活动队列归属、排除其它已开局比赛，并在现有MatchRecovery.started事务内绑定assignment.match_id；否则不能开放队列。不得按roomCode推断该关联。队列房只允许原两名用户入场、使用原冻结selection；新票据和实际SDK/进程/HTTP/Web验证仍待完成。若实现自动就绪/指定席位，必须验证实际席位、对手准备和超时清理，不能用内存模拟开局代替。

## 已验证的运行时阶段（2026-11-18 20:37）

已增加受限房间工厂、协调器与startRuntime装配。协调器每秒扫描、每轮至多新建4个配对房；本地预留/房间仍共用128上限，SQL确认不明时保留原code重试，历史code冲突释放原预留。SQL已配对后创建房间，SQL ready暂失败保留已经存在的原房间；物化失败明确失败双方并释放。房间预留以内部generation key约束释放，迟到清理不能删除另一个新预留。正常关闭停止协调、明确失败未开局队列/分配，已经开局的匹配保持原match_id供NET-05恢复。

QueueConfiguration现在显式format1，包含GameData、模式完整规则、队列策略和mode；hash覆盖全部这些内容。两份冻结规则必须与配置归档一致，实际房间也使用原归档规则。没有改玩法/经济参数；开发期旧队列缓存不会静默转换或混配，排队过期仍由数据库时钟处理。

票据签发/消费复查配对成员、ready、入场期限和原配置；游客/外人不能凭公开code加入。开局在协调锁后取得用户/会话锁，再核对队列归属、原卡和匹配用户的其它活动比赛，参与者/初始快照/assignment.match_id同事务提交。新增限制针对匹配，原好友房的历史恢复查询保持原行为；旧的“较新已完成局不遮蔽较旧可恢复局”回归未经放宽继续通过。

`node tools/run-pg-tests.mjs tests/matchmaking-rooms.integration.test.ts tests/matchmaking.integration.test.ts tests/match-tickets.integration.test.ts tests/lineups.integration.test.ts tests/account-checkpoints.integration.test.ts tests/outcomes.integration.test.ts`：6文件/92项通过、0跳过，88.14秒，work/mm01-runtime-regression.log，退出0。含8项新的真实服务/SDK房间用例、原34账号房/19结果/5真实服务进程重启。验证成功发布前match_id/head已提交、第三方拒绝、过期和重放票据、新票保留原持有等级、真实SQL ready故障保留原房、取消竞态、过期缓存、已有好友大厅无法绕过配对。分配器失败用例在明确的房间端口注入异常，再验证同用户由真实工厂重新配对成功；不将该注入称作实际Colyseus故障。

work/mm01-runtime-check.log通过192单元/19契约、314格式和其余check；work/mm01-runtime-build.log服务端构建通过。首轮ESM spy与错误接收端的测试夹具问题已修正；首次增加的普遍单局限制影响旧恢复回归，已收敛到匹配路径，原断言保留。20:37时HTTP匹配路由、客户端请求适配、网页排队/取消/失败/刷新/切号和完整项目验收尚未实现，当时不可勾选MM-01；后续接入与当前验收见下节和报告。

## HTTP与Web接入

`startRuntime`仅在真实账号/阵容/比赛服务与队列装配后声明`matchmakingEnabled`；无数据库时不显示入口。公开GET `/api/v1/matchmaking/options`返回真实协议、当前配置和队列策略，默认仅friend可入队。旧客户端未收到新增能力时默认关闭。

其余接口均校验真实会话和必需`X-Account-Id`，拒绝额外query。POST/DELETE沿Web边界校验Origin、CSRF与严格body，所有回复禁止缓存：

| 方法与路径（前缀`/api/v1/matchmaking`） | 用途 |
|---|---|
| GET `/entries/current` | 本人最近一次队列，包括服务器确认的终态；没有记录时entry为null。 |
| GET `/entries/:id` | 本人原队列回执；外人及不存在均404。 |
| POST `/entries` | 严格intent/protocol/mode/lineup/revision/configVersion/region；返回原意图状态，后台协调器继续实际配对。 |
| DELETE `/entries/:id` | 空body，原子取消；已配对时返回原配对，不能伪报取消成功。 |
| POST `/entries/:id/ticket` | 协议2，ready后使用原被冻结阵容签新一次性票；配对未准备好为可重试503。 |

QueueStatus含userId、数据库serverNow、原规则、状态/原因与配对信息。没有向客户端授予修改积分、等级或结果的权限。HTTP契约与OpenAPI已同步；`QUEUE_*`仍为旧协议占位，没有双套队列状态机。

维护时拒绝新入队与新配对，保留读/取消和已开局恢复边界。POST入队与签票沿用现有create/connect准入；实际等待256与房间128上限另由服务端保证。历史回执保留不等于总数据库容量已被限制，不能擅自清理比赛关联记录。

Web `/queue/:mode`从大厅按真实能力进入，登录回跳保留安全模式目标；当前只开放均衡匹配。使用持有阵容、服务端规则和区域，状态每两秒在页面可见且在线时读取；焦点/联网刷新，卸载清理监听。倒计时仅作提示，超时由服务器回复确认。未知写结果保留原意图并显式重试，不以本地计时/取消点击推断成功。

配对完成链接只携带本人entry UUID，票据不进入URL。`/room/:code?queueEntry=...`重新签票并使用原阵容，保留原query以支持刷新/重连；原两名成员独占房间，隐藏好友邀请表单。切换真实会话后旧组件失效，迟到状态/库存不写入新账号页面。关闭页面不会自动取消，界面明确说明并提醒。

定向真实HTTP5项与网页4项已通过，覆盖SQL插入故障/原意图重试、刷新唯一队列、服务器过期、真实双人开局、取消败给配对，以及真实cookie切换时的迟到响应。网页测试的延迟/故障注入均明确标注；未用Mock开局代替生产功能。最终全量结果见[MM-01报告](../productization/reports/MM-01.md)。
