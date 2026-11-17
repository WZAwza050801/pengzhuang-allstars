# 安全会话（ACC-03）

`Sessions`、`AccessTokens`、`WebSessions` 分别负责持久化会话、JWT 签名校验和 Web HTTP 边界。配置了数据库和 `SESSION_SIGNING_KEY` 的运行时挂载会话模块；邮箱入口另外需要启用 `EMAIL_PROVIDER`。身份必须来自邮箱凭据或后续 provider 的服务端核验，不能从请求 body 中指定 userId。

## Web 调用

1. `GET /api/v1/auth/csrf`：设置可读 CSRF Cookie，返回 `{csrfToken}`。有合法 Cookie 时复用，避免已登录多标签互相覆盖。
2. 所有账号 POST 使用 JSON、`credentials: 'include'`，并把 CSRF 值放入 `X-CSRF-Token`。浏览器自动提供 Origin；服务端要求它精确匹配 `ALLOWED_ORIGINS`。缺少 Origin、Cookie、签名或匹配头均为 403，包括登录和密码重置。
3. `POST /api/v1/auth/login`：密码、邮箱验证、账户 active 校验与会话创建在同一事务完成。响应 data 仍仅含 userId；访问与刷新凭证写入 HttpOnly Cookie，不进入 JSON 或 localStorage。
4. `POST /api/v1/auth/refresh`：body 必须为 `{}`。仅从 Cookie 取得 refresh，校验会话绑定的 CSRF hash，原子旋转后更新凭证 Cookie，返回 `{refreshed:true}`。失效凭证为通用 401，数据库失败为通用 500，不能伪装成功。

安全配置下 Cookie 名为 `__Host-pz_access`、`__Host-pz_refresh`、`__Host-pz_csrf`，全部 Secure、SameSite=Lax、Path=/，不设 Domain；前两个 HttpOnly。本地显式非 Secure 配置使用 `pz_` 前缀。CSRF 使用随机 nonce + 独立用途 HMAC 签名，并在会话内绑定 SHA256；比较使用常量时间摘要比较。重复同名 Cookie 拒绝，避免不同路径/来源导致歧义。

CORS 仅返回获准来源，带 credentials 和 Vary: Origin；预检严格限制 method/header，拒绝任意反射。SameSite=Lax 面向同站部署；仅把跨站前端加入 CORS 不会让浏览器发送 Cookie。跨站部署、App 安全存储和微信凭证交换分别留给后续平台任务。

## 签名与业务鉴权

固定 `jose` 6.2.17；[官方 jwtVerify 文档](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md) 及 [claims 验证选项](https://github.com/panva/jose/blob/main/src/types.d.ts) 是签名/claims API 依据。

access 使用 HS256 白名单、`typ=at+jwt`、固定 audience `pengzhuang-api`、配置 `PUBLIC_ORIGIN` 的规范 origin 作为 issuer；强制 iss/aud/sub/sid/jti/iat/exp。sub/sid/jti 必须为 UUID，iat/exp 为整数，寿命最多 900 秒，禁止未来签发、过期、错误 issuer/audience/type/算法及伪造签名。JWT 验证不使用 decode 代替签名验证。

每次 `authenticate` 再查真实数据库的 user/status/session/expiry/revocation；不缓存“未撤销”结果。`WebSessions.requireAccess` 将 `{userId,sessionId}` 放到 `res.locals.principal`，Cookie 写请求还查会话 CSRF 绑定。只读调用也支持 Authorization Bearer；同一请求同时带 Bearer 与 access Cookie 时拒绝。原生写入协议由后续平台任务定义，现有 Web 模块仍要求 CSRF。

当前用户/设备列表/退出属于 ACC-04；房间票据/重连属于 NET，尚未在旧 Demo 房间上冒称完成鉴权。后续业务写入在自己的事务内重新确认账户/会话及所有权，不能仅凭中间件的查询结果绕过结算时权限校验。

## 刷新旋转与竞争

会话绝对有效期由数据库一次实际时钟计算为 30 天；旋转不延长。`sessions` 保存当前 refresh SHA256、generation、family、CSRF SHA256 和撤销状态。`session_refresh_history` 只保留已消费 hash、generation 和实际消费时间，不存原始凭证。

refresh 形如 `sessionId.generation.secret`。secret 是独立用途密钥对随机 sessionId/familyId/generation 的 HMAC；可以跨实例重新生成当前 successor，而无需保存可读 refresh 或响应密文。用途与 access、CSRF、邮件加密分离；客户端不能选择 session/family/generation。

旋转先锁用户，再锁会话，同事务插入历史和更新当前 hash/generation。消费过的凭证在固定 10 秒内返回**当前同一个 refresh successor**，不再旋转，不延长宽限；access 可重新签发。这样覆盖多标签同时刷新、响应丢失重试、跨实例/重启。客户端后续还应做 single-flight，避免无限并发与迟到响应覆盖。

已消费的真实旧 hash 超过 10 秒后再用，先提交该 family 的撤销，再返回 401；不能在事务内抛错使撤销回滚。另一设备独立 family 保持有效。未知/伪造凭证与错误 CSRF 不触发撤销，避免仅知道 sessionId 就能踢人。10 秒窗口内无法区分合法重试与同时持有完整凭证的攻击者，这是有界的体验/重放取舍；超过窗口的延迟重试需要重新登录。

密码重置、登录、刷新均按用户→会话顺序取锁。登录在取得用户锁后用新的 READ COMMITTED 语句读取密码，避免等待重置期间使用旧 joined snapshot。重置先完成则旧密码登录失败；登录先完成则随后重置撤销新会话。撤销使用实际时钟，不能用等待前的事务起始时间写出早于会话创建的 revokedAt。旋转持久化失败会回滚历史与 successor，原 refresh 仍可重试。

## 迁移、运维与证据

迁移 `202611180004_sessions.mjs` 增加 generation/CSRF hash、family 索引及历史表；旧无 CSRF 绑定会话显式撤销，用户须重新认证。down 只用于隔离本地/测试，不会恢复已经撤销的会话。

同一部署各实例必须共用密钥、issuer 和数据库。当前不实现多版本密钥共存；轮换前排空邮件队列、撤销旧会话，再协调重启所有实例。禁止不同密钥的实例混跑。历史 hash 至少保留到对应会话过期，届时随会话保留政策批量清理，不能提前删除导致丢失重放证据。

真实 PostgreSQL、SMTP 和 Chromium 证据见 [ACC-03 报告](../productization/reports/ACC-03.md)。官方 npm audit 中 jose 无条目；原有 31 项依赖审计记录仍是发布门槛。真机未测，本任务不替代 AST-06/APP/WX 验收。
