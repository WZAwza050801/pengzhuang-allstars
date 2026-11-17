# WEB-04 · 首屏资源和运行性能

练习赛页面改为 React 路由级动态导入。大厅不再随首屏加载比赛视图；构建产物中的比赛入口为独立的 `matchScreen` chunk。点击“开始练习”后才加载它，既有 AI Worker、场地资源和 AST-05 的 hash 校验/有界缓存仍按需工作。

`Renderer` 继续使用既有质量档限制 Canvas DPR（low=1、medium=1.5、high=2.5），并以场地、画布尺寸、相机、皮肤与资源就绪状态作为静态层 cache key。此任务未修改场地几何、准星、手势或物理。

浏览器证据见 [browser.json](web-04/browser.json)。本机 Chromium headless 在 390x844、DPR 3，150ms 延迟与 200KiB/s 下载仿真下得到：

- 首屏可操作为 3933ms；初始资源传输总量 592583B；比赛 chunk（1991B）和 `assets/fields` 均未在导航到大厅时请求；
- 实际 Canvas 比赛 180 帧样本的 p50/p95 为 16.7ms；
- 一局热身后重复进入并退出 10 局，强制垃圾收集前后的 JS 堆增长为 884920B；
- 全程没有 console error。该数字是这台工作站上的 Chromium 实测，不外推为物理移动设备或 Safari 的性能承诺。

验证通过：

- `npm run test:web-performance`；
- `npm run test:assets-browser`（缓存损坏、离线、取消、低清资源和断图后仍可出手）；
- `npm run test:web-shell`；
- `npm run check`、`npm run build`、`npm run test:e2e`；
- `node tools/check-plan.mjs`。

生产构建仍保留既有第三方 Rollup 注释/`use client` 提示及超过 500 kB 的 chunk 提示；本任务没有新增浏览器错误。跨引擎和辅助技术兼容性由 WEB-03 验收。
