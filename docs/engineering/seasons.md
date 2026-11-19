# MM-03 · 赛季重置与历史榜（seasons-1）

版本：2026-11-19 / seasons-1（engineering-default）。适用：`server/matches/seasons.ts`、`packages/persistence/src/seasons.ts`、`config/seasons.json`、迁移 `202611180020_seasons`。依赖 MM-02 ratings 与 DAT-04 账本。

## 赛季时钟

`config/seasons.json` 配置有序、不重叠的赛季窗口（id/startsAt/endsAt）。`SeasonService.currentSeason(nowMs)` 按服务端时钟取半开区间 `[startsAt, endsAt)` 内的赛季；无匹配返回 null。Ratings 经可选 `currentSeason` provider 用当前赛季（回退 `RATINGS_CONFIG.season`），故积分 provisioning/结算/本人查询都落在当前赛季。

## 切季 job（幂等）

`runJob(nowMs)` 单事务：upsert 赛程 → 对每个 `endsAt <= now` 且未关闭的赛季执行 `closeSeason` → 标记当前赛季 active。`closeSeason` 先以条件 UPDATE（`status<>'closed'`）锁赛季行作为并发闸门（重复/并发 job 只有一个真正关闭），再：

1. **冻结历史榜**：读该赛季两池 standings，按最终积分算段位与奖励，append-only 写入 `season_history`（不可变触发器）。
2. **赛季奖励**：按最终段位定额金币（`tierRewards`），经 `Assets.grantInTransaction` 走账本，reason `season.reward`，`operationId=season:{id}:{scope}:{userId}`、`sourceId=season:{id}:{scope}`（含 scope 区分双池）；`season_rewards` 主键 + 账本 operationId 双重幂等。
3. **软重置**：`softResetPoints(points, floor, factor)=max(floor, floor+round((points-floor)*factor))`，默认 factor 0.5；以 `ON CONFLICT DO NOTHING` 写入下一赛季初始行，不覆盖新赛季已存在的行。

失败整体回滚（含 close 标记），重跑安全；并发由赛季行锁串行化。job 启动时跑一次并每 60 秒跑一次（`start/close`）。

## 跨季口径（明确）

- **配对**：队列入队冻结 `rating_season` 快照，配对要求同 scope+season（MM-01/MM-02）。
- **结算**：积分按**结算消费时的当前赛季**计入（Ratings provider）。跨季比赛（S1 开始、S2 结算）计入 S2。这是有意默认，文档明确；若改为「按开赛赛季」需把赛季固化进 outcome，留作后续细化。
- 历史榜只读冻结快照；当前赛季历史榜为空（活榜走 MM-02 `/ratings/leaderboard`）。

## API

- `GET /api/v1/seasons`：公开，赛程与状态（scheduled/active/closed + closedAt）。
- `GET /api/v1/ratings/history?season=&scope=&limit=&cursor=`：公开，冻结历史榜，keyset 分页，最小身份（nickname/points/tier/wins/draws/losses）；未知赛季 404，非法 scope/缺 season 400。

## 默认决策（engineering-default，待老板确认）

软重置 factor 0.5；段位奖励青铜 0/白银 200/黄金 500/铂金 1000/钻石 2000 金币（建议值，非确认经济）；赛季窗口示例 season-1 2026-11-01→12-01 等。真实赛季日历与奖励额度属产品/经济决策，放量前需确认。

## 验证

- 单元 `tests/seasons.test.ts`：软重置/配置反例（重叠/重复/非法窗口/factor 越界）/时钟边界。
- 集成 `tests/seasons.integration.test.ts`（真实 PG）：故障回滚后重跑发奖一次、冻结+软重置+按段位发奖、重复与并发 job 不双发不双重置、跨季结算落当前赛季、历史榜分页/最小身份/404、赛季列表与历史 API 公开且校验输入。
- 生产冒烟 `work/mm03-smoke.ts`：dist+startRuntime，当前赛季 active、活赛季历史榜空、missing 404。