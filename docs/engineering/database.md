# PostgreSQL 开发与迁移

`npm run test:integration` 在本地 Docker 上创建独立 PostgreSQL 17 容器，绑定随机 loopback 端口，随机凭证仅通过进程环境传递；测试完成或失败后删除容器。没有数据库时测试失败，不自动 SKIP，不读取生产 DSN。

镜像摘要固定于 `config/postgres-image.json`，使用显式本地 Docker socket；本环境按云运行指南探测 `/var/run/docker.sock`。其它本地 socket 可用 PG_TEST_DOCKER_HOST 指定；不继承意外的 DOCKER_HOST/CONTEXT/TLS 选择。没有 Docker 时先恢复本地运行环境，不能伪造数据库通过。

手动迁移先配置 local 的 DATABASE_URL 或 test 的 TEST_DATABASE_URL，再执行 `npm run db:migrate`。`npm run db:rollback` 仅允许 local/test 显式操作，生产只做已评审的前向兼容迁移/修复。示例文件只列字段，不写真实密码。

业务 repository 接收 SqlExecutor；跨 repository 操作必须由一个 Database.transaction 传入同一 tx，不在 repository 中另开连接或自行COMMIT。SQL参数与语句分开，bigint保留十进制字符串。connection是迁移等基础设施专用的连接租约，不向业务API暴露。

node-pg-migrate 使用数据库advisory lock等待模式和单事务；重复执行无待处理迁移时返回空结果。迁移文件须与部署产物一起交付；当前源码CLI读取 packages/persistence/migrations，未来打包部署必须显式携带此目录或指定migration目录，不能只发布一个server.js。

当前首个真实表是 service_metadata，用于验证基础设施；账号、卡牌、钱包和outbox业务表由ACC/DAT任务实现。不要把迁移基础设施完成当作用户系统已完成。
