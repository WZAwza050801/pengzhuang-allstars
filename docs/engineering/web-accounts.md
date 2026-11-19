# Web 账号页面（ACC-07）

React 页面壳接入真实 [邮箱 API](email-accounts.md)、[设备会话](account-management.md) 与 [生命周期服务](account-lifecycle.md)。“我的”进入账号，游客仍可直接练习；余额、云端卡牌和联机凭证由 DAT/UI/NET 后续接入。

| 路径 | 行为 |
|---|---|
| `/login` | 邮箱密码登录；真实恢复 `/me` 后回到项目内原目标，默认“我的”。 |
| `/account/register` | 注册及邮件投递申请；统一收信提示，不披露已有邮箱。 |
| `/account/resend`、`/account/forgot` | 重发验证或找回邮件、限流/网络失败可重试。 |
| `/account/verify`、`/account/reset`、`/account/link` | 用户明确提交后验证、重设或确认绑定。 |
| `/profile` | 真实设备分页/撤销/退出、绑定状态、近期认证/邮箱绑定、注销申请。 |
| `/account/deletion` | 用原邮箱密码查询/取消注销；取消成功仍需重新登录。 |

启动时立即移除邮件地址栏 fragment，有效形状 token 只留内存，成功消费后清除；刷新后重新打开邮件。密码只在表单/请求短期存在，成功后清表单。没有密码或 token 的 localStorage/sessionStorage 写入。label 与说明使用独立 aria-describedby，输入支持 autocomplete、密码长度及键盘焦点。回跳使用 NavigationTargetSchema 和已开放功能校验，不接受任意外部网址。错误只显示固定文案，不透传堆栈/message/raw JSON。

`GET /api/v1/auth/options` 返回 emailEnabled/wechatMiniProgram/sessionPresent，no-store；sessionPresent 只是 Cookie 恢复提示，授权仍须签名和数据库。无凭据时避免必然失败的 `/me`/refresh；有凭据时走真实恢复。`GET /api/v1/me/identities` 仅本人读取 email/wechat 布尔值，不下发主体标识或邮箱。已有邮箱不能覆盖；纯微信身份需在小游戏重新认证/绑定，Web 不提供手工 code/OpenID 输入，也不冒称已实现网页微信 OAuth。

AccountProvider 管理单个 WebAccountClient/LoginStateModel 和平台网络适配器，统一订阅 focus/pageshow/online/visibilitychange、BroadcastChannel。广播仅固定 session-changed，不传身份/凭据。检查 single-flight，旧 options 和 `/me` 不可覆盖新登录；销毁时移除订阅、关闭 channel 并中止请求。表单同步锁防双击，离开后忽略迟到 UI 结果。密码/重新认证失败不会自动刷新或重放密码；受保护读取仍复用并发刷新合并和一次重放。

退出失败保留同一幂等键，显示“尚未确认”并显式重试，不能提前显示成功或暗改范围；成功后广播同步其他标签，无 BroadcastChannel 时在聚焦/回前台复核。注销要求当前密码及输入 DELETE，使用实际等待期，失败提示凭据查询而非自动重试；成功后完整加载固定同源恢复页，避开旧路由守卫竞争并释放敏感页面内存。保留边界、生产默认关闭与渠道规则仍见生命周期文档。

账号组件独立动态加载，复用 tokens、44px 操作目标及可滚动内容区；小屏/软键盘/大字体/桌面键盘均有实际验收。布局及性能脚本使用独立回环 API/Vite 或真实静态服务，不依赖开发者 2567 端口。证据及限制见 [ACC-07 报告](../productization/reports/ACC-07.md)。
