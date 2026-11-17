# ARC-04 · 真实数据库和事务边界

日期：2026-11-17。实现私有 @pengzhuang/persistence，精确依赖 pg8.23.1、node-pg-migrate9.0.0；真实PostgreSQL17镜像摘要在 config/postgres-image.json，未用内存Mock替代集成验证。

- Database管理连接池、幂等close、连接租约和事务；BEGIN/COMMIT/ROLLBACK属于service事务范围，rollback失败丢弃连接。
- MetadataRepository使用参数化SQL；同一tx可注入多个repository；bigint驱动结果不转为JS number。
- 首个migration创建service_metadata。迁移使用真实advisory lock等待控制并发和单事务批次；重复启动不重复执行。
- CLI校验分环境配置，down仅local/test；生产不自动跑破坏性回滚。迁移和服务启动分开。
- test:integration创建随机端口/凭证/独立数据库并清理容器，不打印DSN；缺真实数据库条件将失败。

## 本次验证

check通过（11项unit、4项契约）；真实PostgreSQL集成1文件/5测试通过：

1. 全新库并发迁移只应用一次，重复迁移无操作；实际server_version_num属于17系列。
2. 两repository共享事务，业务失败均回滚；成功事务可读到提交内容。
3. 恶意字符串被作为参数保存，表未被注入删除；大于JS安全整数的bigint原样返回字符串。
4. 迁移批次后续SQL故意失败，前面创建的DDL回滚。
5. 未授权down拒绝；显式本地回滚和再次up成功；连接池重复close无泄漏。

当前Vitest版本使用默认串行测试和integration project的fileParallelism=false；没有使用不兼容的describe.sequential，也没有跳过用例。账号资产表、生产备份和发布仍是后续任务。
