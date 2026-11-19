# MM-04 · 等待策略与异常比赛（queue-2）

版本：2026-11-19 / queue-2（engineering-default）。适用：`config/matchmaking.json`、`packages/contracts/src/matchmaking.ts`（effectiveWindow）、`server/matches/matchmaking.ts`（pair/response）、`server/matches/insights.ts`、`server/api/insights.ts`。

## 逐步扩窗（有上限）

策略新增 `windowStepMs`/`windowStepDifference`/`windowMaxDifference`（默认 0/0/缺省=关闭，queue-1 兼容）。queue-2：base 200、每 30s +100、上限 800。

入队行冻结 `rating_window=base` 与 `created_at`（MM-01 不可变触发器禁止改行），因此**扩窗在配对时按 `clock_timestamp()-created_at` 计算**，不改行：
`effective = min(cap, base + floor(elapsedMs/stepMs)*stepDiff)`（stepMs/stepDiff>0 时）。配对条件用双方 effective 的 LEAST。`effectiveWindow(policy, base, elapsedMs)` 是同一公式的纯函数（单测+response 复用）。

`QueueStatus.wait`（仅 ranked/growth 排队中）暴露 `elapsedMs/currentWindow/maxWindow/nextExpansionMs`，供 UI 反馈等待与扩窗进度；到顶 nextExpansionMs=null。取消沿用 MM-01 原子取消。

## 异常比赛统计（只读、不封禁）

`MatchmakingInsights.analyze(userId)` 读 `match_participants ⋈ match_outcomes ⋈ profiles`（窗口默认 30 天、样本上限 100），统计胜/平/负/认输负/掉线负/服务器故障，并按对手聚合重复次数。advisory flags：
- `frequent-surrender`：样本≥minSample(5) 且认输负率≥surrenderThreshold(0.5)。
- `repeat-opponent`：某对手次数≥repeatThreshold(5)。

**结构上无封禁端口**：服务只读、不写 users.status，误判不可能造成不可逆处罚。阈值是 engineering-default 建议值，正式处罚策略（若需要）属产品决策，另行设计。

**服务器故障 vs 掉线**：`server-fault` 结果作废（winner -1，不计负），`disconnect` 判负（forfeit）——沿用 NET-04 `classifyModeOutcome`，统计中分别计数 `serverFaults`/`disconnectLosses`。

## 不替机器人

队列至今无机器人替补；friend/ranked/growth 均要求真实兼容对手，无兼容对手时保持可解释等待（MM-01）。本任务不引入无提示机器人。

## API

`GET /api/v1/me/matchmaking-insights`：登录 + X-Account-Id 目标校验，返回本人统计；匿名 401、目标不符 409。`GET /api/v1/matchmaking/options` 暴露 queue-2 策略（含扩窗参数）。

## 验证

- 单元 `tests/waiting-strategy.test.ts`：effectiveWindow 关闭/扩窗/上限/默认回退；策略 schema 反例。
- 集成 `tests/waiting-strategy.integration.test.ts`（真实 PG）：扩窗后远对手配对、上限永不越界、wait 估计扩窗到顶、频繁认输 flag 不封禁、重复对手+服务器故障/掉线区分、insights API 鉴权。
- 回归：matchmaking/matchmaking-rooms/matchmaking-http 28/28（queue-2 + pair SQL 改动无回退）。