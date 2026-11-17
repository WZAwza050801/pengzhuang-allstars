# ACC-01 · 长期用户和身份持久化验收

2026-11-18 在 Windows 本地隔离 PostgreSQL 17.12 上运行 `npm run test:integration`，2 个文件 / 14 项通过，0 跳过。`npm run check` 全部通过，包含 101 单元与 5 契约测试。源码 schema、仓储和数据字典已在此前 `07186dd` 任务增量中落地，本次补齐真实运行证据与可复用原生测试入口。

账户测试 8 项覆盖长期 UUID 用户、封禁与注销状态迁移、删除终态、并发身份三元唯一、相同 subject 的 appId 隔离、同用户同 app 的绑定唯一、RESTRICT 外键、凭据 hash 的非公开输出、token 过期/目的隔离/并发一次性消费、会话 hash 唯一及跨用户撤销拒绝。持久化测试 6 项覆盖主版本检查、迁移重复/并发、事务整体回滚、恶意 SQL 字符串参数化与 bigint 精度、失败迁移 DDL 回滚及显式 migration down/up。

原生 runner 通过 `PG_TEST_BIN_DIR` 选择已有 PostgreSQL 17 工具，使用独立临时集群、随机 loopback 端口及随机 SCRAM 密码。每轮结束停止数据库并删除临时存储。实测结束后无 PostgreSQL 进程及 `allstars-pg-test-*` 目录残留。Docker 路径继续使用固定摘要镜像；远端 CI 加入相同 integration 入口，实际 CI 状态待 GitHub 执行。

复现与二进制指纹见 [database.md](../../engineering/database.md)。账户数据字典见 [accounts.md](../../engineering/accounts.md)。注册登录、密码派生、邮件和会话旋转分别由后续 ACC 任务实现。
