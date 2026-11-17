# WEB-02 · 多输入与双方视角

比赛 Canvas 现在只接受第一个主指针。触摸多指、第二个鼠标指针或已在瞄准中的再次按下都不会替换当前出手。Esc、浏览器取消、指针离开、失去指针捕获、窗口失焦和 viewport 缩放都会取消瞄准，且安全释放已有捕获；后续 `pointerup` 不会误发球。

全局键盘快捷键会让给 input、select、textarea 和 `contenteditable` 焦点，不会修改弧线或吞掉用户的编辑操作。现有 FLD-02 相机、世界坐标与手势转换保持不变：side 1 仅翻转相机，服务端世界坐标与权威规则不变。

Chromium 自动化实际使用 Canvas 和本地联机服务，不以模拟 Host 代替：

- 桌面 1200x900、DPR 1 的 side 0 用真实鼠标出手；
- 移动 390x844、DPR 3 的 side 1 保持“我方在下”，用 CDP touch 曲线拖拽出手，服务端权威杆数推进；
- 文本输入焦点下方向键不改变弧线；非主指针不接管瞄准；`pointercancel`、`lostpointercapture`、`pointerleave`、缩放均取消瞄准且无出手；
- 依赖任务 FLD-02 已覆盖 4 种视口 × 2 视角 × 3 DPR × 2 布局的 48 组统一坐标/手势数学，本任务没有改动相机、球场几何或物理参数。

验证通过：

- `npm run test:e2e`：18 PASS / 0 SKIP / 0 FAIL；
- `npm run check`；
- `npm run build`；
- `node tools/check-plan.mjs`。

生产构建仍有既有 Rollup 第三方注释/`use client` 提示及大于 500 kB 的遗留 chunk 提示；没有新的浏览器 JavaScript 错误。Firefox、Safari 和辅助技术兼容性留给 WEB-03。
