# FLD-04 验收记录

完成四角特殊接触和门后移位验收：弹簧待加力按球员+角号单步去重；移位沿既有邻近策略寻找空位，补几何可容纳检查、有界确定后备搜索和无位置明确失败。补 spring-kick/relocate 严格表现事件契约。不调整既有物理数值。

实际验证：`npm run test:field` 11/11；四项新增场景覆盖四角逐一、低速/超速/足球/静态体、冻结/锚定移位无重叠、拥挤/不可能布局，以及真实 resolveShot 进球复位和失球方开球。`npm run check` 通过（28 unit / 4 contract）。`npm test` 物理18/18、net176/0；`npm run build:server` 通过。配置hash与原始参数不变。详见 `docs/engineering/field-geometry.md`。
