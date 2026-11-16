# T4-c 侦察结论（落盘，供续接；来源：runs/_t4c_probe{,2,3}.out.txt）

## 源数据事实
- skill_records.json：511 行，16 键固定顺序 `version,skill_id,name,level,rarity,extra,trigger_condition,conditions,probabilities,target,effects,values,duration,stacks,description,icon`；level/rarity/duration/stacks 为 number（rarity 有 12 个 null），其余 string。
- 主键 `version|skill_id`：1.2.0=214、1.5.5=297，distinct skill_id=297；两版本共有 214 个 id。
- 技能等级用 `level` 字段，不能由 id 推（250/252/254 为主、251/253/255 为 extra）。
- skill_links.json：547 行，547/547 经 `version|skill_id|skill_level==level` 连上记录，名字全一致；类型 1.2.0 普通 195 / 1.5.5 普通 321 / 1.5.5 闪卡天赋 31；unlock 3/6/10（天赋 0）；57 条记录无 link。
- extra 非空 33 条；description 空 33 条；rarity null 12 条（251/253/255、281/283/285 两版本）。
- 短行（effects/values 长度不等）3 条：1.5.5|770/771/772 勇往直前 e=2;3 v=5/10/15 → 不补齐，标 unimplemented。
- 概率表长度 vs 条件表长度：1vs1 235 / 2vs2 126 / 3vs3 126 / 4vs4 12 / **1vs2 12** → 原样保留并列出，不补、不相乘。
- tc==cond[0] 397 / 不等 114。
- 跨版本差异（214 对）：duration 27、description 15、tc/conditions/probabilities/rarity 各 6、name/icon 各 3。

## 码表（仅由中文描述归纳，basis=inferred-from-description，绝非 recovered）
- effect：2 重量；3 力度；4/11 都描述为精准（冲突；11 的 targetTip=precision_up）；5 出场；6 再移动一次；7 撞墙眩晕；8 不被撞动；9 失明；10 混乱；12 出场免疫；13 失明免疫；14 混乱免疫；17 凌波微步概率+；18 属性降低免疫；19 抵制出场；1 未知（1;2;3;4 组合描述为全属性）。冲突：1.5.5|740-742 横冲直撞 e=3 v=1 描述为撞墙眩晕。
- condition：14 我方回合开始；19 对方回合开始；2 在对方半场；10 在我方半场；18 对方半场只有他；22 被动天赋；3 触球/弧线射门（歧义）；4 未碰触；5 移动时；6 撞击对方；7 撞墙；11 射门；8/9/12/15/16/17/20/21 未知。
- target：0 全体己方；1 自身；2 对方全体；3 被撞对方球员；4 我方半场的己方球员；8 我方半场内的对方球员；9 对方半场内我方球员；6 对方半场内的对方球员；10 未知。
- duration：原始计数；d=2≈一回合、d=4≈2回合，但存在 d=3 一回合、d=5 2回合 → 未确认，保留原值；999 常驻；1 本回合/持续。

## 可推导（implemented）子集
- (A) 位置被动属性光环 attrAura：tc∈{2,10}、conditions==tc（单项）、probabilities=="100"、effects⊆{2,3}、len(values)==len(effects)、duration 1、stacks 1、target∈{0,1,2,4,6,8}；描述须含半场词（2→对方半场，10→我方半场）+属性词+|v|%+方向词+目标短语；extra 子记录对照父记录描述；父记录仅当 extra 也可推导时才 implemented。
- (B) 防守定身 anchor：tc=19、c=19、e=8、t=1、d=1（不动如山家族），概率=triggerPerList[0]/100，接现有 defense/anchor。
- 其余全部 unimplemented 并给 reason code：天赋 tc=22、精准/心智 4/11/1、依赖 duration 或事件条件、未知条件/目标码、短行、描述不符、740 冲突。

## 运行时规则（复刻规则，带版本号）
- 百分比作用在属性点上、attrmap-1 插值前：`attr * max(0, 1 + sum/100)`，沿用 [0,1] 截断。
- 不同技能加法叠加；同名技能对同一目标至多一次（overLaps=1）；出场球员不计；位置在出手 setup 时判定。
- 持有者条件：tc=10 持有者在己方半场；tc=2 持有者在对方半场。
- 源技能等级 k 生效条件：卡等级 ≥ unlock[k-1]（3/6/10）；默认 Lv5 → 技能 Lv1。
- p01–p05 保留重建技能（def.skill 命中 skills 优先）。
