# ACC-02 · 注册、邮箱验证与密码找回

2026-11-18 本地实际运行 `npm run test:integration`：PostgreSQL 17.12、Mailpit 1.34.0、4 个文件 / 33 项通过，邮箱账号部分 11 项。测试通过真实 HTTP 请求注册、通过真实 SMTP 进入 Mailpit，并从 Mailpit 收件 API 取得一次性链接后验证/找回；不使用邮件 mock。配置、参数和复现入口见 [email-accounts.md](../../engineering/email-accounts.md) 与 [database.md](../../engineering/database.md)。

验证覆盖并发重复注册只建一个身份、未知/未验证/封禁账号一致拒绝、一次性 token 并发/过期/目的隔离/重放、重置密码后的旧密码拒绝与会话撤销、验证重发、队列插入失败整体回滚、SMTP 失败后的数据库保留和服务重建重试、真实运行时装配/关闭、持久限流与并发计数。投递成功后清空短期邮件密文，业务接口没有 hash/token 输出。

`npm run check` 通过（104 单元、5 契约），构建通过。首次生产 E2E 揭示了工作区包导入无法由 bundle 原生加载的问题，修正并重建服务端后，真实浏览器游戏 E2E 18/18 通过。

本机 i7-13700H 的 Argon2id 参数为 64MiB/t3/p1，五次 hash 78/78/82/85/72ms。npm 官方审计：新增 Argon2/Nodemailer 无审计条目；既有依赖树仍有 15 high、14 moderate、2 low，0 critical。发布仍需升级和复验已有依赖；本地 SMTP 收信也不等于外部供应商域名/到达率已验收。

ACC-03 负责签名会话/Cookie/刷新旋转，ACC-07 负责实际账号和邮件链接页面，当前登录 API 只完成可信凭据验证，不将其写成完整 Web 登录已交付。
