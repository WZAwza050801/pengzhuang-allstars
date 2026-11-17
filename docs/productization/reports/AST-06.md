# AST-06 · Web 资源验收与真机暂缓

起始提交 99b04b2；Node 24.22.1/npm 11.9.0。此项保持未勾选。

用户更正可用设备为 iPhone 15 Pro、暂无 Android，并明确要求暂时搁置真机验收。没有启动手机验收服务或收集设备结果；桌面 Playwright WebKit 不代表 iOS Safari。

Web 工作：Chromium 159.0.8154.6、Firefox 159.0、WebKit 27.2，八个规定视口、DPR1/2/3、低/高纹理，共 144 个比赛视图；432 组九套皮肤双向坐标检查，最大误差 1.88e-14；每引擎 117 张原头像及 117 卡片映射加载通过。组件大字体与焦点恢复通过，控制台错误/警告为 0。图片估算峰值 19,707,792 B，均在 64 MiB 场景上限内；这不是设备 GPU 总内存。[矩阵记录](asset-matrix/browser.json)

已实看 Firefox/WebKit 的 390px 低档比赛和 WebKit 的 side 1 标定图；图片比例、身份显示、边界叠加正常。截图只作为数值断言的辅助。Windows WebKit 批量冷缓存写入明显慢于无持久缓存的独立头像探针；本次不据此宣称加载性能达标，后续 QA/平台 PoC 需量化。

修复普通 HTTP 缺少 WebCrypto 时的资源加载：使用精确锁定的 @noble/hashes 2.4.0，在保留完整 SHA-256 校验的前提下回退；空串、abc、1MiB 与 Node 原生交叉校验。使用静态测试构建转发到非 localhost 的 HTTP 源，浏览器 API 未替换。限制来源：[Crypto.subtle](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/subtle)，实现来源：[2.4.0 README](https://github.com/paulmillr/noble-hashes/blob/2.4.0/README.md#sha2-sha256-sha384-sha512-and-others)。

其他修复：标定工具改为等待经校验的异步头像；增加解码完成/待处理统计；WebKit 点击按钮不自动聚焦，确认框 open(trigger?) 显式保存触发按钮并在关闭后恢复。已用独立 WebKit 复现前后行为。

预算审查日期 2026-11-17：微信小游戏官方资料列主包 4M、全部包 30M、独立分包 4M，普通分包没有单独大小限制。当前 Web packs 索引不是 game.json 分包，不能据此宣称微信预算通过；WX 任务必须测量真实构建与上传结果。[微信官方分包规范](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/subPackage/useSubPackage.html)

许可清单见 [asset-readiness.json](asset-readiness.json)：批准 0、269 个引用资源被排除于可发行清单。Web 公共资源 14,086,896 B，应用 JS/CSS/worker 按最终输出核对；修正动态 import 后统计比磁盘多 14 字节的问题，按 Rollup post 钩子在 Vite 改写之后统计。[Rollup 钩子顺序](https://rollupjs.org/plugin-development/#build-hooks)

完整 check（93/93 单元、5/5 契约）、build、最终客户端重建、资产故障浏览器、16/16 游戏 E2E 均通过。App/微信实际包和真实设备内存尚未测量。本项余下验收依用户要求暂缓，后续独立任务从 UI-01 继续。
