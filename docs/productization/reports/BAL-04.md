# BAL-04 验收记录

新增可取消/限候选/软预算的共享AI，保持默认无预算27项旧输出逐值一致。实际LocalHost接独立Worker broker，校验requestId+generation+shotNo/turn/dataVersion，取消等待/作业，超时/失败/无法创建Worker使用廉价合法出手，无可动球员正式passTurn。认输、到时、退出不会再应用旧结果；apply临时状态成功才提交。

实际验证：`npm run check` 54 unit/4 contract通过（新增8项预算、broker和LocalHost异常/生命周期测试）；`npm test` physics18/18、net176/0；完整build通过；Chromium13/0skip/0JS错误通过，含真实AI轮转与生产无调试HTML/句柄。

正式ShotRunner `calibrate --check`测量10项原目标全部通过，保留phys-4与所有目标，检查命令现在遇越界会非零。docs/calibration更新为本次测量，无物理参数修改。

`npm run ai:bench`：原实现27项输出一致；三难度各9固定局面，预算版p50约149.3/150.1/167.6ms，p95/max158.5/189.3/185.2ms，0预算耗尽。原始场景、逐项输出、时延、硬件、版本和样本限制保存在ai-baseline/ai-latency.json。不同批次JIT/缓存影响不作为提速比例。

原有完整AI对战基准16场已实际执行，结果见ai-strength.txt；这是小样本代理实验，不能宣称真人平衡。

`test:ai-browser`使用真实持续计算Worker：按1500ms政策约1501ms终止，期间91次RAF和按钮响应；取消通过。真实冷游戏Worker1181ms完成，搜索752.3ms/63候选触发软预算，返回合法出手，3/3 Worker释放，0JS错误。原始browser.json在ai-runtime/；不把本机结果冒充手机认证。独立开发ai-debug入口未进入生产构建。复现与限制见 `docs/engineering/ai.md`。
