# 账户持久化数据字典

ACC-01 只建立账户边界与持久化契约；注册、密码派生、邮件、刷新会话和注销业务流程由后续 ACC 任务实现。所有时间为 `timestamptz`，ID 为数据库生成的 UUID，任何 hash 均为不可逆不透明文本，仓储不把 hash 作为输出字段返回。

| 表 | 关键字段 | 约束与语义 |
|---|---|---|
| `users` | `id`, `status`, `created_at`, `updated_at`, `banned_at`, `deletion_requested_at`, `deleted_at` | `active → banned/deleting`、`banned → active/deleting`、`deleting → active/deleted`，`deleted` 为终态。进入 banned/deleting/deleted 时分别留下对应时间戳。 |
| `auth_identities` | `user_id`, `provider`, `provider_app_id`, `provider_subject` | `(provider, provider_app_id, provider_subject)` 全局唯一；同一用户在同 provider/app 下仅可绑定一个 subject，避免把不同 appId/openId 错当同一身份。 |
| `password_credentials` | `user_id`, `password_hash`, `updated_at` | 每用户一条，且只保存派生后的 hash；ACC-02 负责 Argon2id 与输入验证。 |
| `verification_tokens` | `user_id`, `purpose`, `token_hash`, `expires_at`, `used_at` | purpose 限为 email verification、password reset、identity link；同 purpose/hash 唯一，只能在未使用且未过期时原子消费。 |
| `sessions` | `id`, `user_id`, `refresh_token_hash`, `family_id`, `expires_at`, `revoked_at`, `device_label` | refresh hash 唯一；按 `user_id, revoked_at` 建索引。会话 ID 与对战 seat token 是不同概念。 |

ACC-02 增量：`users.registration_nickname` 保留注册昵称草稿，后续 DAT-02 初始化资料使用；`auth_identities.verified_at` 记录邮箱验证。`EmailAuthRepository.authenticate` 只在内部回调中核对密码 hash，公开返回仍仅可信 userId，不返回 hash。`auth_rate_limits` 为持久化限流；`account_mail_jobs` 为加密的短期邮件投递队列，发送/终止后清空密文。流程与保留边界见 [email-accounts.md](email-accounts.md)。

ACC-03 增量：`sessions.refresh_generation`、`csrf_token_hash` 与 family 索引；`session_refresh_history(token_hash, session_id, generation, consumed_at)` 保留已消费刷新凭证的哈希以检测重放，session/generation 唯一。签发/旋转/撤销、30 天绝对有效期与 10 秒并发宽限见 [sessions.md](sessions.md)。此内部仓储的 hash 不作为公开账户 DTO 返回。

ACC-04 增量：`session_logout_actions(session_id, operation_id, all_sessions, completed_at)`，operation_id 全局 UUID 主键；回执与撤销原子提交，通过原会话 CSRF 绑定只能确认已有结果。活跃会话列表增加 user/created_at/id 索引，公开只输出粗粒度设备类型，不返回原始 UA/IP/凭证。接口与断网重试见 [account-management.md](account-management.md)。

外键全部引用 `users(id)` 并使用 `RESTRICT`，所以硬删除账户必须先经过账户匿名化/清理流程，不能让级联删除悄悄移除审计所需证据。迁移的 `down` 只适用于本地/测试，由迁移器的显式回滚开关保护。
