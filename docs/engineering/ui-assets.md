# 大厅与比赛 UI 资源索引

来源是 `config/ui-tokens.json` 与 `tools/ui-textures.mjs` 的原创几何绘制；不读取提取图或字体，不在纹理中绘制文字。`npm run ui:assets` 使用锁定的 Playwright Chromium 导出，`npm run check:ui-assets` 校验 tokens、布局、源码、音源、PNG 的 hash/尺寸及内容版本；总目录检查同样会执行验证。

| 语义 ID（总目录增加 ui. 前缀） | 数量 | 逻辑区域 / 缩放策略 |
|---|---:|---|
| surface.<light/dark>.<primary/secondary/panel>.<normal/selected/disabled> | 18 | 64×64；16px 固定四角，九宫格扩展边与中心；目标不得小于 32×32，按钮至少 44px |
| icon.<light/dark>.<back/settings/ball/lineup/mail/trophy/check/close> | 16 | 48×48；等比 contain，通常显示 24–32px；可访问名称由宿主提供 |
| stadium.<scene_01…scene_05> | 5 | 256×192；等比 contain，五级看台；仅供大厅展示，不能作为碰撞坐标来源 |
| audio.<hit/kick/wall/spring/post/shoot/goal/skill/turn> | 9 | 已有 sfx.ts 程序音源；用户操作后创建/恢复 AudioContext，支持静音及后台释放 |

`ui.pack` 指向 pack.json，两个 chrome 图集各 512×208，stadiums 图集 1300×196；三张 PNG 共 88,512 B，解码 RGBA 约 1.79 MiB。每块有 2px 自身边缘复制，映射不含留边。pack 记录源码指纹、生成引擎、音源指纹和 tokens 版本，没有时间戳。修改源码后必须重新导出；不改同版本缓存内容。

`drawUiSprite` 对面板使用共享纯九宫格切片，对图标/球场保持原始比例；不强制微信 Canvas 满足 DOM 接口。Web 预览用语义按钮和独立动态文本，尺寸由内容决定，ResizeObserver 重绘背景，禁用按钮禁止点击，选中提供 aria-pressed、文本与边框。大字体不依赖把带文字图片放大。

`npm run test:ui-browser` 在隔离页面 `/ui-debug.html` 验证亮暗、选中/禁用、键盘焦点、标准/200% 字体、DPR1/2/3、断图重试、真实 AudioContext 的用户手势解锁与静音；记录在 reports/ui-assets。无声卡听感、微信/iOS 音频中断与真机视觉不在 Web 自动化证明范围内。

这些是后续组件可用的原创占位资源，不替换整个旧 Demo 的原版入口。来源策略单列 rebuilt-ui-pack，商业发行批准依旧由 REL-01 核实。AST-04 生成 Web CSS/Canvas tokens 并建立业务组件样例，AST-05 承接按场景缓存/发布包过滤。
