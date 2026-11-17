# BAL-03 验收记录

集中13项实现技能、7种effect的trigger/叠加/持续策略，并让配置schema按此校验；补结束态不再抽技能/跳过/改写胜负，以及权威出手入口的合法性保护。保持当前概率、效果数值和有效行动顺序。

实际验证：`npm run check` 通过（46 unit/4 contract）；新增7项技能组合和1项真实SDK重连验证。组合覆盖六种preturn buff、最强光环与固定体、额外行动上限/所属方计数、多目标送离/冻结及归场、禁区/首次触球加速、进球/超时/终局保护。真实SDK创建对局后断线并凭座位凭证重领，持久MatchState及服务器RNG逐值不变，resume RNG=0，不重抽技能。

固定seed42真实beginTurn实验10000次触发2022次，目标20%、观测20.22%，Wilson95%区间19.444%–21.019%；两次独立重复结果一致，声明±2个百分点测试容差。报告在skill-rules.json，来源/生命周期见 `docs/engineering/skills.md`。

`npm test` physics18/18、net176/0，完整build通过。原技能参数、GameData内容hash和全卡基础映射快照不变。71名源技能未实现的球员继续显式标记；不把这次规范化描述为恢复了未知效果。
