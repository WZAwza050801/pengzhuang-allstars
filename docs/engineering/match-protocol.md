# 对战协议与幂等出手

NET-02 在既有 MatchRoom/物理裁判上扩展账号协议。游客 `match` 仍为协议 1；账号 `account_match`、HTTP ticket 和后续账号队列合同使用协议 2。公开 manifest 列出 `[1,2]`，当前账号大厅要求支持 2；不能据此把账号协议 1 的票据用于游客房。游客兼容保留至另行确认迁移，没有自动撤销日期。

## 版本与入场

账号票据写入 `protocol_version=2`，消费事务同样检查 2。迁移 `202611180013_ticket_protocol` 给旧行补 1，旧票据不会被当成新版消费，也不会被失败尝试消耗；重新登录/签发仍复查账号与会话。HTTP 明确不支持的版本返回 426、`PROTOCOL_UNSUPPORTED`、不可自动重试；当前页面提示刷新。旧账号客户端不解析新增错误码时，沿既有 `INVALID_RESPONSE` 路径提示刷新。旧游客客户端继续原流程。

每房创建时深冻结 GameData 和 ModeRules；新配置只用于新房。`matchId`、`turnId`、`clientShotId`、`configVersion` 保留。v2 shot 额外严格要求 `protocol:2` 与非负安全整数 `revision`，拒绝额外字段。`turnId` 是已见 `shotNo`；revision 覆盖出手、超时、认输等每次权威局面变更，不能用出手 seq 代替。

## 回执与去重

回执以 JSON 元组 `(matchId, actorId, clientShotId)` 索引；账号 actorId 来自已鉴权 userId，游客来自服务端 guestId。换连接、同名昵称不改变账号键。SHA-256 比较规范化后的协议、match/turn/revision/config 和完整 input；`-0` 与 `0` 视作同一数值。接受前先验证规则并对克隆计算；非法新命令不占回执。

| 情况 | 响应 |
|---|---|
| v2 首次接受 | `shot_packet` 和 `shot_ack`；ACK 含原 `seq/acceptedRevision`、当前 `revision`、`duplicate:false` |
| v2 相同重试 | `shot_ack` 返回原 seq/acceptedRevision、`duplicate:true`；即使回合已变或比赛已结束也可查原回执 |
| 已用 ID 改载荷 | `shot-conflict`，不计算、不推进状态 |
| v1 相同重试 | 保持 `duplicate-shot` 错误和原 seq；新增哈希记录可识别异载荷冲突 |
| 老游客记录无哈希 | 保持原 `duplicate-shot+seq`，不声称已经证明载荷相同 |

公开局面 RNG 仍为 0。回执不含种子、令牌或未公开账号详情。当前回执属于房间内存；游客保存文件可附带哈希/actor/revision 并在恢复时校验，旧格式 1 仍可读。账号跨进程持久恢复及接受出手的崩溃持久性由 NET-03/05 完成，不把当前进程内回执当成数据库业务幂等表。

## 串行裁定

每房网络命令最多 32 项（含正在执行项），超出返回 rate-limited；原每连接 30 条/秒限制和全局准入保留。出手、认输和四类时钟控制进入同一 FIFO。时钟使用固定键合并尚未执行的通知，不被网络预算丢弃；每次重新设定回合/比赛/断线窗口都提升 generation，已经排队的旧通知失效。

入队记录服务端单调到达时间和 revision，不能在计算中预猜下一回合而排队成功。期限内已接收的合法出手先完成；超时控制随后按实际状态裁定。模拟只改克隆，提交前比对 room disposal、epoch、revision、原 match 引用和 phase；房间销毁会丢弃后续命令和迟到结果。认输绑定 match/config，按队列顺序执行，不以旧局面的 revision 意外丢弃明确认输意图。

计算异常/超限不改变局面和回执，原意图可手动重试。提交后的发送失败仍完成本地保存/结束清理，不回滚已接受的序号。运行时仍使用原同步共享物理；异步注入端口用于真实物理延迟/失败测试，worker、CPU 超时和容量测量留给 NET-06。

## 消息与客户端

客户端帧沿用毫米整数和冻结配置的录制频率（当前 30 Hz）。传输入包仍限制 2048 bytes；服务端出手包按 UTF-8 JSON 保守上界限制 512 KiB，帧数至多 1024 且不超过冻结 `ceil(maxSimSeconds*recordHz)+2`。每行必须与最多 65 个唯一实体 ID 对齐，为安全整数 int32；事件数组各至多 4096。超过限制整杆拒绝，不截断回放或更改物理。客户端同样检查帧尺寸与消息预算。

账号客户端只接收协议 2 的有效 revision，忽略更旧状态和重复出手包；同 revision 的 resume 允许重建当前画面，旧连接回调仍由连接引用隔离。旧 resume/error 不解除较新 pending。ACK 证明接受但对应回放未收到时，只换新票读取权威快照，不解锁旧局面或自动重打一杆。终局会取消正在等待的恢复定时器。

验收来源：`tests/match-wire.test.ts`、`tests/match-serialization.test.ts`、`tests/match-client.test.ts`、真实 PostgreSQL 的 `tests/match-tickets.integration.test.ts`，以及原联机/浏览器回归；计数和环境见 [NET-02 报告](../productization/reports/NET-02.md)。
