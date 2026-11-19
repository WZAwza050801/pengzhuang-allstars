# AST-05 · 场景资源缓存与构建裁剪

起始提交 91b2651；Node 24.22.1/npm 11.9.0。

交付 hash 校验的场景管理器、有界内存/持久缓存、共享请求与取消、远程失败回退、实际比赛和图集加载接入、十张整图低分辨率 WebP、过滤构建与五类场景包索引。设计和容量边界见 [asset-loading.md](../../engineering/asset-loading.md)。玩法、数值和碰撞坐标未改。

当前公共资源 14,086,896 B；去除 72 个未引用文件、17,188,681 B，产物无 art/raw/cutout。低场地纹理十张共 328,278 B；含索引的 matchLow 332,698 B，对应 matchHigh 1,490,466 B。包内全部低纹理 RGBA 总和 16,081,920 B，原档 85,104,080 B；单局只加载当前场地。应用 JS/CSS/worker 约 1.23 MB，单独核对实际文件，未与图片重复相加。这些不是微信真机主包/设备总内存结论。

浏览器证据：[browser.json](asset-cache/browser.json)、[断图仍可出手截图](asset-cache/fallback-game.png)、[公共资源包报告](asset-packages.json)。真实 CacheStorage 的损坏删除重取、离线命中、同路径换 hash、取消后的零场景图片/字节、持久缓存限额、最长边 768 纹理都通过；全部比赛图片请求失败仍用程序化画面完成一杆。裁剪规则在实测前补齐动态卡框、属性和技能图标，实际构建的 106 张卡牌详情逐一打开，所有图片解码且控制台无错误/警告。截图已实看。

完整 `npm run check` 通过（单元 92/92、契约 5/5）；build 和最终过滤客户端重建、assets-browser、卡牌/UI/组件浏览器回归通过；游戏 E2E PASS=16/SKIP=0/FAIL=0，含实际比赛图像解码和容量。106 张详情共验证 864 次图片解码。`check:asset-release` 按预期退出 1，原因是所含资源尚无权利批准。源目录 assets-ce2c8c60078b9388、过滤目录 assets-de2336fa3f534fc8。

商用资源批准仍为 0。保留旧 Demo 大厅 CSS/DOM 的 HTTP 图片路径，后续页面壳迁移；未冒充全部微信/App 资源适配完成。
