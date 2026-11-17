# 球场几何数据字典

唯一输入为 `data/fields.json.geometry`，版本当前 `field-2`，虚拟米，中心原点、x 向右、side 0 视角 y 向下。`FieldDefinitionsSchema` 在 shared/data 导入时验证完整文件；`packages/game-core/src/field.ts` 是唯一墙/网/弹簧边界生成及圆体可容纳性入口，旧 shared/physics 继续重导出。没有皮肤可以携带自己的 geometry、碰撞半径或门宽。

| 字段 | 当前值 m | 来源标签与依据 |
|---|---:|---|
| width | 6 | B，虚拟米尺度基准 |
| length | 9.78 | M，Scenes_01 内沿 956×1559 像素，比例约 1.63 |
| goalWidth / goalDepth | 2.05 / 0.4 | M，宣传截图开口/网深比例，量化取整 |
| postRadius | 0.07 | B，重建，未声称为原版物理常数 |
| cornerCut | 0.5 | M+B，截图比例 0.06–0.09 场宽，选取 0.083 |
| boxWidth / boxDepth | 2.65 / 1.32 | M，截图禁区比例 |
| smallBoxWidth / smallBoxDepth | 0 / 0 | M，无小禁区，两个零表示关闭 |
| arcRadius / penaltySpot | 0.43 / 0.78 | B，现有标线布局，未单独取得可靠原版测量 |
| centerRadius | 1 | M，约 0.17 场宽 |
| source | 原文件说明 | 参考图路径及量测叙述，不是授权凭据 |

R=原始资料、M=测量、U=用户确认、B=重建。上述标签不提升证据等级，不把代码默认值变成 U。皮肤原图/重建来源仍逐项保留在 fields.json.source；权利见 FND-03。

schema 拒绝非有限数、非正尺寸、横向或超过 3:1 的不支持比例、互相侵占的门/角、越界禁区/中圈/点球点、半关闭小禁区；这个比例范围是工程支持边界，不是原版公式。皮肤拒绝未知字段、重复 ID、非法旋转、反向或超出原图的 crop。渲染与物理共用相同数据，不修改任何现有数值。以后改几何须升级 fieldVersion，同时更新配置哈希、资源清单、校准及物理测试。

`tests/field.test.ts` 断言九套皮肤共用唯一几何、16 段边界两端对称、无退化段和 schema 反例；FLD-03 扩展实际接触与门线行为。`npm run test:physics` 保留完整原校准回归。
