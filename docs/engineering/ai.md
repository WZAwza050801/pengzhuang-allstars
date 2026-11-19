# AI 决策预算和取消

共享AI保留原候选评分与固定seed选择。无预算chooseShot与5179e6b的27个固定局面/难度输出逐值一致；既有出手、碰撞、弧线参数不变。可选maxEvaluations/budgetMs/now/isCancelled/onStats在候选之间检查，预算耗尽时使用已评分最优候选；一项都没算时用最近合法球员直接朝球出手，无可行动者返回null。fallback不模拟、不抽权威技能RNG。

`config/ai-policy.json`初始策略：600ms表现等待、750ms搜索预算、1500ms整项Worker截止、最多95次模拟。easy/normal原完整搜索至多83次，hard至多95次。750ms是本次工程初值，不是全部手机认证指标；某一候选可以略超软预算，独立Worker硬截止兜底。政策版本ai-policy-1与比赛物理版本分开记录。

`createDecisionBroker`注入Worker端口，封装请求ID、截止、取消及清理。一项一个Worker，成功/失败/超时/取消都结束Worker并移除监听/定时器。LocalHost另校验shotNo/turn/dataVersion和generation；认输、到时、下一行动或退出取消旧作业和600ms等待。异常/超时/无法创建Worker回退廉价合法出手，无可行动者正式passTurn，不永久等待。实际apply在临时状态上解析，成功才提交，避免异常污染状态。搜索从不放到主线程。

Worker返回AiReplySchema的epoch/input/stats，LocalHost重新验证出手；客户端预测不控制服务器账号或奖励。当前是离线练习的决策管线，MM-06接服务端机器人时必须另行使用持有阵容/房间权威边界。

| 本次同机固定局面测量 | p50 ms | p95/max ms | 样本 |
|---|---:|---:|---:|
| 预算版easy | 149.3 | 158.5 | 9 |
| 预算版normal | 150.1 | 189.3 | 9 |
| 预算版hard | 167.6 | 185.2 | 9 |

原始时延/局面/输出/硬件在ai-baseline.json和ai-latency.json；`npm run ai:bench`重测并验证27项旧结果。测量按批次有JIT/缓存影响，不能把先后两批耗时差描述为算法提速，9样本的p95接近最大值，也不能推断真人强度或移动设备帧率。浏览器冷Worker另记录导入/启动与实际搜索耗时，不与Node热运行混算。

旧 `node --import tsx tools/ai-bench.ts`完整16场基本检查也执行：normal/random 6胜、easy/random 6胜、hard/normal 4胜；原始比分/杆数/耗时见ai-strength.txt。这是固定少量AI代理样本，先手与对手策略有偏差，不能据此宣布真人平衡。

`npm run test:ai-browser`自启开发Vite和Chromium，创建持续计算Worker验证截止/取消，并检查主线程RAF和按钮响应，再执行真实游戏Worker请求并验证输入/epoch，全部释放。开发ai-debug.html不纳入发布入口。正常浏览器对局测试还覆盖实际LocalHost的AI轮转和生产无调试入口。

`npm run calibrate -- --check`用正式ShotRunner测10个现有手感目标，更新docs/calibration.{md,json}且失败返回非零；它不修改physics.json。无--check的旧命令会搜索并写物理参数，不能将它当作只读验收。BAL-04保留全部目标和phys-4，不以改目标/物理来让报告变绿。

本次浏览器实际政策截止验证：持续计算Worker约1501ms终止，期间91次RAF、按钮响应正常；真实冷Worker整项1181ms，其中搜索752.3ms、63候选后触发软预算，返回合法当前epoch出手；3/3 Worker释放、0JS错误。752.3ms包含最后一次候选模拟的粒度，截止包含常规事件循环调度误差，不是硬实时承诺。与Node热运行的差异说明启动/JIT成本必须计入平台PoC。
