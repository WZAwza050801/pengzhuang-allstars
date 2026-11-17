# 当前用户与设备会话（ACC-04）

当前用户与会话操作复用 [安全会话](sessions.md) 的签名、Cookie、CSRF、CORS 和即时数据库撤销检查。API 不接受客户端指定 userId；HTTP 中间件给出可信 `{userId, sessionId}`，业务事务取用户→会话锁后再次确认账户 active、会话有效，避免认证后到写入前发生撤销。

近期重新认证、身份绑定、注销排期/取消与内部封禁见 [account-lifecycle.md](account-lifecycle.md)。解封或取消注销后，已撤销的会话必须重新登录。

| 接口 | 请求和响应 data |
|---|---|
| `GET /api/v1/me` | `{userId, sessionId, profile}`；profile 是真实数据库资料或 null，包含 nickname/avatarAssetId/level/exp/version。没有档案不伪造等级或余额，初始化归 DAT-02。 |
| `GET /api/v1/me/sessions` | 可选 limit（默认 20，1–50）和不透明 cursor；返回 `{sessions, nextCursor}`，仅本人未撤销、未过期且有 CSRF 绑定的会话。 |
| `DELETE /api/v1/me/sessions/:id` | 仅本人会话，返回 `{revoked:true}`；他人或不存在均 404。本人已撤销目标可用另一有效会话重试，仍为 200。撤销当前会话同时清除当前凭证 Cookie。 |
| `POST /api/v1/auth/logout` | `{allSessions:boolean}`，要求 UUID `Idempotency-Key`；返回 `{loggedOut:true}`。false 退出当前设备，true 撤销该用户所有当前会话。 |

会话列表仅含 id/deviceKind/isCurrent/createdAt/expiresAt。deviceKind 由 User-Agent 粗略归类 desktop/mobile/tablet/unknown，不保留原始 UA/IP、不把设备描述用于授权。旧自由文本标签只输出 unknown。排序为 createdAt/id 倒序；游标保留 PostgreSQL 微秒，避免同毫秒的记录跳页。非法分页、未知查询字段和试图指定身份均 400。

## 退出、撤销与重试

新退出操作用当前 refresh 或已消费的真实历史 hash 证明当前设备，CSRF 必须匹配该会话。退出全部设备还要求会话 active/未撤销/未过期，历史 refresh 只允许短宽限内使用。过期 access Cookie 不妨碍通过仍有效的 refresh 退出。

撤销与 `session_logout_actions` 幂等回执在同一 PostgreSQL 事务提交；回执以全局 UUID 操作 ID 唯一，记录原 sessionId、操作范围与完成时间，不保存原始凭证。失败全部回滚，Cookie 只在提交后清除。相同操作键更改范围为 409；来自不同 CSRF 绑定的回执请求为 403。

响应完全丢失时，重试通过原凭证和回执确认；若浏览器已经收到清 Cookie 的响应头、仅响应体丢失，则签名 CSRF Cookie + 原操作键只能确认已有回执，不能发起新的“全部撤销”。若另一标签随后重新登录，旧操作确认不再执行撤销，也不清除属于新会话的 Cookie。没有凭证且无既有回执时，当前设备退出可直接清本地 Cookie，全部设备退出返回 401。

普通业务的访问/刷新在撤销后即时拒绝。当前设备的 DELETE 若响应丢失，后续业务会得到 401；客户端退出当前设备应优先使用带回执的 logout。NET-01 尚未实现真实房间票据，它必须把 ticket 绑定 sessionId 并在消费/重连时复用数据库即时状态校验；本任务不把旧 Demo 游客房间冒称为已接账号鉴权。

## Web 客户端模型

`WebAccountClient` 使用现有平台 NetworkAdapter，复用来源限制、10 秒默认超时和响应体上限；仅同源 Cookie，不读取 access/refresh，也不写 localStorage。平台 HTTP 端口新增显式 headers，用于 CSRF 和幂等键。请求/响应均校验公共 schema，错误只保留固定 code/retryable，不透传服务端内部信息。

```ts
const api = new WebAccountClient(platform.network);
const account = new LoginStateModel(api, () => crypto.randomUUID());
await account.restore();
// 使用 account.snapshot 与 account.subscribe 渲染状态。
await account.logout(true);
// 网络失败时 snapshot 为 logout-pending，显式 await account.retry()。
```

current/list/revoke 的并发 401 合并为一次 refresh，最多重放原请求一次；迟到的并发 401 复用已完成的刷新结果，包括失败，避免刷新风暴。网络失败保留可重试错误；真实 401 转为 anonymous。

LoginStateModel 不依赖浏览器全局对象；恢复 single-flight，退出立即清除内存用户并使此前请求 generation 失效，迟到 `/me` 不能复活登录。退出失败保留相同 operationId/范围，只能显式重试原意图，未完成时不可静默改为全部设备。pending 状态不得作为已退出成功显示。页面刷新重新确认服务端状态，不自动重发丢失的旧意图。界面与生命周期接线见 [Web 账号页面](web-accounts.md)，原生安全凭证由 APP 任务实施。

## 迁移与证据

`202611180005_session_management.mjs` 新增退出回执和本人活跃会话分页索引；不改变玩法或经济。回执与会话保留政策协调，不能在允许重试期间提前删除。down 仅本地/测试，不能恢复已撤销会话。

真实 PostgreSQL、SMTP、Chromium、断网注入和失败回滚证据见 [ACC-04 报告](../productization/reports/ACC-04.md)。
