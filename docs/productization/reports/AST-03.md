# AST-03 · 大厅与比赛 UI 资源包

起始提交 2fdde64；Node 24.22.1/npm 11.9.0。

交付亮暗设计 tokens、18 个九宫格按钮/面板、16 个图标、5 个原创程序化球场展示、9 个已有程序音效的源码绑定。三张 PNG 共 88,512 B；文字不烘焙，映射带 2px 留边、源代码和音源指纹。规格、语义 ID 和命令见 [设计索引](../../engineering/ui-assets.md)。旧 Demo 资源和玩法保持兼容。

浏览器证据见 [browser.json](ui-assets/browser.json) 与亮暗/标准/200% 字号四张截图。1280×900/DPR1、390×844/DPR2、320×568/DPR3 下全部图片解码，禁用/选中/键盘焦点可操作，无横向溢出或文字裁切；真实 AudioContext 只在用户点击后启动，静音阻止后续音符，断图后重试恢复。console error/warning、pageerror 为 0。截图已实看。

`npm run check` 通过：83/83 单元、5/5 契约；`npm run build`、`npm run test:ui-browser` 通过，游戏浏览器回归 PASS=15/SKIP=0/FAIL=0，含生产调试隔离。资源包 ui-assets-6ad0eb2623767426，目录 assets-759f446273d80363。商业授权仍未批准；真实听感和平台音频/视觉验收留给跨端任务，不把 Chromium 代替真机。
