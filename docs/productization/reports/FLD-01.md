# FLD-01 验收记录

提取纯核心 FieldGeometry/fieldSegments/insideField，保持 shared/physics 兼容重导出；shared/data 导入时使用严格 schema 校验几何及九套皮肤。几何仍为 6×9.78 m，门宽/深 2.05/0.4 m，所有数值及原始 data 文件保持原样。字典、测量/重建标签及后续变更要求见 `docs/engineering/field-geometry.md`。

实际验证：`npm run check` 通过（19 unit、4 contract）；新增两项覆盖九套皮肤、16 段边界双端对称和非法比例/尺寸/裁切/未知字段/皮肤碰撞覆盖反例。`npm run test:physics` 18/18，其中240次固定种子随机出手无穿墙/越界/重复进球，30场完整规则比赛正常结束。`npm run build` 通过。配置内容 hash 未变，资源扫描无漂移。
