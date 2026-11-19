# MM-06 · 练习 AI 难度与离线隔离

版本：2026-11-19。适用：`shared/ai.ts`（BAL-04 核心）、`client/src/localHost.ts`、`client/src/game.ts`、`client/src/matchScreen.tsx`、`packages/platform/src/decision-broker.ts`、`config/ai-policy.json`、`tools/ai-strength.ts`、`tools/ai-latency.ts`。

## 三难度（可观测差异）

`chooseShot(state, data, level, seed, options)`：easy 从 top-5 随机取一+较大角度噪声；normal 取最优+小噪声；hard 取最优+更多 refine（refineN=5）。同一固定 state/seed 下 easy 与 hard 选择不同（单测断言）。`tools/ai-strength.ts` 固定 seed 自对弈（6 seed×9 matchup）输出各难度胜率/平均杆数代理强度报告（`reports/ai-strength.json`）；`tools/ai-latency.ts`（BAL-04）输出 p50/p95/max 耗时。两者均注明是 CPU 代理度量，非真机/人类平衡结论。

练习屏菜单新增「电脑难度」选择（easy/normal/hard），持久化 `pz_ai_level`，`PracticeMatchScreen` 读取作为初始难度；`LocalHost.setAiLevel` 更新难度与 bot 席位名（电脑（简单/普通/困难）），GameView 同步刷新 HUD 对手名。

## 有界计算与后台暂停

AI 经 `DecisionBroker`：每局一个有界 worker，`budgetMs`（750）+`maxEvaluations`（95）+`workerDeadlineMs`（1500）超时 terminate；`cancel()` 终止 worker，迟到回调不能复活旧 job。`chooseShot` 的 `isCancelled`/`budgetMs`/`maxEvaluations` 产生 cancelled/budget/evaluations reason，绝不无限计算、不改权威状态。

`LocalHost.setBackground(hidden)`：隐藏时 `cancelAi()`（generation++、清 botDelay、broker.cancel）并暂停 bot 调度；`turnStarted` 在 backgrounded 时不调度 bot；恢复可见时若轮到 bot 则重新调度。GameView.suspend/resume（由 platform lifecycle 的 pagehide/pageshow 触发）调用 `host.setBackground?.(true/false)`。**后台不继续无限计算**。

## 离线隔离与机器人标识

练习用 `LocalHost`（本地权威，practice 模式 `ratingScope=null`、`rewardScope=null`），不调用任何账号/积分/结算 API——**离线胜负不进正式榜**。bot 席位 `isBot:true` 且名含「电脑（难度）」。联机匹配（MM-01/04）只配真实玩家，**不无提示替机器人**；若未来引入联机机器人须明确标识并分离奖励（当前未引入）。

## 验证

- 单元 `tests/ai-practice.test.ts` 8 项：难度差异、零预算/取消/评估上限 reason、fallback、practice 无积分/奖励 scope+bot 标识、难度可切换+标签、后台暂停 bot 调度。
- 浏览器 `tools/ai-practice-browser.mjs`：React 练习屏难度选择默认 normal、改 hard 持久化+HUD 标签更新、pagehide/pageshow 无页面错误。
- 强度/耗时报告：`tools/ai-strength.ts`、`tools/ai-latency.ts`。