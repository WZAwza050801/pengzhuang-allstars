# 微信服务端身份（ACC-05，真实验收待完成）

2026-11-18 对照微信官方 [code2Session](https://developers.weixin.qq.com/minigame/dev/api-backend/login/api_code2session.html)、[小游戏登录](https://developers.weixin.qq.com/minigame/dev/guide/open-ability/login)、[wx.login](https://developers.weixin.qq.com/minigame/dev/api/open-api/login/wx.login.html) 和 [UnionID 说明](https://developers.weixin.qq.com/minigame/dev/guide/open-ability/union-id.html)。官方约束为 code 在客户端取得、服务端交换、短时且单次使用，session_key 不下发。UnionID 的唯一性依赖同一开放平台账号，不能把任意同名值当作跨应用合并授权。

## 当前实现范围

`WechatProvider` 默认只请求固定微信 HTTPS 地址；AppID/Secret 仅取服务端配置，URLSearchParams 编码参数，不从客户端接受 appId/openid/unionid/userId。禁重定向、保留默认 TLS 验证，5 秒超时覆盖响应体，最多读取 8192 字节并校验响应结构；错误不保留原始 URL、errmsg 或 cause。40029→401、40226→403、45011→429，其他异常通用 503，不能把含 Secret/code 的 fetch 错误直接写日志。

`WechatAccounts` 先持久化 IP 限流及 code 占用，再调用 provider。每应用/IP 50 次/15 分钟，不信任 X-Forwarded-For；code 摘要使用 SESSION_SIGNING_KEY 派生的独立 HMAC，不存原始 code。`wechat_code_attempts` 以 AppID/hash 唯一，pending/succeeded/failed 都不可复用；网络失败、进程中断或结果不明均要求重新获取 wx.login code，不能盲重放。

5 分钟本地期限限制身份/会话提交，不将已消费的 code 重新开放。占用在上游调用前独立提交，身份映射/新用户/会话/成功标记在同一事务；失败回滚账号和会话，保留已消费失败记录。不同 code 同时返回同一 AppID/OpenID 时，由唯一约束保证单一用户，本地冲突最多重试一次，绝不再次调用上游。封禁/注销中用户不重建身份或签发会话。

身份按 provider/AppID/OpenID 映射。当前没有已核实的开放平台绑定关系，因此 UnionID 不参与自动合并，也不保存到公开资料；已存在不同账号不能据此自动并号。显式绑定流程由 ACC-06 验证近期认证及冲突。

`POST /api/v1/auth/wechat/exchange` 的当前 **Web Cookie 适配器**只接受 `{code}`，采用 [安全会话](sessions.md) 的 Origin/CSRF/CORS，响应 JSON 仅 userId，应用会话写 HttpOnly Cookie；不会下发微信 session_key。小游戏原生非 DOM 凭据交付/存储仍由 WX 平台任务接入，本接口报告不等于小游戏客户端验收。

默认 `WECHAT_ENABLED=false`。启用要求数据库、强 SESSION_SIGNING_KEY、WECHAT_APP_ID/WECHAT_APP_SECRET，并禁止开发身份绕过。描述配置只输出启用状态。HTTP 代理/APM 也不得保留上游请求查询字符串中的 Secret/code；不要向 Git 或聊天粘贴真实凭据。

## 验证与解除条件

本地单元使用 mock 微信响应，集成使用真实 PostgreSQL/HTTP 和 mock 上游；现有真实 SMTP、Cookie/浏览器回归继续运行。它们证明本地合同和事务，不证明真实微信交换。进度与证据见 [ACC-05 报告](../productization/reports/ACC-05.md)，整项保持未勾选。

真实验收入口是 `npm run verify:wechat`，或使用 Node 的私有 env-file 启动 `tools/verify-wechat-login.ts`。仅显式 `WECHAT_ACCEPTANCE=1` 且 `APP_ENV=test` 才执行；只允许 loopback 的 `_test` 数据库，不回退生产 DSN。工具会迁移专用测试库、创建独立临时房间目录并在结束时清理，不恢复本地原 Demo 房间，不占用潜在服务器。

通过本机私有环境提供这些字段，不能把实际值放进命令参数/仓库：

- TEST_DATABASE_URL、SESSION_SIGNING_KEY、WECHAT_APP_ID、WECHAT_APP_SECRET。
- WECHAT_ACCEPT_VALID_CODE：授权测试小游戏刚获取的有效 code。
- WECHAT_ACCEPT_EXPIRED_CODE：同一授权测试小游戏已确认超过有效期的另一 code。

命令实际执行 CSRF、有效 code→自有会话→/me、同 code 重放、过期 code 和退出；全部通过且资源关闭完成才输出成功报告，报告为 `work/wechat-acceptance-<随机ID>.json`，只含日期/结果，不含身份/凭据。失败只输出固定 phase，非零退出；配置缺失时不发网络请求，也不生成成功证据。需要凭据持有者确认 app 资格、code 来源与过期时间，并把真实通过证据补入执行记录后才能勾选 ACC-05。

ACC-06 的 [绑定/重新认证/注销恢复](account-lifecycle.md) 已复用同一单次 code 占用，不接收客户端声称的 OpenID。保留/去标识时保留 code 防重放指纹与内部 UUID 引用；期限内不能通过删除占用让旧 code 重新生效。真实平台绑定路径仍需在 ACC-05 凭据具备后补测。
