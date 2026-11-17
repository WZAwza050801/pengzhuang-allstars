# ACC-07 · Web 登录和账号页面

2026-11-18，Windows / Node 24.22.1 / npm 11.9.0 / PostgreSQL 17.12 / Mailpit 1.34.0 / Playwright Chromium。页面和恢复约定见 [web-accounts.md](../../engineering/web-accounts.md)。未使用远端服务器。

| 实际验证 | 结果 |
|---|---|
| `npm run test:integration` | 8 文件 / 87 项通过，0 跳过；新增账号页面 9 项，真实生产页面构建、HTTP、PostgreSQL、SMTP 和浏览器 Cookie。 |
| `npm run check` | 119 单元 / 8 契约及边界、lint、195 文件格式、类型、配置、规划和生成文档/数据检查通过。 |
| `npm run build` | 生产客户端与服务端通过；账号页面独立动态 chunk。 |
| `npm run test:web-shell`、`npm run test:web-layout` | 三档反复挂载/释放、失败恢复；八档布局及大字体/键盘视口通过。 |
| `npm run test:web-performance` | 150ms / 200KiB/s 条件首屏 3961ms；帧 p95 16.7ms；十局后堆增长 896448B，通过既有预算，0 console error。 |
| `node tools/e2e-browser.mjs` | 当前 build 和 test:web-performance 已生成的测试客户端上 18 PASS / 0 SKIP / 0 FAIL；console/pageerror 均 0。 |

页面覆盖注册→真实收信→验证→守卫回跳→退出→匿名练习；双击登录只提交一次，localStorage/sessionStorage 均为空，凭据 Cookie 为 HttpOnly。找回邮件实际修改密码并广播撤销原页面状态，重放链接拒绝；access Cookie 缺失时一次刷新恢复，另一标签退出同步到登录页。真实提交后丢弃退出响应，页面保留 pending，重试原 Idempotency-Key 确认完成。注销密码/DELETE 证明、凭据查询和取消后新登录通过。预置真实限流桶后显示固定 429 文案；无效 fragment 不发 token 请求且地址栏已移除。

邮箱绑定页面用受信测试 fixture 提供无邮箱身份/密码及真实会话；随后所有重新认证、发送、收信确认及新邮箱密码登录均使用实际服务，验证 UI 表单接线。这不代表真实微信 code 交换，ACC-05 保持未勾选。纯微信用户的微信认证与绑定仍由小游戏提供，Web 没有伪造 code/OpenID 输入流程。

320×568、390×420、768×1024、1440×900 验证焦点和无横向溢出；390px / 1.4 倍字体断言实际输入字号至少 22px。截图人工查看 [320px 登录](acc-07/login-320.png)、[手机账号页](acc-07/profile-mobile.png)。测试只过滤已断言的 400/401/403/409/429 网络资源错误及刻意注入的退出 ERR_FAILED；0 意外 console error，0 未处理 pageerror。原有游戏 E2E 和性能控制台完全无错误。

首轮发现新密码说明被拼入可访问名称，拆为 aria-describedby 后流程通过；注销后的普通 SPA 跳转与高优先级匿名状态守卫竞争，复现页面误回 `/login`，改成确认后完整加载固定恢复页，最终 9 项页面及全量 87 项集成通过。没有靠增大超时或跳过用例掩盖问题。

新增公开 capabilities 仅给启用状态/Cookie 存在提示，不参与授权；新增本人身份状态读取仅布尔值。生命周期服务相应新增只读方法是界面所需关联修改，不改已确认玩法或经济。布局/性能脚本改为独立回环真实 API fixture，停止依赖开发者本地服务；本轮更新对应截图/性能证据。

完成后 45/112，下一项 DAT-02；第 50 项按用户规则同步 GitHub。真实微信/设备、素材授权、已有依赖审计及平衡发布门槛继续保留。没有新增外部依赖；临时数据库/Mailpit 正常停止。原生凭据安全存储、真实大厅资产/房间票据和渠道发布仍属后续任务。
