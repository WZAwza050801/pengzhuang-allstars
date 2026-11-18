# 比赛结果保存与结算（NET-04）

账号房在开局事务中冻结结算配置，在终局生成一次权威候选；结果保存与奖励入账分别确认。生产 runtime 启动时扫描私有日志和数据库 outbox，退出时先停止消费者再关闭数据库。实现见 `server/matches/outcomes.ts`、`outcome-journal.ts`、`results.ts` 和 `server/rooms/MatchRoom.ts`，验收见 [NET-04 报告](../productization/reports/NET-04.md)。

## 已确定的边界

- 复用 economy-2、modes-1。friend 不发正式奖励；growth/ranked 的 ratingScope 不因本任务被删掉。缺真实 MM-02 排名端口时保持 pending，不提交半笔资产。生产正式模式入口应在其依赖可用后才开放；组件测试的排名端口写真实 SQL 事务标记，只验证事务边界，不假装实现 Elo。
- `match_settlement_configurations` 按版本和模式固定 GameData/EconomyPolicy/ModeRules 与 SHA-256；每局只引用配置 hash。开局需与 matches/participants 同事务固定该引用，结算不读后来的当前价格。
- `match_outcomes` 同局唯一且载荷不可变；同载荷返回原结果，异载荷拒绝/报警。outcome、matches.status/result 与 `match.settle` outbox 同事务提交。
- 私有日志位于 roomStoreDir 下的 pending-outcomes，目录由现有 data/rooms 忽略规则覆盖；测试仅用隔离目录。候选只有结果/分数/双方 userId/出手数/持续时间和版本引用，没有会话凭据、种子或客户端上传资产。先 fsync 文件并以独占硬链接发布，防止竞争覆盖；Windows 不声称目录 fsync 或机器断电保证。日志仅在确认数据库结算事务提交后清理。
- DB 不可达但日志成功时返回 pending；DB 成功但日志不可用仍可使用事务 outcome/outbox。两者都不可用时只保留冻结的 RAM 终局候选，`recoverable:false`，不得发送终局包/接受回执或声称结果已保存；冻结后续输入并按同一载荷重试。候选 12 次后等待维护，DB 从不可达变可达时可恢复尝试；没有持久副本时不承诺机器/进程崩溃后能保住未确认的候选。日志损坏或哈希冲突保留隔离证据，不覆盖原记录。
- 消费按 outbox → match → outcome → 排序 userId 锁顺序；资产、奖励唯一记录、每日额度/参与卡进度、可选真实排名端口与 processed/settled 标记一次事务提交。使用现有完整事务死锁重试；失败只更新稳定错误码和有界退避，12 次后等待维护，不删结果。
- 每日额度及每日参与卡领取在 user/day 域共享；参与进度保留经济版本，避免历史结算被新阈值静默改写。economy-2 的 carry-until-claim 使用原 helper，过往版本日进度按当日已合格场次计算。没有改写已确认价格或奖励金额。

## 房间与客户端

`MatchRecovery.started` 将参赛者与配置引用一次提交，工厂将配置 hash 返回房间。出手数来自服务端去重回执，持续时间来自开局后的单调时钟，结束时间来自服务端墙钟。正式胜负使用既有模式分类：包括 shot-limit 在内的作废局保存 winner=-1，未改动 Demo 物理和计分。

房间保存同一候选与待发送终局包；双存储失败时冻结输入，重发原 shot 不能获得正向回执。日志成功后可发送终局包，数据库提交后才允许回收本地房间对象。双方离线过窗也写明确的 abandoned/void 结果。数据库恢复标记只在奖励事务成功后关闭。

`settlement` 消息带状态、recorded、seq、版本戳；已有可靠副本时另带去掉 RNG 的最终状态，以恢复丢失的终局广播。只有状态的消息不会占用客户端状态 revision。旧消息不能把 settled 降级；所有待结算状态冻结再次出手。现有比赛顶栏显示等待保存、已保存待结算、已结算或失败；独立结果页/刷新后的查询流程归 UI-06。

## 本人只读接口

| 路径（`/api/v1` 下） | 约束 |
|---|---|
| `GET /matches/:id/result` | 活跃会话、必需 `X-Account-Id`、本人参赛；外人 404。结果尚未结束返回 404；持有私有日志/RAM 候选时可返回 pending，reward 为 null。 |
| `GET /me/matches` | 同样的身份限制；默认 20、最多 50，按结束时间和 UUID 倒序游标分页；只列数据库已记录的结果。 |
| `GET /matches/:id/ledger`（UI-06） | 本人参赛且结算已提交；只读实际奖励关联的本人账本记录，条数/金额核验后返回。详情见 [结果页与回局交互](match-results-ui.md)。 |

响应 `Cache-Control: no-store`；不包含对手 userId、会话/重连凭据、种子、完整配置或服务器文件路径。状态为 pending 时 recorded=false，recorded 表示 outcome/outbox 已提交，settled 才有本人的奖励凭证（明确的零奖励也有凭证）。failed 保留待处理结果；错误或查不到不等于奖励为零。WebAccountClient 校验用户和 matchId，历史中每一项也必须属于当前用户。

不提供玩家提交结果、领取奖励或手动消费接口。自动重试上限 12 次，指数退避最多 300 秒；单条失败不阻塞本批其它事件。哈希冲突直接停在上限并保留证据。管理重试/补偿流程分别归 ADM-03、DAT-06，不能通过改胜负或直接改余额处理。

## 验证边界与恢复

真实子进程测试在日志已同步但数据库不可达、奖励事务提交前、提交后清理日志前三个位置结束进程，再用新服务恢复；SQL 触发器另外覆盖钱包、账本、资产操作、奖励行、outcome 和 outbox 完成标记处的回滚。组件测试用真实 SQL 标记验证排名端口的事务边界，该标记没有生产绑定，不构成 MM-02 的 Elo 实现。

NET-05 仍负责运行中账号局的快照、已接受非终局出手与服务重启接管。本模块只恢复已经生成可靠终局意图或 outcome/outbox 的结算；双存储都失败且没有可靠副本时，不能保证结束进程后保留未确认候选。生产磁盘、备份、告警与容量放量仍须 OPS 工作包验收。
