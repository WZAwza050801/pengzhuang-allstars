# ACC-04 · 当前用户与设备会话

2026-11-18，Windows / Node 24.22.1 / PostgreSQL 17.12 / Mailpit 1.34.0 / Playwright Chromium 实际验收。本轮未使用远端服务器。接口、隐私字段和重试约束见 [account-management.md](../../engineering/account-management.md)。

| 验证 | 证据 |
|---|---|
| `npm run test:integration` | 5 文件 / 54 项通过，0 跳过；会话部分 20 项，真实 SMTP 邮箱部分 12 项，包含运行时实际挂载 `/me` 与退出。 |
| `npm run check` | 112 单元 / 6 契约及静态、配置、生成契约检查通过。 |
| `npm run build` | 生产客户端与服务端构建通过。 |
| `npm run test:e2e` | 18 PASS / 0 SKIP / 0 FAIL，页面 console error/pageerror 均 0。 |

真实 HTTP/数据库覆盖：当前身份来自签名及会话，档案取真实数据或 null；他人和不存在的撤销目标同为 404；本人设备可重复撤销；查询/写入不能指定他人 userId。会话列表只返回粗粒度设备种类，旧任意标签被隐藏，分页保留微秒并正确处理同时间戳 UUID 排序；非法上限、游标、重复参数和 PostgreSQL 不接受的零年日期均 400。

退出覆盖当前设备/所有设备、access Cookie 缺失时通过 refresh 退出、历史凭证与即时撤销、与刷新竞争。回执持久化失败注入证明所有撤销一起回滚，重试原操作可成功；回执跨 service 实例可确认。真实 HTTP 提交后注入响应体丢失并模拟清 Cookie 已生效，先得到 logout-pending，重试同操作确认成功。之后的新登录既不被再次撤销，也不被旧操作清 Cookie；同操作改范围 409，已撤销凭证不能发起新的全部退出。

真实 Chromium 运行生产用 WebAccountClient、平台网络适配器和 LoginStateModel：删除 access Cookie 后，四个并行受保护读取只触发一次刷新；另一标签退出后，原标签重新恢复为 anonymous，凭证 Cookie 已清。测试页面通过内存 bundle 注入模块，不向生产客户端发布调试入口；测试身份 adapter 只存在测试，实际邮箱注册/登录仍由真实 SMTP 套件验证。

客户端单元覆盖恢复 single-flight、迟到响应不复活登录、网络错误、退出原意图重试、范围不能暗改、刷新失败结果在迟到并发 401 间复用、最多一次原请求重放、畸形响应和非法撤销目标。金额 schema 移到独立模块以避免 HTTP/账户契约循环，原 MoneySchema 导出路径保持兼容；平台依赖清单与 lock 仅补齐已有工作区/Zod 依赖，无新增外部版本。

首轮发现测试将运行时断言接入了仅有邮箱路由的 fixture，以及 HTTP request 观察点读取了 Express 临时改写的 URL；修正测试装配/使用浏览器原始请求 URL 后通过。响应头已清 Cookie 的退出重试先以真实 HTTP 失败回归复现，再用持久回执确认修正。

后续：DAT-02 初始化资料与资产；ACC-07 接账号页面/生命周期；NET-01/03 才提供并消费真实房间票据，必须绑定 sessionId 并检查即时状态，本报告不冒称旧 Demo 房间已有账号鉴权。真机仍按用户要求暂缓。已有依赖、素材授权和平衡放量门槛未解除；此前被审批拒绝删除的停止态测试临时目录保持原状，本轮无新增残留 PostgreSQL/Mailpit 进程。
