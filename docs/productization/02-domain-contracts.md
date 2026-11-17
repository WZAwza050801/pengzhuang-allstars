# 账号、存档、对战与 API 契约

## 1. 权威边界与标识

- userId：长期用户。登录供应商身份只是与 userId 绑定的凭证。
- playerDefId：静态球员定义；ownedCardId：某用户拥有的卡实例；pieceId：本场棋子；不能直接相互替换。
- sessionId：一次账号会话；seatToken：临时对战座位恢复凭证，不是长期登录凭证。
- matchId：全局唯一比赛；configVersion：本局冻结的规则/数值/资源逻辑版本；protocolVersion：客户端与服务端通信版本。
- ledgerEntryId：一次资产变动；idempotencyKey：同一业务意图的重试键。不同请求不能复用同一键修改载荷。

客户端只能提交意图。昵称、头像 URL、阵容、升级请求、房间码都必须校验；余额、等级、角色、胜负、掉落和奖励由服务端产生。

## 2. 数据模型

字段为最低要求；DAT-01 输出完整 migration、索引、外键/删除策略和数据字典。时间使用 timestamptz，业务整数金额使用 bigint 最小单位，接口表示为十进制字符串，禁止浮点货币。UUID 使用服务端标准生成，不以可枚举序号暴露用户身份。

| 表 | 关键字段与约束 |
|---|---|
| users | id、status(active/banned/deleting/deleted)、created_at、deleted_at |
| auth_identities | user_id、provider、provider_subject、provider_app_id；三元唯一；微信按实际 appId/openId 绑定，不假设所有端天然同一 openId |
| password_credentials | user_id 唯一、password_hash、updated_at；不记录明文/可逆密码 |
| verification_tokens | purpose、token_hash、expires_at、used_at；一次性，找回/验证/绑定不能混用 |
| sessions | id、user_id、refresh_token_hash、family_id、expires_at、revoked_at、device_label |
| profiles | user_id 唯一、nickname、avatar_asset_id、level、exp、version |
| owned_cards | id、user_id、player_def_id、level、exp、version；是否允许同定义多卡由 BAL-05 决策 |
| lineups / lineup_slots | id、user_id、name、revision；slot 唯一、owned_card_id 外键；同一阵容不重复卡且符合位置规则 |
| wallets | user_id、currency、balance>=0、version；user_id+currency 唯一 |
| asset_ledger | id、user_id、currency、delta、balance_after、reason、source_id、idempotency_key；唯一键限定业务域 |
| matches / match_participants | matchId、mode、configVersion、status、result；参与者 userId、阵容快照、side |
| match_outcomes | matchId 唯一、final_seq、winner、reason、payload_hash、payload；不可由客户端写入 |
| match_rewards | matchId+userId+rewardType 唯一，记录结算版本和资产流水关联 |
| match_events / snapshots | matchId、seq、事件/快照版本；seq 唯一；访问凭证字段不得进入公开回放 |
| outbox_events | id、type、aggregate_id、payload、attempts、next_attempt_at、processed_at |
| rank_ratings / seasons | userId+seasonId+mode 唯一、rating、games、version；赛季配置固定版本 |
| admin_roles / admin_grants | 最小权限；管理员不是普通 profile 字段 |
| audit_logs | actor、action、target、request_id、redacted_diff、reason、created_at；追加式 |
| mail / task_progress / achievements | 来源事件唯一、领取唯一、期限按服务端时钟；进度不能由客户端直接加 |
| clubs / club_members | 稳定 clubId、角色、成员关系唯一；暂不包含交易/聊天支付 |
| config_releases | version、hash、status、effective_at、approver、rollback_target |

建议索引：用户创建时间、状态/更新时间、会话 user_id+revoked_at、卡牌 user_id、战绩参与者 user_id+created_at、outbox 待处理索引、审计 target+created_at。列表使用游标分页和上限，不提供无限全量接口。

### 必须有的数据库约束示意

```sql
CREATE UNIQUE INDEX match_outcome_once ON match_outcomes (match_id);
CREATE UNIQUE INDEX reward_once ON match_rewards (match_id, user_id, reward_type);
CREATE UNIQUE INDEX ledger_intent_once ON asset_ledger (user_id, idempotency_key);
ALTER TABLE wallets ADD CONSTRAINT nonnegative_balance CHECK (balance >= 0);
CREATE UNIQUE INDEX lineup_slot_once ON lineup_slots (lineup_id, slot);
```

实际 migration 要处理已有表和存量数据，不能把此片段视为完整 schema。幂等冲突时比较原始载荷 hash：相同返回原结果，不同返回 conflict，不覆盖原交易。

## 3. HTTP API 设计

路径以 `/api/v1` 为基准，JSON schema 为权威。旧 `/healthz` 保留；业务路由不受 SPA fallback 吞掉。所有写接口有大小限制、超时和鉴权；管理员接口额外校验权限。

| 方法与路径 | 行为 |
|---|---|
| POST /auth/register /auth/login | 注册/邮箱密码登录；登录响应不暴露用户是否存在的敏感差异 |
| POST /auth/email/verify /auth/password/reset-request /auth/password/reset | 一次性验证与找回；存在/不存在邮箱的请求响应一致 |
| POST /auth/wechat/exchange | code 仅一次换取平台身份，再映射 userId；appSecret 仅在服务端 |
| POST /auth/refresh /auth/logout | 旋转刷新或撤销当前会话；Web 用 Cookie |
| GET /me /me/sessions | 当前资料与可管理会话列表；不返回 refresh hash |
| DELETE /me/sessions/:id | 只能撤销自己的会话 |
| POST /me/identities/link | 近期重新认证后绑定；冲突不能自动合并两个账号 |
| DELETE /me | 注销申请、冷静期/保留策略按发行要求配置，最终匿名化与审计隔离 |
| PATCH /me/profile | nickname、avatarAssetId；revision 乐观锁；不允许改 level/currency/role |
| GET /me/cards /me/wallet /me/lineups | 服务端资产与阵容 |
| PUT /me/lineups/:id | ownedCardIds + expectedRevision；验证持有权、五槽顺序/唯一占用；当前沿用任意职业可落位，职业标签是推荐，见 [阵容规则](../engineering/lineups.md) |
| POST /me/cards/:id/upgrade | 目标卡、expectedRevision、expectedEconomyVersion、Idempotency-Key；服务端算成本 |
| POST /me/cards/craft | playerDefId、expectedRevision、expectedEconomyVersion、Idempotency-Key；服务端验证未持有并算碎片成本 |
| GET /me/matches | 分页战绩；私有完整事件只对本人/获授权管理员开放 |
| POST /matches/tickets | 验证登录/封禁/阵容，生成短时一次性房间票据 |
| GET /me/active-match | 仅返回自己仍可恢复的比赛与重新入场方式 |
| POST /matchmaking/entries | 模式、阵容 revision、协议版本；同用户同模式不重复排队 |
| DELETE /matchmaking/entries/:id | 取消队列；与匹配成功的竞态有明确结果 |
| GET /announcements /config/manifest | 版本化公告和非秘密配置 |
| GET /me/mail /me/tasks /me/achievements | 服务端进度；领取用 POST + 幂等键 |
| /admin/* | ADM 对应查询与动作，RBAC、审计、分页、理由必填 |

关键响应统一：

```ts
type ApiResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string; retryable: boolean }; requestId: string };

interface UpgradeCardRequest {
  expectedRevision: number;
  expectedEconomyVersion: string; // 对比当前生效价格版本，不能用历史低价升级
  // 不接收客户端提供的 price / resultingLevel / balance。
}
```

建议状态码：400 结构错误、401 未登录/会话失效、403 无权限/封禁、404 不存在或无权得知、409 revision/幂等冲突、422 业务不满足、429 限流、503 临时依赖故障。统一错误码与 UI 文案映射；不把 SQL/堆栈直接给用户。

## 4. 会话与登录规范

1. 注册：邮箱归一化策略固定、唯一约束、Argon2id 密码 hash；参数通过部署硬件测定并记录，不能手写加密算法。
2. Web：refresh Cookie 为 HttpOnly、Secure、明确 SameSite；跨站写操作验证 Origin/CSRF；CORS 仅允许配置中的站点，不能凭 Origin 无条件反射。
3. access token 目标寿命 10–15 分钟，refresh 最长 30 天是初始策略，ACC-03 按风险与体验验证。token 包含 iss/aud/sub/sid/exp/jti，校验算法白名单与签名；不可只 decode。
4. refresh 原子旋转：保存 hash、family、撤销状态；重用旧 token 处理和多标签页并发刷新策略必须设计。可通过客户端 single-flight 与服务端短窗口幂等响应处理，不能把正常并发无条件当盗号。
5. App refresh 使用 Keychain/Keystore；微信本地存储不是安全硬件仓，服务端限制有效期、设备会话与可撤销范围。生产不能把 Web refresh 放 localStorage。
6. 微信 code 交换只在服务端调用官方接口；校验 appId 来源，openId 按应用区分，unionId 只有在实际满足开放平台条件时用于关联。
7. 房间票据只授权特定用户/模式/阵容版本/房间，短时、一次性、有 nonce；原子消费，验证并发重放。不要在 URL 查询参数暴露长期 access token。
8. 每次进入房间绑定 userId；重连仍查用户封禁/会话撤销与本场参与资格。seatToken 不成为绕过账号校验的后门。

## 5. 持有权、升级与乐观锁

升级服务的事务顺序：以稳定顺序锁定用户资产和卡牌；校验持有权/revision/等级上限；对比 expectedEconomyVersion 与当前生效价格版本，冻结该版本算成本；扣余额、升级、追加流水、写幂等结果及 outbox；一次提交。失败全部回滚。历史比赛奖励使用可信 outcome 绑定的历史版本；升级/合成不能请求旧版低价。BAL-05 纯规则与后续账本接入约束见 [economy.md](../engineering/economy.md)。

示意代码不是可复制即上线的完整实现：

```ts
async function upgradeCard(cmd: UpgradeCardCommand): Promise<UpgradeResult> {
  return database.transaction(async (tx) => {
    const prior = await intents.findForUpdate(tx, cmd.userId, cmd.idempotencyKey);
    if (prior) return requireSamePayloadAndReturn(prior, cmd);
    const card = await cards.lockOwned(tx, cmd.userId, cmd.ownedCardId);
    requireRevision(card.revision, cmd.expectedRevision);
    const cost = economy.upgradeCost(card, cmd.economyVersion);
    await wallets.debitChecked(tx, cmd.userId, cost);
    const updated = await cards.incrementLevel(tx, card);
    const ledger = await ledgerRepo.append(tx, debitForUpgrade(cmd, cost));
    return intents.saveResult(tx, cmd, { card: updated, ledger });
  });
}
```

示例中的辅助函数都必须在 DAT 任务中实现。处理行不存在、死锁重试、重复键竞争、超时、DB 返回 bigint 序列化；重试次数有界，不无限重发扣款。

## 6. 可靠对战结算

目标：同一场比赛只能产生一个权威结果；奖励至少一次投递但效果恰好一次。不宣称网络中“消息恰好送达一次”。

1. 房间串行裁定最终结果，先形成含 matchId/finalSeq/configVersion/参与者快照的 outcome。
2. 在事务中持久化 outcome、match 状态及 outbox。**持久化成功后**才发送“已结算”消息和清理恢复数据。
3. DB 暂不可用：保留 `settlement-pending`，使用有界重试/持久化恢复路径；UI 显示结算处理中。不能先删快照再期待内存补发。
4. 消费者以 matchId 锁定结算，检查 payload hash；计算服务端奖励，写奖励唯一记录、钱包、流水、排位变动及用户事件，一次事务提交。
5. 重启扫描待结算 outbox；同一结果重复提交返回原结果，冲突结果报警；结算失败可重试，禁止后台人工重复补发。
6. 同一用户同时多场时积分/钱包仍正确；事务死锁按明确策略重试。广播失败不回滚已经提交的奖励，客户端查服务端最终状态。

```ts
async function settleOutcome(outcomeId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const result = await outcomes.lock(tx, outcomeId);
    if (result.settledAt) return;
    await rewards.applyOnce(tx, result); // 唯一约束 + 事务；不是先查后写的内存锁
    await ratings.applyOnce(tx, result);
    await outcomes.markSettled(tx, result.id);
  });
}
```

上面展示最终架构。NET-04 先落地非排位模式时，可以按已启用模式只结算资产；MM-02 完成后再接入真实 ratings service。不能用空的 `applyOnce()` 冒充已实现排位，也不能在排位已开放时跳过积分。

## 7. 对战协议演进

保留原 shot intent 的 matchId、turnId、clientShotId、configVersion 校验。扩展账号授权和 outcome 状态使用新协议版本，明确兼容窗口，不直接删除旧字段让缓存客户端崩溃。

- 去重表按 matchId+userId+clientShotId 唯一；重试相同载荷返回已接受的 seq，异载荷拒绝。
- 服务端帧记录目前为毫米整数坐标，30 Hz；客户端渲染帧率不改变规则。流量优化先测消息大小再分片/压缩，分片有 sequence、大小与时限上限。
- 随机种子不发给仍在比赛中的对手；回放公开范围/技能隐私另行定义。
- 配置切换只影响新比赛；现有局绑定旧配置。旧版本无法恢复时明确报错/补偿策略，不静默按新数值复算。
- 刷新/杀进程恢复通过登录查询自己的 active match 获取短时重入票据；不会依赖原来的 JS 内存对象仍存在。

## 8. 本地存档迁移

`localStorage` 资料/等级不构成可信资产。DAT-05 只允许迁移设置、可校验的阵容偏好和昵称草稿；卡牌/余额/等级由服务端初始策略产生。导入具备标记与幂等性，不能刷新页面重复获得新手奖励。保留本地练习模式，明确与正式账号资产隔离。
