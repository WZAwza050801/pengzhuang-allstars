# 已实现技能时序

范围是当前13个定义、7种effect；71名源卡的未实现标记保留，不按名称补造原版效果。`game-core/skill-policy.ts`集中时序/叠加口径，GameDefinitionsSchema据此校验trigger/effect组合，`reports/skill-rules.json`包含逐项概率、来源和固定种子实验。`npm run check:skills`检查，审查后用`npm run skills:rules`更新。

| ID | 触发 | 已实现效果 | 概率Lv1/2/3 |
|---|---|---|---|
| alien | preturn | 本次选中出手速度×1.15、质量×1.5 | .10/.15/.20 |
| fox | onShot | 对方禁区内首次触球，球速×1.35 | .20/.25/.30 |
| king | preturn | 速度×1.1、弧线倍率×2 | .15/.20/.25 |
| rocket | preturn | 速度×1.3 | .15/.20/.25 |
| sendoff | onShot | 撞到的唯一对手离场2个所属方回合 | .10/.15/.20 |
| tank | onShot | 撞到的唯一对手冻结1个所属方回合；球员Lv3解锁 | .10/.15/.20 |
| guardian | passive | 己方半场光环质量×1.3/1.4/1.5；多光环取最大 | 1/1/1 |
| wall | defense | 当前行动锚定，固定体 | .20/.25/.30 |
| cannon | onShot | 首次触球球速×1.3，无禁区限制 | .15/.20/.25 |
| charge | preturn | 当前选中出手质量×1.6 | .15/.20/.25 |
| extra | preturn | 未进球时额外行动，完整所属方回合内最多一次 | .08/.10/.12 |
| flash | preturn | 速度×1.25 | .15/.20/.25 |
| banana | preturn | 弧线倍率×1.8 | .20/.25/.30 |

技能档位沿用球员等级1/4/7；除tank外当前均Lv1解锁。表格整理已有实现，R/M/B来源仍逐字段保留，不能据此称全部效果来自原版。

1. 只在新行动开始调用beginTurn，清理旧ready/anchor，再用服务器RNG判定本方preturn及对方defense；冻结球员不触发preturn，现有defense可与冻结共存，物理固定条件为OR。客户端预测buildShot传rng=null，绝不抽取onShot技能。
2. buildSetup只给实际选中的ready球员加出手质量；半场光环按施法者在场且位于己方半场计算，同侧取最强，与出手buff相乘。冻结仍可保留常驻光环，离场不保留。没有随渲染帧刷新状态。
3. resolveShot先验证合法出手，再抽onShot、模拟、应用结果。接触列表只统计真实命中的不同对手；离场体不在模拟内。freeze按剩余持续时间取最大；sendoff按当前定义设置，离场目标不会再次被碰撞。ballBoost一杆至多一次且验证禁区条件。
4. 状态只在所属方完整回合结束递减。第一次额外行动后不递减，下一杆再结束；extraUsed阻止第三杆。结束所属方回合时离场归零者选合法空位复位并产生唯一respawn事件。超时/主动跳过走同一递减路径。
5. 进球先计分和判胜，再复位所有状态；失球方开球，取消额外行动。结束后beginTurn/passTurn/forfeit/endByTime不再产生事件；resolveShot拒绝再次出手，结果不能被覆盖。
6. 重连直接恢复持久RNG/ready/anchor/frozen/extraUsed，不调用beginTurn。真实SDK测试创建对局→断线→凭座位凭证重领，持久完整MatchState逐值不变，resume中的rng仍为0。凭证/服务器RNG不写日志。

验证含六种preturn buff、光环与冻结/锚定组合、额外行动与所属方计数、同杆多目标送离/冻结及归场、禁区加速、进球和结束态保护，以及真实SDK重连。固定seed42仅启用alien的10000次真实beginTurn实验触发2022次（20.22%，目标20%，Wilson95%区间19.444%–21.019%），声明±2个百分点验收容差，并重复运行确认一致；没有要求短样本恰好等于概率。
