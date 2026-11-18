# 登录后的对局恢复

NET-03 解决刷新、页面退出、客户端进程被杀及网络连接替换后的本人席位恢复。恢复依赖长期登录和服务端参赛记录，不依赖原 JS Host、localStorage 中的对局编号、当前云阵容 revision 或游客 seatToken。服务端进程死亡后的快照接管由 NET-05 实施；在接管可用前返回明确 unavailable，不创建替代比赛。

## 持久化与开局

迁移 `202611180014_match_recovery` 为既有 matches 增加 room_code、recovery_closed_at/recovery_close_reason 和索引；不另建一套参赛者表。matches 与双方 match_participants 在同一事务保存，后者沿用五张完整服务器卡牌快照。按稳定 userId 顺序重新锁定/核验双方账号和会话；事务成功、双方仍连接且准备状态有效后，才在房间安装局面、启动时钟和广播 match_start。

参赛者插入失败回滚整笔开局，客户端准备复位可重试；不广播无持久参赛关系的账号比赛。持久化等待中离开/销毁会将该记录关闭为 abandoned，不留下可入场的孤儿局。普通结束和断线过窗分别记录 ended/expired。关闭标记是恢复状态，不是 durable outcome 或奖励已结算；目前 matches.result 仍不由本任务填写。

## API

| 接口 | 边界与行为 |
|---|---|
| `GET /api/v1/me/active-match` | 登录及必填 X-Account-Id；拒绝所有查询参数；事务内复查账号/会话，以 userId 过滤本人参赛记录，优先尚未关闭的最新记录。 |
| `POST /api/v1/matches/:id/reentry` | 登录、Origin/CSRF、必填 X-Account-Id、UUID 路径及严格 `{protocol:2}`；校验本人持久参赛关系与当前房间；返回既有 60 秒、一次性、绑定新 session 的协议 2 票据。 |

两个响应均 no-store。GET 不签发票据，只返回 `{userId,state,match}`；available 时 match 含 matchId/roomCode/mode/configVersion/protocol/本人 side/相对 reconnectMs。其余状态 match 为 null：

| state | 含义 |
|---|---|
| none | 没有可定位的本人账号参赛记录 |
| available | 持久参与者、实际 matchId/side/配置及当前重连资格一致 |
| expired | 重连窗口已过或双方放弃，不能重新入场 |
| ended | 上一场已结束，不能凭恢复票据复活 |
| unavailable | 有参赛记录，但原比赛服务/实例或版本无法匹配；不能静默开新局 |

不公开对手 userId、持有卡 UUID、随机种子、session 或任何入场凭据。别人的/未知 matchId 返回 404；伪造账号提示拒绝，查询不能通过 userId 参数切换对象。数据库失败固定 503，可由用户重试，不泄露 SQL。

恢复状态由服务端记录和房间共同裁定：开局提交后进入 available；断线但尚在窗口内仍可换票回到 available；过窗/放弃转 expired，正常终局转 ended，房间或冻结版本无法匹配转 unavailable。数据库故障不伪造 none/available，而是返回可重试错误。校验和 OPTIONS 只挂载在这两个具体路由，不能改写其他旧路径的错误行为。

POST 从原席位读取冻结 selection，将原 lineupId/revision 交给现有票据事务；不读取客户端上传阵容，不用最新阵容覆盖旧比赛。新登录 session 也可恢复原用户；签发、原子消费和最终入场继续验证账号 active、会话未撤销、持有卡与窗口。并发票据按既有账号配额和 IP/global 连接预算处理；同 nonce 不可重放，同账号换连接仍只占原席位。

## 客户端流程

大厅和未连接好友房均显示本人恢复入口。页面/焦点/上线/回前台重新读取，不自动签发票据；恢复按钮显式换取新票并连接原房。恢复独立于当前持有阵容读取，所以云阵容已更新仍可继续。失败不创建新房、不重发旧出手；后续断线继续按同一 matchId 签发新票。

每次查询和连接都检查当前 userId/session，组件卸载与换号使旧异步响应失效。GET 校验返回 owner；停止、离页或切号后不消费迟到票据。凭据只在请求正文/内存，邀请和路由仍只有公开房间码。新客户端进程只需恢复登录 Cookie；不会从本地保存的等级、资产或比赛状态推导权限。

现有网页只开放 friend 入口，其他模式保持原能力门槛。恢复本场不受“停新局”的维护开关阻断；仍需身份有效、网络在线和协议兼容。超时显示只做提示，服务端仍裁定窗口和终局。

## 后续与失败范围

服务端本地目录仍属于一个 Colyseus 运行时；NET-05 统一账号快照、配置归档和重启接管。服务端已消失时，本任务能持久发现原参与关系并明确不可用，不能恢复缺失的局面。终局标记写入失败不复活本地已结束的房间；原记录保留，服务不可定位时明确 unavailable。持久终局/结算的失败重试与修复由 NET-04/05 完成，不把当前标记当成可靠结果。

部署先迁移再开启新版账号入口；回滚先停新局/排空房间并配套恢复旧客户端，再撤销迁移。撤销会移除恢复定位/关闭标记，matches 和参赛历史仍保留；不得在新版代码运行时删列。实际验证见 [NET-03 报告](../productization/reports/NET-03.md)。
