# FLD-07 验收记录

完成仅开发入口的几何/弹簧法线/原图锚点/相机轴与世界拖拽检查工具；补齐视口矩阵、独立截图和生产调试隔离。原物理尺寸、数值和玩法保持。

实际验证：`npm run check`（34 unit/4 contract）、`test:field` 15/15、`test:physics` 18/18、完整build通过。最终Chromium13 PASS/0SKIP/0FAIL/0JS错误，含真实鼠标/触屏弧线、画质切换、后台丢弃旧回放、释放，以及实际生产页面可进入比赛且不含调试句柄/调试HTML。

`tools/field-capture.mjs`实际生成：18格所有皮肤双视角叠加；9皮肤×2视角×4尺寸×DPR1/3共144项DOM/Renderer拖拽检查，最大意图误差1.8763e-14；四种规范尺寸×双方视角8张独立截图已逐一查看。文件在field-calibration/。本轮资源循环15次仍全部释放，heap差420712字节（观测值）。变换误差与独立美术测量误差保持区分，不冒充真机或商业美术审核。

生产自动化改用独立work/test-client测试产物；正常dist/client不暴露调试句柄，开发HTML不在构建主入口。程序化资源hash补绘制依赖，更新catalog/来源清单。工具自启独立Vite并清理；报告、版本和复现方式见 `docs/engineering/field-geometry.md`。
