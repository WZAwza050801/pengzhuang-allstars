# AST-04 · Tokens 与组件样例

起始提交 0f973a1；Node 24.22.1/npm 11.9.0。

交付单源 tokens 的 Web CSS/Canvas 数据生成与校验、19 类有 props/状态/动作说明的样例、六状态共用语义、精确整数金额、可访问的卡牌/错误重试/分页/确认框，以及窄 Canvas 绘制能力。详见 [组件目录](../../engineering/ui-components.md)。卡框品质色改为读取同一 tokens 输入，沿用已验收色值；图片字节未改，来源指纹与总目录版本更新。

发现并修复：Web 的不可操作按钮与 Canvas 颜色不一致；原生 dialog 的反向 Tab 可把焦点移出。三组真实 Chromium 测试已验证 Web/Canvas 六状态像素颜色和动作资格、正反向焦点循环、Esc/确认后恢复、重试、分页和卡牌选择；1280×900/DPR1、390×844/DPR2/200%、320×568/DPR3/200% 无横向溢出或按钮文字裁切，console error/warning、pageerror 为 0。结果见 [browser.json](components/browser.json)。

完整 `npm run check`（单元 86/86、契约 5/5）、build、components-browser、cards-browser、ui-browser 与游戏 e2e 均通过；游戏 PASS=15/SKIP=0/FAIL=0。已实看组件联系表与暗色大字体 Canvas 截图。当前卡图集 cards-fbe0928203eb1200、UI 包 ui-assets-3701433072f38103、目录 assets-88738f8e640f10c2；PNG 字节保持不变，卡牌/UI 的浏览器记录已按新来源版本刷新。没有将样例数据冒充账号/奖励数据，没有将窄绘制适配器冒充完整微信客户端。
