# AST-02 · 球员卡与图集规格

起始提交：39c93e6；Node 24.22.1/npm 11.9.0。

已交付 117 个原创程序化占位头像、15 个五品质三状态复用卡框，3 张 PNG 共 654,968 B，均不超过 2048 px；严格身份/裁切映射、2 px 留边、源代码与内容 hash、导出/校验命令及 Canvas 绘制。名字与位置在运行时绘制；不修改旧原版头像或数据数值。

真实浏览器结果见 [browser.json](card-atlas/browser.json)：DPR1/1440×900 全量 117 张；DPR2/390×844、DPR3/320×568 各抽样 6 张并验证 15 框/3页加载；全部 117 张旧头像也成功解码且为方形。528 个边缘采样相等，选中、禁用、键盘焦点、断图重试通过，console error/warning 和 pageerror 均为 0。

联系表与抽样截图已实看：[全卡联系表](card-atlas/contact-sheet.png)、[DPR 2](card-atlas/dpr-2.png)、[DPR 3](card-atlas/dpr-3.png)。版式、品质边框、中文名字和图像纵横比正常；头像是明确标记的通用占位，不宣称还原本人。

验证：完整 `npm run check` 通过（单元 80/80、契约 5/5），`npm run build`、`npm run test:cards-browser`、`npm run test:e2e` 通过；游戏浏览器 PASS=15/SKIP=0/FAIL=0。总资源目录增加 117 个 card-portrait、15 个 card-frame 和 1 个 card-data 绑定，原版 portrait 117 个绑定保留。稀有度原值单列动态角标，未知值不补造。图集版本 cards-afa521c06111808d，目录版本 assets-8d3a29ec6b656a66。

验收时修复测试环境问题：Colyseus 0.16 的 Node 测试显式使用其 ws 真实传输实现，并发上限 4；包含多次真实物理重放的用例预算设为 15 秒，减少该用例的重复 seed 夹具。修复后三个房间/重启用例连续 10 轮共 30 次通过；浏览器传输仍由真实 Chromium 验证。未修改业务判定或添加重试来掩盖失败。

边界：尚未做运行时场景缓存和发布裁剪，未声称授权已获批、最终美术已完成或真机验收通过；它们属于后续 AST/REL 任务。
