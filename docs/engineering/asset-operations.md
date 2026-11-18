# 资产操作与账本（DAT-04）

实现入口为 `server/accounts/assets.ts`、`server/api/assets.ts` 和 `packages/persistence/src/assets.ts`；契约为 `economy-operations.ts`。不改变 `economy-2` 的成本、初始资产或卡池。

## 玩家接口

以下路径均以 `/api/v1` 为前缀，验证有效账号/会话；写请求沿用 Web Origin/CSRF 边界。

| 接口 | 输入与结果 |
|---|---|
| `GET /me/cards/:id/upgrade-quote` | 本人 active 卡；返回当前/下一等级、金币成本、卡版本 `expectedRevision` 和 `economyVersion`。 |
| `GET /me/cards/craft-quote?playerDefId=p03` | 未持有且可用的定义；返回碎片成本、碎片钱包版本 `expectedRevision` 和经济版本。 |
| `POST /me/cards/:id/upgrade` | UUID `Idempotency-Key`；body 只有 `expectedRevision`、`expectedEconomyVersion`。 |
| `POST /me/cards/craft` | UUID `Idempotency-Key`；body 另含 `playerDefId`。 |
| `GET /me/ledger?limit=20&cursor=…` | 默认 20、最多 50；本人流水，按时间/UUID 倒序，返回 `nextCursor`。 |

报价不预留余额。新意图在拿到用户锁后冻结当前经济和 GameData，核对价格版本、持有权、状态及 revision，再调用既有纯经济规则。升级核对卡版本，合成核对碎片钱包版本；过期或不满足业务条件返回 409，未知/外人卡均为 404。金额和经验通过十进制字符串传输，运算使用 BigInt，范围为 PostgreSQL int64；额外价格、余额、用户、等级字段拒绝。

## 同一意图与重试

成功回执以 `(userId, operationId)` 唯一。原载荷规范化 hash 相同返回原结果，不再扣款、升级、写流水或 outbox；不同载荷/目标/操作类型返回 409。回执检查先于新价格/revision 检查，配置变更后仍能查询原成功结果。账号和会话验证仍先执行，封禁不能通过回执重放绕过。

失败事务没有资产变化、流水、回执或事件，失败 key 尚未绑定。响应丢失或临时故障时，客户端保留原 key 和原 body 重试；改变意图时换新 key。原回执是成功时的历史结果，重试成功后刷新当前钱包/卡列表，不能将其当作最新余额。余额不足为 `INSUFFICIENT_FUNDS`；revision/价格/载荷冲突为 `CONFLICT`。

事务锁顺序为用户、会话（玩家请求）、钱包 currency 顺序、卡 UUID 顺序；定义注册先去重排序。用户锁也串行化首次初始化、同用户不同卡/不同会话的扣款。单事务更新钱包版本、卡等级/版本、追加流水、保存回执、插入 `asset.changed` outbox。迁移为账本和回执增加 UPDATE/DELETE 拒绝触发器，纠正必须追加新流水。

`retryTransaction` 只对 `40P01`（死锁）和 `40001`（序列化失败）重跑完整 SQL 事务，最多三次，间隔 10/20ms；回调不得发送邮件或网络消息。此策略依据 [PostgreSQL 17 完整事务重试要求](https://www.postgresql.org/docs/17/mvcc-serialization-failure-handling.html)。耗尽、锁超时、连接故障返回可重试 503；连接故障不在服务内盲目重放提交结果未知的事务，调用方使用原 key 重新请求。其他 SQL 错误不扩大为无限重试。

## 内部授予与扣除

`grantTrusted`/`debitTrusted` 和对应 `InTransaction` 端口仅供可信服务使用，没有玩家任意 grant/debit HTTP 路由。它们校验 active 用户、严格输入、正整数金额，并在等待锁之前复制输入；指定历史配置时深冻结 policy/GameData。事务组合端口与调用方共用同一 tx，调用方负责重试整个外层事务，不能只重试局部资产写入。

授予原因限定比赛奖励、参与卡、任务、邮件、成就、管理员纠正；扣除只允许管理员纠正。调用方必须先验证比赛资格/每日上限、领取权或 RBAC/审计，不能直接转发玩家 JSON。NET/LIV/ADM 后续负责这些业务来源，当前不代表比赛发奖、领取或管理员接口已完成。

除传输 key 外，grant/debit 的 `(userId, kind, reason, sourceId)` 也有唯一约束，防止同一业务来源换 key 重复发放。sourceId 应使用稳定比赛/领取/纠正标识。同定义仅一张卡，重复转换为碎片，单独记录 `card.duplicate`；被禁用的原卡不会因重复授予重新激活。可信配置中新定义由服务注册，不接受客户端定义注入。

账本包含初始授予，输出 id/currency/delta/balanceAfter/reason/sourceId/createdAt，不输出用户标识、hash 或令牌。游标保留数据库微秒精度及 UUID，避免同毫秒记录漏页；公开时间显示仍为 ISO。读取和写入都限定本人；注销流程保留资产历史，本次未增加个人信息字段。

## 迁移与边界

先执行 `202611180010_asset_operations.mjs` 再部署使用新服务的运行时。down 仅供隔离测试，不撤回已发生的资产效果，也不能用来回退生产资产。历史保留/受控纠正由 DAT-06/OPS 补齐。outbox 在事务内可靠入库，后续 NET/OPS 接入消费者，当前不宣称已完成外部投递。

升级改变持有卡版本，已冻结的参赛快照保持不变；下一次 DAT-03 快照读取新等级/版本。内部授予/扣除可与未来结算、奖励唯一记录同事务组合。真实验收与故障注入范围见 [DAT-04 报告](../productization/reports/DAT-04.md)。

UI-04 提供 [持有卡/升级页面](owned-inventory.md)，保留原 UUID key/报价版本并在未知结果后显式重试；不把回执余额当最新余额。可选 X-Account-Id 不匹配会返回 ACCOUNT_CHANGED，保留原账号的未确认意图，业务鉴权仍只认真实会话。
