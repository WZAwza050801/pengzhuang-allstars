# 原数据怎样接入游戏

以“梅球王换上场”为例：先在catalog按player_id找到人物、头像和卡牌变体，再在card_records按`version＋card_id`选择卡牌。若本局有等级，按level_records的版本、卡ID和等级取值。选定的数值进入独立的属性映射，变成复刻中的质量和出杆速度。

## 数据入口

| 文件 | 键与内容 | 必须保留的区分 |
|---|---|---|
| catalog.json | player_id、portrait_id、身份状态、头像参考 | 不是每条都有card_id或头像；卡队没有player_id |
| card_records.json | key=`版本\|卡ID`，224行 | 普通卡、闪卡与球员本人的ID不同 |
| level_records.json | 版本＋card_id＋level，2250行 | 有未关联卡牌的历史行，不能静默删除 |
| skill_records.json | 版本＋skill_id，511行 | 同ID跨版本参数可能不同 |
| skill_links.json | 卡牌、技能ID、等级／解锁关系，547行 | 分号列表按原顺序配对，不取笛卡尔积 |
| parameter_conflicts.json | 20个card vs level1冲突 | 运行时优先级没有恢复 |
| reference_tables | 92张表的原字段字符串JSON／TSV | 空串、缺失单元格与0不能合并 |
| field_dictionary.json | 原中文列名与英文键 | 人名所在原始列英文键为空，不要丢掉 |

## 必须由开发AI输出的导入报告

1. 不修改`original/`中的资料。只生成`resolved_roster.json`和`data_import_report.json`。
2. 报告选择的版本、卡牌、等级、来源表、是否遇到冲突及选择理由。首次可暂用1.5.5的`card_attr`等级1作为复刻选择，但须明确这不是已恢复的原版优先级。
3. 遇到待确认身份或没有卡表关联的头像，放在浏览目录，不自动生成可用卡牌。耳帝先保持原名，带冲突标识。
4. 导出所有无法解析的条件码、效果码、duration语义和短行；未实现技能在开发界面显示未实现，不能悄悄当作已生效。
5. 原值必须能逐行追溯到资料包的source_line、版本和源文件。任何属性映射、重平衡或临时规则都有独立版本号。

不把足球现实身价、现实速度、FIFA/EA评分或模型猜测的评级写入原数据列。将来需要它们时另建标为估计的参考表。
