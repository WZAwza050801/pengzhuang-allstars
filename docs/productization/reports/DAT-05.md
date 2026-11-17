# DAT-05 · 旧本地偏好导入

2026-11-18；Windows / Node 24.22.1 / npm 11.9.0 / 隔离 PostgreSQL 17.12 / Chromium。兼容键、API、账号隔离、一次性标记和数据清理见 [local-import.md](../../engineering/local-import.md)。未使用远端。

| 验证 | 实际结果 |
|---|---|
| 单项验证 | 6 项解析/契约边界单元通过；8 项真实 PostgreSQL/HTTP 与 11 项账号页浏览器集成通过。 |
| `npm run test:integration` | 12 文件 / 141 项通过，0 跳过，含 SMTP、账号/生命周期/阵容/资产及生产挂载回归。 |
| `npm run check` | 128 单元 / 10 契约；工具链、边界、lint、217 文件格式、类型、配置、规划、生成数据检查通过。最终 `format:check` 和 OpenAPI `--check` 复核通过。 |
| `npm run build` | 生产客户端和服务端通过。 |
| `npm run test:e2e` | 18 PASS / 0 SKIP / 0 FAIL，0 console/pageerror。 |

检查 `pz_nick`、`pz_skin`、`pz_muted`、`pz_lineups`，只生成合法偏好命令。新存储无导入意图；损坏 JSON、重复/未知/对象球员、超大内容、非法皮肤/昵称、存储拒绝有固定提示，独立有效项保留。不上传 `pz_profile`、`pz_card_level`、服务器地址、房间码或凭据。

真实服务将定义按原槽顺序转换为本人持有且 active 的 ownedCardId，缺卡/禁用/未知整套跳过，active 指向被跳过套组则归 null。钱包、卡等级、原云昵称和正式阵容前后完全一致。六路并发同载荷与新服务实例重放均得到同一回执；不同载荷冲突，只有一行账号标记，不追加新手流水或资产 outbox。

两个账号的 marker 与卡 UUID 各自独立；预览账号和 Cookie Principal 不匹配时 GET/POST 均拒绝，不能把旧请求落到切换后的账号。会话、CSRF、query、封禁和禁止额外资产/用户字段均实际验证。首次初始化和导入标记同事务：在标记 INSERT 注入真实 SQL 故障，资料/钱包/卡/标记全部回滚；解除后原意图可重试，新手资产仍只发一次。账号到期擦除删除含昵称草稿的导入回执，保留原账本。生产 runtime 实际挂载。

手机浏览器从真实账号页检查旧存档、查看预览并确认；服务器已保存后主动丢弃响应，页面保留原预览，重试后展示已导入。旧 JSON 伪造巨额金币和 10 级卡，数据库仍为 300 金币、全部初始 1 级；原练习 JSON 未删改。手动应用已保存的声音/球场设置、刷新后查询 marker、退出切换另一账号均验证。损坏 JSON 与 localStorage getter 抛错没有触发导入。截图 `work/acc07-browser/local-import-mobile.png` 已实际查看，390px 页面内容和操作无横向溢出；截图是本地浏览器证据，不是真机验收。

首轮 SQL 测试发现 fixture 的 text/uuid 混用、封禁/注销必需时间列缺失及误写不存在的 grace_hours；按现有 schema 修正后目标及全量通过，没有修改生产约束。无新增依赖，无经济/物理参数变更，隔离 PostgreSQL/Mailpit 正常停止。昵称和阵容偏好用于后续 UI-03/04 的用户确认，正式使用仍重新校验。真实微信、设备、素材授权、依赖审计和平衡发布门槛保留。完成后 49/112；下一项 UI-03，第 50 项完成后同步 GitHub。
