# BAL-02 验收记录

等级/状态/倍率/出手公式集中到纯game-core/balance，旧入口兼容重导出。补非法输入/缺源行明确失败，返回属性副本并隔离buildGameData校准副本。不改当前attrmap-1/phys-4参数或有效输入的计算结果。

提取前提交30776de的117×10×2=2340组输出，提取后逐值完全相等。SHA256和数量见BAL-02-comparison.json。新增balance-mapping.json冻结1170卡/等级的普通/状态差完整映射；相同数据版本下不同内容禁止重新导出。实际暂时篡改旧snapshot hash后运行导出，非零拒绝，恢复后正常检查通过。

实际验证：`npm run check` 通过（38 unit/4 contract，新增2项覆盖全卡独立公式/字段轴、源表优先、重建fallback、端点/非法输入/隔离）；`npm test` physics18/18、net176/0；完整build通过。最终将可变副本改为已校验JSON的跨平台复制后，再执行4项相关unit、配置hash、typecheck与完整build，均通过。源参数和全GameData hash保持原值。

专项无技能测试fixture同步改为显式none定义，避免删除技能表却保留断引用，未放宽生产校验。说明、单位、基础倍率与当回合技能buff的边界见 `docs/engineering/balance-data.md`。
