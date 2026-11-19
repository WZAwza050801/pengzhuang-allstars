# FLD-05 验收记录

统一 fieldArtMapping 的裁切/四向旋转/源图到世界及逆变换，实际接入比赛整场、已裁切图和HUD；保留 fields.json 和物理数值。整图下边线4.52mm缩放误差已修正。大厅五张等距图明确仅展示，不生成独立碰撞尺寸。

实际验证：`npm run test:field` 13/13；`npm run check` 通过（32 unit/4 contract）；完整build及Chromium10/0skip/0error通过。真实浏览器加载全部皮肤并生成18格双方视角叠加、五张大厅图：`reports/field-calibration/skins-both-sides.png` 已查看，墙内沿/门口/四角与核心叠加位置一致。anchors.json最大变换误差2.22e-16m，0JS错误；这不是新做的原图测量，装饰像素差异不据此更改物理。

捕获自启/关闭独立端口Vite；原素材不变，更新程序化绘制hash和资源目录/来源清单。field-debug独立开发入口未纳入生产构建。详见 `docs/engineering/field-geometry.md`。
