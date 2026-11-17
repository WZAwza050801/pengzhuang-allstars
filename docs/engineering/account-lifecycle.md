# 绑定、注销与封禁（ACC-06）

生命周期服务复用 [账户与设备会话](account-management.md) 的 Cookie、Origin、CSRF 和用户→会话锁顺序。所有受保护写入在业务事务内再次验证账户 active、会话未撤销且未过期。API 严格拒绝客户端 userId、role、status、providerAppId 和 OpenID 等权威字段。

## 重新认证与身份绑定

`POST /api/v1/me/reauthenticate` 接受 `{method:"password",password}` 或 `{method:"wechat",code}`。密码必须匹配当前账户的真实 Argon2 凭据；微信 code 必须由服务端交换并属于当前账户。成功只给当前 session 写入五分钟的近期认证时间，返回 authenticatedUntil；另一个同账户会话不继承它。每次使用均按数据库实际时钟检查。

`POST /me/identities/link`（以下省略 `/api/v1`）要求近期认证：

- 邮箱：`{provider:"email",email,password}`，新密码 12–256 字符，返回 202 accepted。实际 SMTP 邮件使用 fragment token；`POST /me/identities/confirm {token}` 同时要求发起绑定的用户、session、近期认证和有效单次 token。成功事务一起写入已验证身份、密码、消费记录和审计，返回 200 linked。当前已有邮箱不支持在此覆盖。
- 微信：`{provider:"wechat",code}`，成功返回 200 linked；复用 [微信服务](wechat-identity.md) 的持久 code 占用，同 code 不能跨登录、绑定、重新认证及注销恢复重复使用。不存在时只绑定当前用户，绝不创建另一个用户后合并。

身份已属于另一用户统一 409，不合并钱包、卡牌或比赛记录。邮箱请求不提前披露是否被占用，只有持有邮箱 token 并完成认证的确认阶段才裁定冲突。过期、错误目的、另一用户/会话或重放 token 均不能完成绑定。已用/过期的待绑定邮箱和密码 hash 每轮最多清理 50 条；过期/已用的加密邮件载荷也会被清空，即使邮件投递当前关闭。邮件系统原有终止/发送清理仍生效。

重新认证、绑定和恢复使用数据库持久限流：每动作 IP 50/15 分钟，目标 10/15 分钟；真实 socket 地址，不信任转发头。密码验证共享单实例 KDF 并发预算；微信还使用共享 provider 限流。凭据和邮箱不写审计或错误日志。

## 注销申请、恢复与擦除

`GET /me/deletion-policy` 返回 enabled/graceHours/version。`DELETE /me {confirm:"DELETE"}` 要求近期认证；202 返回 requested/executeAt/policyVersion。排期、账户 deleting、全部会话不可逆撤销及审计在同一事务提交，提交后才清凭证 Cookie。普通登录、刷新和业务访问立即拒绝。

等待期内用完整凭据调用 `POST /auth/deletion/status` 或 `/auth/deletion/cancel`：密码方式 `{method:"password",email,password}`，微信方式 `{method:"wechat",code}`。它们保留 Origin/签名 CSRF 防护，但不依赖已撤销 access。状态返回 none/pending/cancelled、executeAt 和 policyVersion；已擦除的凭据无法再识别原账户，返回统一 401。申请响应丢失时必须用该凭据查询确认，不能把 401 当作注销已成功。

取消在执行期限之前、无有效封禁时成功，重复取消 200；已到期 409，凭据错误 401，等待注销同时被封禁则取消 403。取消只恢复账户 active，原会话始终无效，必须重新登录。到期擦除与取消都先锁用户，再锁申请，避免两条路径同时胜出。

运行时启动一秒间隔、单实例 single-flight 后台任务，每轮最多处理 10 个到期申请及 10 个到期封禁；多实例使用用户行锁和 SKIP LOCKED。同一申请的擦除和完成审计同事务：失败全部回滚，数据库 pending 留待重试；一项失败不会阻断同批其他账户。重启不丢申请，完成后重复运行不重复审计。关闭服务先停定时器并等待当前批次，再关闭资源。

| 数据 | 到期操作与保留边界 |
|---|---|
| 邮箱/微信身份、密码、verification token、绑定请求、邮件队列 | 删除该用户记录，包括待发加密载荷。 |
| profile、注册昵称、旧存档导入回执（含昵称草稿）、用户自定义阵容名 | 删除 profile/注册昵称/导入回执；阵容名替换为固定“已注销阵容”。 |
| 会话 | 全部撤销；清 CSRF、设备自由文本、近期认证；refresh hash 改为不可用墓碑值，删除刷新历史与退出回执。 |
| user UUID/状态/时间、钱包、持有卡、账本、阵容引用、比赛参与记录/静态卡快照 | 保留一致性和审计外键；不重新发放或转移资产，不删除账本、不损失 bigint 精度。注销后重新注册是新账户。 |
| 生命周期审计、封禁记录、微信 code 防重放指纹 | 保留内部 UUID、固定动作/原因及时间，不含邮箱、密码、原始 code/token、IP/UA。按对应清理与审核策略管理，不能提前删除占用以恢复 code 重放。 |

这是移除直接标识并保留可关联 UUID 的工程实现，不能宣称不可关联的完全匿名化。当前没有自动删除备份、第三方收件系统数据或历史审计/账本的期限任务；上线时须由 REL-02/OPS 明确渠道隐私告知、各类保留期限、备份到期和恢复后的擦除重放方案。本地默认 168 小时只是工程默认值，并非法律结论。

`ACCOUNT_DELETION_ENABLED` 在 staging/production 默认 false，本地/test 默认 true；grace 范围 0–2160 小时。生产启用同时要求显式 `ACCOUNT_RETENTION_POLICY`（1–80 个字母数字、点、下划线或短横线）与 `ACCOUNT_DELETION_GRACE_HOURS`，不允许隐式采用开发策略。关闭开关同时停止新申请及已排期擦除；查询、取消、过期链接清理和封禁到期处理继续。重新开启前应检查积压到期申请。工程配置不替代渠道审核，REL-02 仍未完成。

## 封禁与权限

`AccountLifecycle.ban/unban` 是服务端内部端口，没有玩家 HTTP 封禁路由。原因只允许 security/abuse/policy/support；未来 ADM 接入时必须先验证真实管理员权限，再传入可信 actorId。封禁、会话撤销和审计同事务；可配置到期，后台解封也写审计。

数据库 users status 变为非 active 时自动永久撤销其现有会话并清近期认证，覆盖底层状态迁移入口。解封不复活凭据。注销等待期内封禁不取消擦除排期。所有账号 HTTP/刷新即时检查数据库状态；NET-01/03 尚未实现的房间票据必须绑定 sessionId，并在消费/重连时复用此检查。旧 Demo 游客房间不计为已登录房间鉴权完成。

`account_audit_events` 固定字段并由触发器拒绝 UPDATE/DELETE；系统任务 actor 为空，用户行为记录本人，管理员行为由未来 ADM 提供已验证 actor。数据库所有者仍可修改 DDL，OPS 必须隔离运行身份与迁移权限，不能将本触发器当作对超级用户不可篡改的保证。

## 迁移与验证

`202611180007_account_lifecycle.mjs` 增加近期认证列、绑定请求、注销排期、封禁、追加审计及状态撤销触发器。迁移 down 仅用于隔离测试，不能恢复已擦除身份/资料，也不复活会话。业务代码回退前先停后台，保持生产注销开关关闭并评估 schema 兼容。

真实 PostgreSQL、HTTP、SMTP、失败注入及运行时后台启动证据见 [ACC-06 报告](../productization/reports/ACC-06.md)。微信上游为契约替身，真实平台资格和 code 仍由未勾选 ACC-05 验证；本任务没有解除设备、素材授权、平衡或渠道发布门槛。
