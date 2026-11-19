# 运行时数值与来源校验

`GameDefinitionsSchema` 校验物理、球员、技能、规则、等级和属性映射的完整组合；shared/data在模块初始化时实际执行。`buildGameData(physics)`同时校验自定义物理候选。PhysicsConfigSchema移到纯contracts，config/game继续兼容重导出，避免客户端依赖Node配置装配。

边界包括有限数、完整1–10级、唯一球员/技能/源ID、存在的技能/等级/初始阵容引用、合法概率/倍率、触发与effect组合、状态持续时间、阵型边界、固定步长/记录率整除和球体尺寸容纳关系。新增未认识的技能名报错；`none`和`unimplemented`是明确状态，不将拼写错误默认为无技能。缺少原始等级行不回退到重建值。

| 当前口径 | 已核实结果 |
|---|---|
| 运行时球员 | 117 |
| 有原等级表 | 106人×10级=1060行，属性点逐值对应1.5.5普通卡 |
| 无原等级表 | p06–p16，共11人，明确B重建，以attrs+growth逐级推算 |
| 仅参考等级 | 1190行，含旧版本/变体，不被运行时当作基础卡读取 |
| 原始总表 | 2250行，SHA256与导入回执一致，逐项比对全部五属性与行ID |
| 活跃属性域 | attrmap-1：21–119，来源表全范围，不是kg/N/弧度/命中率 |
| 已实现技能定义 | 13项，概率/效果的R/M/B混合来源仍逐字段保留 |
| 明确未实现的源技能球员 | 71，未凭名称自动绑定重建效果 |
| 明确无技能的球员 | 30 |

报告中R仅指等级表数值有原始记录，不代表技能效果、属性映射公式或商业权利都已恢复。p01–p05保留的attrs/growth和旧来源文档部分措辞是历史导入元数据，**当前运行时也从原等级表读取它们**。players.json.mapping的40–99不再参与运行；唯一活跃映射来自attr-mapping.json，旧值保留供追溯，不悄悄修改原文件。

`docs/roster-mapping.md`、provenance中的runtimeValuesFrom及clamps/negativeGrowth记录来自历史生成器，包含40–99和attrs+growth等过时运行时描述。当前行为以shared/match.levelAttrs、上述校验和 `reports/balance-data.json` 为准；历史导入器会写文件，不应当作只读check运行。BAL-02会冻结全卡等级到物理的实际映射，不能重新套回历史clamp。

`npm run check:balance-data`读取原材料表，仅在Node校验工具运行，前端不读取materials目录。核对2250行原值、ID/重复、缺失/多余导入行、元数据、范围，以及106份球员来源记录中的10级数据。`npm run balance:data`在审查后更新确定性报告。check和正常前后端构建均执行验证；普通源码校验不重写data。负例测试覆盖未知技能/重复ID/断引用/缺级/NaN/越界/非法概率与时序/成长越界。

71项未实现标记必须在后续卡牌UI和正式模式白名单中明确处理，不能借“已完成导入校验”声称这些效果已经实现或已达到真人平衡。没有足够规则证据时不编造原版技能。

## 冻结的属性到物理映射

实现集中在纯 `packages/game-core/src/balance.ts`，shared/match和shared/physics保留旧入口重导出。等级必须是1–10整数且球员存在；有srcId时必须读取该等级原值，无表明确失败。无srcId才按attrs+growth推算并保持原attrMax饱和。返回值是副本；buildGameData生成独立可变校准副本，不能污染后续配置或DEFAULT_DATA。

每个属性各自计算 `n = clamp((points * condition - 21) / 98, 0, 1)`：weight→0.85..1.25质量倍率，power→0.92..1.08速度倍率，radian→0.60..1.40弧线倍率，precision→0.45..1.00预测长度比例。condition必须是有限0..1；状态差默认0.7，关闭状态模式时默认1。mind仅用于状态模式判定，不能串入弧线或精准。

正式出手保持 `9.1956 * speedMultiplier * clamp(power, 0.06, 1)^0.623`；最小力量和归一化饱和是明确的旧行为，不用它们掩盖非法导入（导入schema先拒绝异常）。未知球员/等级、NaN/Infinity、非法状态倍率和缺源行明确失败。

`npm run balance:mapping`生成 `reports/balance-mapping.json`，包括1170卡/等级的原属性、普通/状态差倍率、虚拟kg质量和m/s满力速度，以及技能ID/档位。它是基础属性快照，不含当回合技能buff、己方半场光环或接触加速。`npm run check:balance-mapping`核对冻结结果；相同dataVersion下内容不同拒绝重新导出，需先审查并升级对应数值/规则版本。

提取前在提交30776de保存全117×10×2=2340状态结果，提取后逐值比较完全一致，摘要和SHA256见BAL-02-comparison.json。可从该历史提交重建旧levelAttrs/pieceStats/launchSpeed输出进行独立复核；这不是只比较两个新入口的别名。单测另外以固定21/119域和源字段独立断言全卡映射、source优先于旧attrs（例如p17 Lv1 weight=34而旧attrs为40）、重建p06 Lv10 weight=115、端点/非法输入和副本隔离。
