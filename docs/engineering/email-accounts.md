# 邮箱账号与密码（ACC-02）

运行时在配置数据库且 `EMAIL_PROVIDER` 启用时挂载邮箱账号 API。注册和找回仅接受意图，所有凭据/用户状态/一次性 token 均由服务端处理。`/auth/login` 验证密码、邮箱已验证状态与 active 状态，同事务签发会话并写入安全 Cookie；JSON 仍仅返回可信 userId。会话与 CSRF 调用约定见 [sessions.md](sessions.md)。

| POST `/api/v1/auth` 路径 | 请求与结果 |
|---|---|
| `/register` | email/password/nickname；新用户与重复邮箱均 202 `{accepted:true}`；新用户、身份、凭据、token 和投递队列同一事务。 |
| `/login` | email/password；通过验证的 active 用户返回 userId；不存在、未验证、封禁、密码错误均为相同 401。 |
| `/email/verification-request` | email；未验证账号重发并失效旧验证 token；其他情况同为 202。 |
| `/email/verify` | token；有效 token 原子消费并设置 verifiedAt；错误目的、过期或重放返回通用 400。 |
| `/password/reset-request` | email；已验证 active 账号生成找回邮件；不存在邮箱也返回相同 202。 |
| `/password/reset` | token/password；锁定账户后消费 token、修改 hash、失效同用户其他找回 token、撤销全部会话，同一事务。 |

请求均为严格 JSON schema，不接受客户端 userId、role、verifiedAt 等权威字段；密码注册/重设为 12–256 字符，不截断 Unicode。邮箱固定为去除首尾空白后全小写，不移除 `+` 标签、不合并点号别名。边界 schema 仍拒绝带空白的原始邮箱。Web 写入要求允许的 Origin 和签名 CSRF Cookie/匹配头，返回 no-store/no-referrer；不信任客户端 X-Forwarded-For 获取限流地址。

## 密码与限流

`@node-rs/argon2` 2.2.2，Argon2id v19、64MiB、t=3、p=1、32 字节输出，库生成独立随机盐。2026-11-18 i7-13700H 本机连续五次 hash 为 78/78/82/85/72ms；部署机器仍须复测。参考 [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) 与 [库文档](https://github.com/napi-rs/node-rs/tree/main/packages/argon2)。未知用户也使用真实 Argon2 dummy 验证；单服务实例最多四个并行 KDF，超载返回可重试 503。

PostgreSQL `auth_rate_limits` 用匿名 scope SHA256 和时间桶做原子计数：登录每 IP 50/15分钟、每邮箱 10/15分钟；注册、验证重发、找回请求每 IP 20/小时、每邮箱 5/小时；token 提交每 IP 30/15分钟。计数跨进程保留，超额 429；清理超过一天的旧桶，每次最多 100 行。不存在邮箱与存在邮箱使用相同限流规则。注册始终完成 KDF，找回与重发通过后台队列避免 SMTP 耗时参与存在性判断；请求最少耗时 100ms。这是工程基线，容量和代理部署策略由 OPS 验证。

## token、投递与恢复

token 由 32 字节安全随机数生成，30 分钟有效；`verification_tokens` 只存 SHA256，不把密码、token 或 SMTP 凭证写入日志。邮件链接将 token 放在 URL fragment，页面后续使用 POST 完成操作，防止常规 URL 请求日志直接收到 token。

`account_mail_jobs` 保存 AES-256-GCM 加密的收件地址/token，密钥由 `SESSION_SIGNING_KEY` 通过带固定用途的 HMAC 派生，使用独立随机 nonce。启用邮件要求强密钥；重启时保持同一密钥才能恢复待投递任务。轮换前先排空队列，未投递的旧任务可通过重发 API 重新签发。发送成功或任务终止后清空密文。worker 每次最多 10 项，`FOR UPDATE SKIP LOCKED` 支持多实例；失败按 5/10/20/40 秒退避，最多五次，token 过期/已用或用户非 active 时终止。SMTP 接收后进程崩溃可能再次发送同一封邮件，token 消费仍只有一次。

Nodemailer 10.6.0 使用真实 SMTP。`EMAIL_PROVIDER=mailpit` 仅允许 local/test 回环地址；staging/production 要求 `smtps://`、证书校验和明确 `MAIL_FROM`，禁止开发绕过。SMTP_URL 仅取主机/端口/凭据，不允许 URL query 注入 transport 选项；不打开 debug、远端 URL/文件附件访问。`PUBLIC_ORIGIN` 决定邮件链接来源，不能由请求 Host/Origin 决定。

验收环境为真实 PostgreSQL 17.12 + Mailpit 1.34.0，经过真实 HTTP、SMTP 和 Mailpit 收件 API。此证据证明本地邮件投递，外部邮件供应商的域名、凭证与到达率仍由部署时验证。测试不连接外部邮箱，详见 [database.md](database.md)。

依赖审计使用 npm 官方 API（镜像站不提供 audit）。2026-11-18 新增 Argon2/Nodemailer 没有审计条目；项目原有依赖树仍有 15 high、14 moderate、2 low、0 critical，涉及 Express/Colyseus 及工具链，保留为发行前依赖升级门槛，本任务不声称全项目已安全放行。
