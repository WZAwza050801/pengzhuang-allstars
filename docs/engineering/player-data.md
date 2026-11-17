# 用户初始化和云存档（DAT-02）

运行时将 PlayerData 注入邮箱注册/登录、微信登录及本人 `/me` 恢复。使用 [BAL-05 已有配置](economy.md) 的 `starter-v1`：p07/p06/p08/p01/p02 五张 Lv1 卡、300 金币、0 碎片，以及已确认的默认阵容顺序；不改奖励经济或位置规则。手机号/本地存档/客户端余额不参与授予。

初始化先锁 users，确认 active，再读取 account_initializations。该表按 user_id 唯一，记录第一次 grantId/economyVersion/dataVersion、资产载荷 SHA256 和默认 lineupId。已有回执直接复用，不因配置升级或其他新 code 再发。profile、持有卡、钱包、五个阵容槽、两种货币的 account.starter 账本、回执与 account.initialized outbox 全在同一事务；中途或末尾失败均回滚。账本业务键仍为 user/account.starter/starter-v1/currency，不用价格版本作为新授予键。

新邮箱注册在排队验证邮件前初始化，邮件入队失败与账户及授予一起回滚；登录须验证邮箱/密码和状态后才补初始化。微信只使用已交换身份，真实平台仍待 ACC-05。旧空账户可在登录或受保护 `/me` 恢复时初始化。已有 profile/wallet/card/lineup 但缺回执的账户返回 409，保留原数据，须 DAT-06 审计迁移，不能用 upsert、补默认余额或“重置存档”绕过。

默认昵称取服务端注册草稿，缺失则“新球员”，复用昵称规范并规范化 NFC；初始 level=1、exp=0、version=0。`avatar_default` 是保留的内置字母/昵称头像 ID，本任务不开放头像上传或任意远程 URL。后续头像选择须接入明确允许的资源集，不将未审核资源 URL 当作可信资料。

| 接口 | 请求和结果 data |
|---|---|
| `GET /api/v1/me` | 保持既有签名身份与 profile DTO，运行时现在返回已初始化的真实 profile。 |
| `GET /me/profile` | nickname/avatarAssetId/level/exp/version，无 userId/角色。 |
| `PATCH /me/profile` | 仅 nickname/avatarAssetId/expectedRevision；只允许 avatar_default；成功返回新 profile，旧 revision 为 409。 |
| `GET /me/cards` | 可选 limit 1–50（默认 20）、UUID cursor；返回 cards/nextCursor，仅本人卡。 |
| `GET /me/wallet` | 两种货币的 currency/balance/version；金额始终十进制字符串。 |

除表内首行外均省略 `/api/v1`。所有读取和更新在事务内复核有效用户/session；客户端不能指定目标 userId、等级、exp、余额、管理员身份或资产来源。未知参数/非法昵称、头像、分页、版本号为 400；版本号上限匹配 PostgreSQL int32，防止大整数转换为数据库 500。并发资料更新只允许同一旧版本中一项成功，不回退覆盖。GET/cards 游标与 owner 条件同时使用，不接受无界全量列表。

初始化回执与 user/lineup 使用外键。封禁、等待注销和已注销账户拒绝初始化，取消注销或解封不再发奖。ACC-06 去标识继续移除 profile/身份并保留账本、UUID 和默认阵容引用；回执只保留资产 hash、内部引用与配置版本，不存昵称/邮箱。代码回退不能反向删除已经授予的资产，schema down 只用于隔离测试。

真实并发、跨设备、失败回滚及资料边界证据见 [DAT-02 报告](../productization/reports/DAT-02.md)。保存阵容/参赛快照由 DAT-03 完成；资产升级/扣款/通用发奖由 DAT-04 完成；本任务没有开放任意“初始化”“加金币”HTTP 端口。
