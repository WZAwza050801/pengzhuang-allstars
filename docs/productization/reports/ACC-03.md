# ACC-03 · 安全会话与刷新旋转

2026-11-18，Windows / Node 24.22.1 / PostgreSQL 17.12 / Mailpit 1.34.0 / Playwright Chromium 的实际验收。机制、接口、迁移与轮换约束见 [sessions.md](../../engineering/sessions.md)，复现依赖见 [database.md](../../engineering/database.md)。所有数据库和邮件均为本机隔离实例，未使用远端服务器。

| 验证 | 实际结果 |
|---|---|
| `npm run test:integration` | 5 文件 / 46 项通过，0 跳过；会话 12 项、真实 SMTP 邮箱 12 项，另有账户/迁移/用户数据回归。 |
| `npm run check` | 105 单元、5 契约及静态/配置/生成契约检查通过。 |
| 生产构建与 `npm run test:e2e` | 生产构建通过，真实浏览器游戏 18 PASS / 0 SKIP / 0 FAIL；最后 SQL 撤销时间修正后再构建服务端。 |
| npm 官方 audit | jose 6.2.17 无审计条目；全树仍 15 high / 14 moderate / 2 low / 0 critical，保留原发行门槛。 |

签名回归覆盖过期、未来 iat、过长寿命、错误 issuer/audience、缺失/非法 claims、错误 typ/alg、伪签、alg=none、畸形输入；不接受 decode-only。访问鉴权再读数据库，因此账户非 active、会话撤销或数据库会话到期时，即使 JWT 尚有效也拒绝。

真实数据库覆盖八个并行刷新调用跨两个 service 实例返回同一个 successor；旧一代请求短时迟到时得到当前 successor；到期保持原绝对时间；10 秒窗口外重用旧 hash 后，撤销先提交再返回 401，另一设备独立 family 保留。错误 CSRF/伪造 token 不撤销合法会话；注入 SQL 更新失败后历史和 successor 一起回滚，旧凭证可重试。登录创建会话失败时无凭证 Cookie，响应为通用错误。

HTTP 验收覆盖缺少/错误 Origin、CSRF、另一会话的绑定、非法 refresh body、重复 Cookie、Bearer/Cookie 歧义、预检 method/header 与 CORS 来源限制。真实 Chromium 用测试身份 adapter 取得服务器下发的 Secure/HttpOnly Cookie：JavaScript 只读到 CSRF，两个标签四次并发刷新均 200，仍能读取受保护探针。实际邮箱登录签发另由真实 SMTP 套件验证，测试 adapter 不在生产路由中。

复核发现并以失败测试先复现的两项竞争问题已经修复：登录等待密码重置的用户锁后，joined snapshot 仍可读到旧密码，改为取锁后重新查询；较早开始的撤销事务使用 `now()` 会早于新会话 createdAt，改用实际时钟。30 天边界也改为数据库单次实际时钟计算，消除事务起始时间的 1ms 偏差。

测试 runner 遇到一次 Windows EPERM 临时文件锁，补入停止服务后的有界删除重试；后续完整成功和预期失败运行均停止数据库并清理各自目录，预期失败仍非零退出。之前留下的 `allstars-pg-test-9LdS5w` 数据库已停止；自动审批拒绝手动删除，因此目录暂留，不冒称清理完成。

当前用户/设备列表/退出为下一项 ACC-04，客户端登录状态/邮件页面与房间鉴权仍按后续任务实现。真机验收继续按用户要求暂缓；素材授权、已有依赖和平衡放量门槛没有解除。
