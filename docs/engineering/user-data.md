# 云存档与资产持久化（DAT-01）

迁移 `202611180002_user_data.mjs` 依赖 ACC-01 的 `users`。业务 repository 注入 `SqlExecutor`，可以接收 `Database.transaction` 的同一 tx；它们只执行持久化，不从客户端构造可信用户、价格、等级或比赛结果。

| 表 | 标识、约束与查询 |
|---|---|
| `player_definitions` | 静态定义 ID 注册表，`p` 加 2–4 位数字；由服务端可信配置注册。旧 ID 保留以读取历史卡，不复制物理/技能数值。 |
| `profiles` | userId 唯一；nickname/avatarAssetId、level、exp、version 与创建/更新时间；exp 非负 bigint，版本非负整数。 |
| `owned_cards` | 数据库生成 UUID；userId、playerDefId 为独立外键；每用户同定义唯一（BAL-05）；level 1–10、exp/version 非负。DAT-03 增加 active/disabled；`(id,user_id)` 供组合外键校验归属。 |
| `lineups` | 独立 UUID、userId、name、revision；按 userId/id 索引。 |
| `lineup_slots` | `(lineup_id,slot)` 唯一、slot 0–4；同阵容不得重复同卡；组合外键保证阵容和卡属于同一用户。[DAT-03 服务](lineups.md) 原子验证五槽、持有权/状态/等级及模式，保留职业可跨槽的既有规则。 |
| `wallets` | `(user_id,currency)` 唯一，currency 仅 coins/fragments；balance 非负 int64、version 非负。 |
| `asset_ledger` | 独立流水 UUID；userId/currency 组合外键；delta 有符号 int64、balanceAfter 非负；reason/sourceId/idempotencyKey/payloadHash。唯一域为 `(userId,reason,idempotencyKey,currency)`，支持同业务多币种流水。按用户/时间/id 索引。 |
| `asset_operations` | DAT-04 成功回执，`(userId,operationKey)` 唯一，保存 kind/reason/sourceId/hash/result；grant/debit 另有业务来源唯一约束。与账本一起禁止 UPDATE/DELETE。 |
| `matches` | 数据库 UUID、mode、configVersion、protocolVersion、status、result、创建/完成时间；按 status/时间索引。 |
| `match_participants` | `(matchId,userId)` 唯一、`(matchId,side)` 唯一，side 0/1；五卡 JSON 快照保存 ownedCardId/playerDefId/pieceId 等独立标识。按用户/创建时间/matchId 索引。 |
| `outbox_events` | UUID、type、aggregateId、对象 payload、attempts、nextAttemptAt、processedAt、createdAt；未处理项的时间/id 部分索引用于有界 due 查询。 |

外键统一 `ON DELETE RESTRICT`，不级联删除用户资产、阵容或历史比赛。账号清理需由后续注销/匿名化流程显式处理。迁移 down 按依赖逆序删除本迁移表，仅供显式本地测试；不删除 ACC-01 表。生产变更按前向兼容策略执行。

`UserDataRepository` 提供定义注册、资料/持有卡/钱包读写、阵容槽位插入与账本追加；`MatchDataRepository` 提供比赛/参与者持久化、outbox 插入和 due 查询。卡牌分页使用 userId + afterId，limit 1–100。金额输入要求 bigint，范围按 PostgreSQL int64 检查，所有 bigint 输出显式 SQL `::text` 后返回十进制字符串；不安装全局 pg 类型转换，不经过 Number。JSON payload 中的金额同样应传入十进制字符串。

账本唯一约束只防重复插入。DAT-04 已实现钱包/卡锁、同一意图 payloadHash 比较、报价/变动/流水/回执/outbox 同事务，以及原结果重放；接口与可信内部端口见 [资产操作](asset-operations.md)。比赛可信快照由 DAT-03/NET 校验；结果与奖励唯一性表由 NET-04 迁移接入。

验证命令为 `npm run test:integration`，隔离数据库配置见 [database.md](database.md)。本任务覆盖真实 FK/唯一/CHECK、最大 bigint 精度、跨用户阵容卡、账本冲突、三仓储事务回滚、快照与参与者约束、due 查询及 EXPLAIN 索引路径和最新迁移 down/up。
