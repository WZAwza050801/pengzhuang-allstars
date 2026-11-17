# PostgreSQL 开发与迁移

`npm run test:integration` 默认在本地 Docker 上创建独立 PostgreSQL 17 容器。也可设置 `PG_TEST_BIN_DIR`，使用该目录中的原生 PostgreSQL 17 工具创建一次性集群。两种方式均绑定随机 loopback 端口，随机凭证仅用于临时测试库；测试完成或失败后停止实例并删除临时数据。没有数据库时测试失败，不自动 SKIP，不读取生产 DSN。

镜像摘要固定于 `config/postgres-image.json`，使用显式本地 Docker socket，默认 `/var/run/docker.sock`。其它本地 socket 可用 PG_TEST_DOCKER_HOST 指定；不继承意外的 DOCKER_HOST/CONTEXT/TLS 选择。

Windows 可从 [PostgreSQL 官方入口](https://www.postgresql.org/download/windows/) 链接的 [EDB 二进制包](https://www.enterprisedb.com/download-postgresql-binaries) 获取免安装 ZIP。本次验收使用 `https://get.enterprisedb.com/postgresql/postgresql-17.12-1-windows-x64-binaries.zip`（386263884 字节，SHA256 `a2cd8a774389347b70be7748ac4a37ef43cb6ee539c5fc3e85ae264b15e4a04c`）。该摘要是本次下载的复现指纹。解压后保留 `bin`、`lib`、`share` 的相邻结构；放在英文路径，例如 `C:/Users/31168/AppData/Local/pengzhuang-toolchains/postgresql-17.12-1`，避免 Windows initdb 在中文二进制路径下出现编码错误。工具包无需注册 Windows 服务。

```powershell
$env:PG_TEST_BIN_DIR='C:/Users/31168/AppData/Local/pengzhuang-toolchains/postgresql-17.12-1/bin'
npm run test:integration
```

runner 检查 PostgreSQL 主版本为 17，使用 OS 临时目录、SCRAM 随机密码、16MB shared_buffers、20 个连接上限和 `127.0.0.1` 监听。每次运行的迁移 fixture 目录独立。原生工具清除继承的 PGHOST/PGPORT/PGPASSWORD 等连接设置，测试子进程只收到新建测试库的 DSN。初始化/启动失败和测试失败均非零退出；清理失败会保留临时目录并报错，不假称完成。

手动迁移先配置 local 的 DATABASE_URL 或 test 的 TEST_DATABASE_URL，再执行 `npm run db:migrate`。`npm run db:rollback` 仅允许 local/test 显式操作，生产只做已评审的前向兼容迁移/修复。示例文件只列字段，不写真实密码。

业务 repository 接收 SqlExecutor；跨 repository 操作必须由一个 Database.transaction 传入同一 tx，不在 repository 中另开连接或自行COMMIT。SQL参数与语句分开，bigint保留十进制字符串。connection是迁移等基础设施专用的连接租约，不向业务API暴露。

node-pg-migrate 使用数据库advisory lock等待模式和单事务；重复执行无待处理迁移时返回空结果。迁移文件须与部署产物一起交付；当前源码CLI读取 packages/persistence/migrations，未来打包部署必须显式携带此目录或指定migration目录，不能只发布一个server.js。

当前首个真实表是 service_metadata，用于验证基础设施；账号、卡牌、钱包和outbox业务表由ACC/DAT任务实现。不要把迁移基础设施完成当作用户系统已完成。
