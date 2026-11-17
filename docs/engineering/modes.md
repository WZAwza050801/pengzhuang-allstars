# 模式规则与结果资格

配置：`config/mode-policy.json`；DTO：`packages/contracts/src/modes.ts`；共享解析：`config/modes.ts`；纯等级与结果规则：`packages/game-core/src/modes.ts`。四种模式的具体口径见 ADR-0003。

`rulesForMode(data, mode)` 产生不可变摘要，包含模式、完整数据版本、模式版本、等级策略、技能版本及解锁等级、比赛/回合/重连时钟、断线/作废规则与独立结算命名空间。`verifyModeRules` 对收到或恢复的摘要做结构和完整内容核对；不能仅凭版本字符串或客户端标签认定兼容。`room` / `match_start` / `resume` 共用同一份摘要，网页等待室展示服务端摘要。

`resolveModeLineup` 返回无输入别名的阵容和实际等级。`owned` 参数只供服务端从可信库存读取；给此函数传入数组不等于完成认证。正式模式要求合法持有、等级 1–10、唯一阵容及已实现技能。游客房间在创建时拒绝 growth/ranked，客户端的 owned、mode 或 levels 字段不能绕过该限制。

`classifyModeOutcome` 是结算资格判断，不执行数据库写入。调用者必须从服务端可靠结果构造 evidence；HTTP/WS 不接受该 evidence。结果 DTO 保留 mode、modesVersion、gameDataVersion；ratingScope/rewardScope 只能使用自己的 ranked/growth 命名空间，练习/好友均为空。未知结束原因按作废处理，禁止默认发奖。NET-04 负责之后的可靠落盘、幂等回执及账本事务，MM 负责榜单。

验证：`vitest run --project unit tests/modes*.test.ts`、`vitest run --project contract tests/modes.contract.test.ts`；`tsx tools/mode-pairs.ts --write` 运行固定种子、同阵容交换先手的 8 场冒烟实验。实验采用固定候选数及虚拟决策时间，便于复现；不等价于真人平衡或服务端真实时间实验，1000 场与配置回滚由 BAL-07 完成。
