# BAL-01 验收记录

新增完整GameDefinitionsSchema及跨表引用/范围/概率/时序/容纳校验，shared/data实际加载时执行，候选physics也验证。PhysicsConfigSchema提到纯contracts保留旧重导出。未知技能不再当合法定义静默忽略，none/unimplemented为显式状态。

完整源表校验2250行：运行时1060行、参考1190行逐个值/ID/元数据/缺失与多余行均相符；117球员来源完整（106原等级表、11重建），活跃域21–119，13项实现技能、71名源技能未实现、30名无技能。确定性报告见balance-data.json，旧40–99、p01–p05旧导入说明的矛盾见 `docs/engineering/balance-data.md`。没有修改原始表、数值、奖励或玩法。

实际验证：`npm run check` 通过（36 unit/4 contract，新增2项含多类损坏反例及真实全表校验）；`npm test` 物理18/18、net176/0；完整build通过；Chromium13/0skip/0JS错误通过。check/build都执行真实导入验证。新测试构建产生的work/输出按已有gitignore用途加入ESLint生成目录排除，未放宽源码规则。

71项源技能未实现保持明确，不伪造原版效果或将数值导入等同于平衡完成。后续UI/正式模式必须处理可用卡池边界。
