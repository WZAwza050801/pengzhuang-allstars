# 账号房间与入场票据

NET-01 将 `account_match` 与历史 `match` 游客房间分开。两者复用 MatchRoom、shared 物理、模式和消息；历史入口仍为无奖励的练习/均衡好友试玩，不能声明长期账号、成长等级、排位或奖励。账号房间使用两个玩家席位和一个临时鉴权连接位，允许已连接账号换连接；第三个账号不能入座。

## 签发与消费

登录客户端先 POST `/api/v1/matches/tickets`，正文为 `protocol/mode/lineupId/expectedRevision`，加入指定房间时增加 `roomCode`。Web 请求沿用登录 Cookie、允许的 Origin 和 CSRF；可选 `X-Account-Id` 仅拒绝切号后的旧请求，不选择身份。该头也加入既有跨域预检白名单。严格正文拒绝昵称、userId、卡牌数组、等级和上传的快照。friend/ranked/growth 都校验本人完整持有阵容；growth 采用持有等级，friend/ranked 固定 Lv5；正式模式沿用已实现技能门槛。

MatchTickets 在同一 PostgreSQL 事务中按 user→session→lineup→排序卡牌锁顺序复查身份、构建 DAT-03 快照并写一次性 nonce 的 SHA-256。256 位随机 nonce 原文只返回客户端，数据库没有原文。到期使用数据库时钟，从签发起 60 秒；目标绑定 roomCode、账号/session、模式、完整配置版本和阵容 revision/属性快照。每账号 60 秒最多成功签发 12 张，在用户锁下计数，不因多实例并发超发。

新房先预留有界本地名额，事务成功后由服务端私有 creation grant 创建，失败释放名额并尽力撤销未消费票据；数据库故障统一 503，不泄露 SQL。直接从公开 matchmaker 建账号房没有 grant，必被拒绝。加入已有房使用该房冻结的数据，不把新发布配置带入旧房。

响应为 `ticket/roomCode/expiresAt/protocol/configVersion/mode`。客户端调用 `sdk.joinById(roomCode, { protocol, ticket })`；票据在 HTTP matchmaker 正文中传递，随后由 WebSocket `onAuth` 消费。邀请链接只含公开房间码，不能含票据、access/refresh 或旧 seatToken。禁止把凭据放 URL，升级入口拒绝 `_authToken/access_token/ticket` 查询参数。

`onAuth` 先按 hash 找到候选 principal，再在事务内锁用户/session并复查即时 active、撤销和会话过期，条件 UPDATE 原子标记 consumed；不同房间/模式/配置、过期和重放都失败。随后检查五张冻结持有卡仍属本人且 active，失败回滚 nonce 消费。并发使用一个 nonce 只有一个赢家，包括独立 MatchTickets 实例。卡升级不修改已签发快照。

## 房间身份与重入

NET-02 将账号票据和比赛升级到协议 2，并在数据库绑定票据协议；旧游客仍为 1。兼容窗口、明确升级错误、出手回执与串行时钟见 [match-protocol.md](match-protocol.md)。

座位内部保存 userId、鉴权 session 与不可变持有快照；昵称从服务端 profile 读取，只用于展示。同名账号是不同席位。客户端 set_lineup 在账号房统一拒绝；比赛直接使用冻结的 playerDefId 和有效等级，不能上传等级。

房间消息标注 `identity: account`，只向本人提供 `account.userId/lineupId/revision`，不向对手公开该账号或持有卡 UUID。账号房不返回旧 seatToken，带旧 seatToken 或伪造 userId 的入场正文被拒绝。历史游客房继续只通过随机 seatToken 认座，不获得账号权限。

同进程重入必须经登录再次签发新票据，绑定同房同账号的原阵容快照；即使用户后来保存了新阵容，也不能改写比赛。断线窗口与服务端时钟沿用既有 60 秒规则，封禁/撤销/过窗/已结束都会拒绝。额外鉴权连接位用于替换在线的旧连接，玩家席位始终为两个。

NET-03 已补充登录后 active-match 查询和客户端刷新/进程恢复，见 [match-recovery.md](match-recovery.md)。[NET-05](match-checkpoints.md) 已接入账号局持久快照与服务重启接管，NET-04保存可靠结果并幂等结算；恢复仍需登录换取新票据，不恢复旧鉴权会话。账号房明确不写旧游客恢复文件，避免重启后变成绕过账号检查的 bearer-token 座位。正式模式对外入口仍关闭，只有实际结算凭证可作为奖励，积分仍需MM-02真实实现。

## 全局有界准入

单个运行时所有房间共用 RoomAdmission：固定 60 秒窗口、每 socket IP 240 次/全局 1200 次准入尝试，建房每 IP 60 次/全局 120 次；HTTP matchmaker、票据 API 与 WebSocket upgrade 共用预算，拒绝的尝试也计数。只读取真实 socket 地址，忽略调用者自报的转发 IP。最多保留 10,000 个 IP 桶，满时拒绝新键；窗口到期统一清理。

账号目录最多 128 个预留或已创建房间；未开局房间 10 分钟后释放，票据 60 秒失效。每次签发最多清理 100 条过期超过一天的票据。matchmaker 正文最多 2,048 字节，读取有 5 秒超时；WebSocket 帧沿用原 2,048 字节上限。

IP/global 准入预算与账号目录当前属于一个 Colyseus 运行时；多实例上线前须在可信网关补充跨实例全局限流及连接容量控制，并配置真实代理边界。数据库的账号签发预算/nonce 消费已经跨服务实例互斥。这里不宣称完成 OPS/QA 的生产容量验收。原批量 net 故障测试显式提高其夹具预算，以执行数百次协议请求；准入生产默认和自定义低预算由独立真实 HTTP/WebSocket 测试验证。

## 迁移与验证

`202611180012_match_tickets.mjs` 只增加票据表及过期/用户索引，不改物理、经济或旧用户资产。回滚只用于停止账号入场且无后续依赖的隔离环境，down 会失效所有未用票据。任务证据见 [NET-01 报告](../productization/reports/NET-01.md)。
