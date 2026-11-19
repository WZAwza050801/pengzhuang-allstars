# ACC-05 · 本地实现完成，真实微信验收阻塞

任务保持未勾选。2026-11-18 当前进程/用户环境没有微信启用标识、AppID 或 Secret，项目仅有 .env.example；私有凭据清单未发现微信条目，也未取得授权测试 app 的有效/过期 code。只输出了配置存在性，没有打印真实凭据。本轮没有调用真实 code2Session 或使用远端服务器。

| 本地验证 | 实际结果 |
|---|---|
| `npm run test:integration` | 6 文件 / 65 项通过、0 跳过；微信部分 11 项为 mock 上游 + 真实 PostgreSQL/HTTP；另外包含真实 SMTP 和浏览器会话回归。 |
| `npm run check` | 116 单元 / 7 契约及静态、配置、生成契约检查通过。 |
| `npm run build` / `npm run test:e2e` | 生产构建通过；原游戏浏览器回归 18 PASS / 0 SKIP / 0 FAIL。 |
| `npm run verify:wechat` | 缺配置时在 configuration 阶段按预期非零退出；无真实交换、无成功报告，不能记为通过。 |

覆盖固定上游地址/服务端 scope、查询编码、默认 TLS/禁重定向、体积及 JSON 校验、真实 HTTP 响应体卡住时中止、错误脱敏、不返回 session_key/UnionID。数据库验证并发重复 code 仅一次上游调用、跨实例仍消费、不同 code 同一 OpenID 单用户/无孤儿、AppID 与未核实 UnionID 隔离、禁止伪造身份字段、封禁/注销中拒绝、过期本地提交回滚、会话插入失败原子回滚、持久 IP 限流及启用 provider 的真实运行时装配。

新增第三套账号 HTTP 测试时，将已有两套相同传输逻辑合并为共享真实 JSON HTTP helper，保留真实服务和数据库，未替换为 mock。新增外部依赖为零。成功/失败的 code 只存 HMAC，缺配置的验收命令不连数据库/上游。新 migration down/up 在一次性 PostgreSQL 实际通过。

实现边界、官方来源及真实验收流程见 [wechat-identity.md](../../engineering/wechat-identity.md)。当前 HTTP 路由是 Web Cookie 交付；WX 原生 adapter/存储与真实客户端仍属 WX 工作包，未在此冒称完成。

解除条件：提供已授权测试小游戏的私有凭据，使用本机专用测试库运行 `verify:wechat`，实际通过有效/过期/重放与自有会话；凭据持有者确认 code 来源与时间后补充真实证据。无凭据时继续 ACC-06 / DAT-02，不能把本地 mock 的通过数当作真实验收。
