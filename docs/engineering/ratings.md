# MM-02 · 积分与排位结算（ratings-1）

版本：2026-11-19 / ratings-1（engineering-default）。适用：`server/matches/ratings.ts`、`packages/persistence/src/ratings.ts`、`packages/game-core/src/ratings.ts`、`config/ratings.json`、迁移 `202611180019_ratings`。

## 规则口径

- 简单固定 K Elo：`expected = 1 / (1 + 10^((opp - me) / scale))`，`delta = round(K * (actual - expected))`，`actual` 胜 1 / 平 0.5 / 负 0。
- 参数（`config/ratings.json`，版本化、冻结快照）：初始 1000、下限 0、K=32、scale=400、当前赛季 `season-1`。段位阈值：青铜 0 / 白银 1100 / 黄金 1250 / 铂金 1400 / 钻石 1600。
- 下限钳制反映进记录的 delta（`delta = after - before`），因此账本始终与存储积分对账；零和只在远离下限时成立，这是有意的边界取舍。
- 只对「服务端权威 + 已落盘 + 账号已验证 + 非作废」的结果计分（复用 `classifyModeOutcome`）。认输/断线判负（forfeit）计分；abandoned/server-fault/shot-limit 作废不计分、不创建积分行。平局双方 delta 0 但计一次 draws。
- ranked 与 growth 是隔离积分池（scope），互不影响；好友赛（friend）无积分池。
- 赛季：MM-02 冻结单一当前赛季；结算按消费时的当前赛季写入。跨季比赛口径、软重置与历史榜归 MM-03。队列入队时冻结 `rating_season` 快照，配对 SQL 要求同 scope+season 且分差 ≤ 策略窗口（queue-1 为 200）。

## 幂等与并发

- `rating_applications` 以 `(match_id, user_id)` 为主键，BEFORE UPDATE OR DELETE 触发器禁止改写/删除（append-only 审计）。
- `applyInTransaction` 先查该 match 是否已应用，已应用直接返回；否则按 userId 稳定顺序 `INSERT ... ON CONFLICT DO NOTHING` + `SELECT ... FOR UPDATE` 锁积分行，再用**赛前**积分计算双方 delta，同事务写应用记录与积分/胜平负/version。整体在 NET-04 结算事务内，失败整体回滚，重试不会半应用。
- 同用户多场并发结算由行锁串行化；乱序消费按消费顺序逐场应用，每场都留审计行，不丢更新。
- 队列读取端口 `readForQueue` 在入队事务内幂等 provisioning 当前赛季初始分，返回真实服务端积分；客户端提交的分数永不进入分组。

## API

- `GET /api/v1/me/rating`：登录 + `X-Account-Id` 目标校验；返回本人两池积分/段位/胜平负/version。
- `GET /api/v1/ratings/leaderboard?scope=&season=&limit=&cursor=`：公开只读；keyset 分页（points DESC, user_id），不透明 base64url 游标；条目仅含 nickname/points/tier/wins/draws/losses，不暴露 userId/邮箱/会话。非当前赛季返回空榜（历史榜 MM-03）。非法 scope/游标 400。
- 契约见 `packages/contracts/src/ratings.ts` 与 OpenAPI（`docs:contracts`）。

## 生产门槛

runtime 已装配真实积分端口（结算 + 队列读取），但 `MatchmakingQueue.enabledModes` 生产仍为 `['friend']`：排位/成长入口在「积分展示 UI + 发布决策」就绪前不开放（MM-01 交接门槛）。测试通过选项启用 ranked/growth 验证完整链路。开放排位是产品发布决策，需老板确认，不由代码默认打开。

## 验证

- 单元 `tests/ratings.test.ts`：Elo 对称/胜负平/下限钳制/段位边界/配置反例。
- 集成 `tests/ratings.integration.test.ts`（真实隔离 PostgreSQL）：胜负结算与审计行、平局/认输/作废、重复与直接重放幂等、乱序对账、同用户 6 并发行锁串行 + 3 并发消费者结算、SQL 触发器故障回滚后重试一次、growth/ranked 隔离、队列真实积分/分差/赛季分组、榜单排序/分页/最小身份/游标反例/越权 401/409。