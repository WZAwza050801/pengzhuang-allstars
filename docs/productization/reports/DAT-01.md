# DAT-01 · 用户业务 schema 与 repository

2026-11-18 在隔离 PostgreSQL 17.12 上实际运行 `npm run test:integration`，3 个文件、22 项通过，无跳过；其中 8 项为新增用户业务数据用例。`npm run check` 全部通过（101 单元、5 契约），生产构建与规划检查通过。

迁移建立资料、静态定义 ID 注册表、持有卡、阵容/槽位、钱包、账本、比赛/参与者与 outbox。真实数据库拒绝未知用户/定义、同用户重复定义、level 11、负余额、int64 溢出、跨用户阵容卡及重复槽位/卡。repository 保留 `9223372036854775807` 和 `-9007199254740993` 的精确字符串表示，JSON 往返不丢精度。注入 outbox 写入后的异常，钱包/账本/outbox 全部回滚；outbox 排除未来/已处理事件，EXPLAIN 验证部分索引可用。

迁移回滚测试已随新增 migration 指向最新 `profiles` 表，确认 down 后消失、up 后恢复。数据字典、所有权与事务边界见 [user-data.md](../../engineering/user-data.md)。用户初始化、升级幂等服务和可靠结算由 DAT-02/DAT-04/NET 后续任务实现。
