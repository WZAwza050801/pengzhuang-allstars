# 服务端装配

`server/runtime.ts` 是启动组合根：先加载验证过的 GameData，再按配置建立 Database/RoomStore，确认数据库可连后监听并恢复房间。迁移仍需显式运行，不自动更改数据库。`server/app.ts` 保留无参数 `createGameServer()` 供原联机验证使用；支持注入 repository、clock、resolveData、roomStore、outcomeSink 和关闭资源。Colyseus 使用进程级 matchMaker，因此同进程只运行一个实例；测试使用独立 worker 或顺序启动。

当前账号服务承接原游客身份校验，资产服务提供实际只读 `/api/v1/catalog`，对战服务承接配置和房间恢复。持久账号、用户资产增删和可靠结算分别由 ACC、DAT、NET 实现，不能把当前服务边界当作这些功能已经完成。OutcomeSink 在装配上下文中可注入，默认 null，未暴露客户端入口，未改变现有比赛结束/奖励行为；NET-04 必须接入可靠持久化流程，不能仅调用一个异步观察者后立即清理记录。

业务模块实现 `ApiModule`，通过 `createRouter(context)` 获取显式依赖，按 auth/me/matches/catalog 领域挂载 `/api/v1`。异步控制器使用 `asyncRoute`，预期错误用 `ApiError`，未知异常统一返回固定 500 文案。请求 ID 在服务边界重新生成并随响应返回；错误事件只含 requestId、method、稳定 code/status，不记录请求体、原异常、路径参数和凭证。

API JSON 上限 32 KiB；未知 API（包括 `/api` 本身）返回统一 JSON 404。SPA fallback 排除 api、healthz 和 readyz。`/healthz` 检查存活；`/readyz` 检查可服务状态及真实数据库连接，失败 503。尚无数据库的本地 Demo 允许运行；部署配置仍要求数据库。

`close()` 幂等，先排空房间与关闭 HTTP/WS，再逆序关闭持有的资源；即使一个清理失败也继续其余清理。启动失败会释放已装配资源。入口处理 SIGINT/SIGTERM，最长等待 15 秒，关闭失败非零退出，日志不输出未经筛选的异常。恢复失败保留记录供检查，避免旧入口直接删除失败记录；跨数据版本恢复策略属于 NET-05。

验证：`npm run test:unit -- tests/server.test.ts` 使用真实 HTTP 及系统端口，覆盖 API/SPA、requestId、异步异常、坏 JSON、超限、readiness、依赖注入、清理顺序、重复关闭、顺序重启和端口占用后的恢复。原 `test:net` 保留房间协议回归。
