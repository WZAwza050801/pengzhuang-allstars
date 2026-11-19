# PostgreSQL 开发与迁移

`npm run test:integration` 默认在本地 Docker 上创建独立 PostgreSQL 17 容器。也可设置 `PG_TEST_BIN_DIR`，使用该目录中的原生 PostgreSQL 17 工具创建一次性集群。两种方式均绑定随机 loopback 端口，随机凭证仅用于临时测试库；测试完成或失败后停止实例并删除临时数据。没有数据库时测试失败，不自动 SKIP，不读取生产 DSN。

镜像摘要固定于 `config/postgres-image.json`，使用显式本地 Docker socket，默认 `/var/run/docker.sock`。其它本地 socket 可用 PG_TEST_DOCKER_HOST 指定；不继承意外的 DOCKER_HOST/CONTEXT/TLS 选择。

Windows 可从 [PostgreSQL 官方入口](https://www.postgresql.org/download/windows/) 链接的 [EDB 二进制包](https://www.enterprisedb.com/download-postgresql-binaries) 获取免安装 ZIP。本次验收使用 `https://get.enterprisedb.com/postgresql/postgresql-17.12-1-windows-x64-binaries.zip`（386263884 字节，SHA256 `a2cd8a774389347b70be7748ac4a37ef43cb6ee539c5fc3e85ae264b15e4a04c`）。该摘要是本次下载的复现指纹。解压后保留 `bin`、`lib`、`share` 的相邻结构；放在英文路径，例如 `C:/Users/31168/AppData/Local/pengzhuang-toolchains/postgresql-17.12-1`，避免 Windows initdb 在中文二进制路径下出现编码错误。工具包无需注册 Windows 服务。

```powershell
$env:PG_TEST_BIN_DIR='C:/Users/31168/AppData/Local/pengzhuang-toolchains/postgresql-17.12-1/bin'
npm run test:integration
```

ACC-02 的集成套件还需真实 Mailpit，不能跳过投递测试。Windows 下载 [Mailpit v1.34.0](https://github.com/axllent/mailpit/releases/tag/v1.34.0) 的 `mailpit-windows-amd64.zip`，校验 SHA256 为 `8f080d41374bf22686606374a0a483c8563c1bf29ae078179792392ff8c911d7` 后解压，设置 `$env:MAILPIT_TEST_BIN` 为 `mailpit.exe` 的绝对路径，再运行同一命令。测试自启回环 SMTP/HTTP 端口，数据库位于本轮 PostgreSQL 的 fixture 临时目录，测试后结束 Mailpit 并清理。CI 固定同版本 Linux 包及发布摘要，不向外部邮箱投递。

ACC-03 集成还需要真实 Chromium：首次执行 `npx playwright install chromium`，Linux 缺系统库时用 `npx playwright install --with-deps chromium`；CI 已包含安装步骤。Cookie/多标签测试使用真实 HTTP 服务和 PostgreSQL，不以手工拼接 Cookie 代替浏览器验收。

runner 检查 PostgreSQL 主版本为 17，使用 OS 临时目录、SCRAM 随机密码、16MB shared_buffers、20 个连接上限和 `127.0.0.1` 监听。每次运行的迁移 fixture 目录独立。原生工具清除继承的 PGHOST/PGPORT/PGPASSWORD 等连接设置，测试子进程只收到新建测试库的 DSN。初始化/启动失败和测试失败均非零退出；停止数据库后对 Windows 短暂文件锁做有界目录清理重试，持续失败则保留临时目录并非零退出，不假称完成。

手动迁移先配置 local 的 DATABASE_URL 或 test 的 TEST_DATABASE_URL，再执行 `npm run db:migrate`。`npm run db:rollback` 仅允许 local/test 显式操作，生产只做已评审的前向兼容迁移/修复。示例文件只列字段，不写真实密码。

业务 repository 接收 SqlExecutor；跨 repository 操作必须由一个 Database.transaction 传入同一 tx，不在 repository 中另开连接或自行COMMIT。SQL参数与语句分开，bigint保留十进制字符串。connection是迁移等基础设施专用的连接租约，不向业务API暴露。

node-pg-migrate 使用数据库advisory lock等待模式和单事务；重复执行无待处理迁移时返回空结果。迁移文件须与部署产物一起交付；当前源码CLI读取 packages/persistence/migrations，未来打包部署必须显式携带此目录或指定migration目录，不能只发布一个server.js。

当前已包含 ACC/DAT 的账号、会话、生命周期、卡牌、钱包、账本、outbox 和一次性初始化回执；service_metadata 是最初的基础设施验证表。业务行为及约束见 [用户初始化和云存档](player-data.md)、[生命周期](account-lifecycle.md) 与对应任务报告，不能仅凭建表判断业务已经验收。

DAT-06 迁移 `202611180016_data_repairs.mjs` 仅扩展维护回执、索引及不可变触发器，不执行任何历史余额修复或生产角色授权。维护命令单独使用 `MAINTENANCE_DATABASE_URL`，不会自动迁移/初始化/发奖；用法和保留策略见 [数据维护](data-maintenance.md)。测试运行器还为临时数据库设置每轮随机 fixture 标记，数据工厂写入前必须同时匹配库名和标记，不能用于生产造数。

NET-05迁移 `202611180017_match_checkpoints.mjs` 新增账号局追加快照与持有权head，不改既有结果或资产。部署同时保留原数据库与 `pending-outcomes/account-recovery` 日志卷；旧无快照账号记录只报告不可恢复，不伪造局面。回收仅处理符合证明的恢复缓存，业务历史保留。具体时钟、冲突、迁移/回退与日志域约束见[重启接管手册](match-checkpoints.md)。数据维护孤立引用目录随新表扩展至18类。
