# FND-04 · 分环境配置与安全启动

日期：2026-11-17。实现 `config/runtime.ts`，服务端 index 在监听端口前读取并校验配置。

## 行为

- local/test/staging/production 明确区分；development 兼容映射 local。NODE_ENV=production 不能通过 APP_ENV=local 绕过生产校验。
- 本地默认端口 2567，ROOM_STORE_DIR 可配置且解析为绝对路径；默认对战行为不变。
- staging/production 必须提供 HTTPS PUBLIC_ORIGIN、PostgreSQL DSN、足够长度且非重复/示例的签名密钥；Secure Cookie 开启；开发绕过和 Mailpit 被拒绝。
- origins 不接受通配符、凭证、路径、query 或 fragment；SMTP/微信启用时验证相应必填字段。邮件和微信接入本身仍是后续任务。
- test 只读 TEST_DATABASE_URL；有 DATABASE_URL 却没有测试地址时明确失败，测试库名称要求带独立 test 标识。
- 配置错误只返回字段名，不包含提供的值；describeRuntimeConfig 不输出 DSN、签名密钥或 provider secret。
- `.env.example` 仅本地模板和秘密字段名；真实秘密由环境注入。data/rooms 已加入忽略与素材扫描排除范围。

## 验证

`npm run test:config` 5 个行为测试通过，覆盖默认值、端口/布尔值/Origin、生产强制条件与绕过、测试 DSN 隔离、provider 缺失和脱敏。`npm run typecheck`、`npm run build:server` 通过。

对真实构建产物启动进程：生产配置缺失时退出非零，stderr 不含注入的秘密哨兵；local 用独立临时存档目录启动后 `/healthz` 返回 200，结束后清理进程。

运行 `npm run check:config` 可查看脱敏配置摘要。当前 API/账号/数据库服务尚未由配置自动实现，不把通过配置校验描述为已完成真实 provider 接入。
