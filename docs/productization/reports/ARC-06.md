# ARC-06 验收记录

完成服务端组合根、领域服务分隔、模块路由、可注入配置/仓储/时钟/结果端口、HTTP 错误中间件和幂等关闭。实际游客校验、只读配置目录和房间恢复由对应 service 承接；持久账号、用户资产和可靠结算继续由后续任务负责。详见 `docs/engineering/server.md`。

本次实际验证（Node 24.22.1 / npm 11.9.0）：

- `npm run check` 通过，包含 17 unit、4 contract、边界/类型/配置/清单/资源及生成契约一致性。
- `npm run build:server` 通过。
- `NET_TEST_PORT=0 npm run test:net`：176 PASS / 0 FAIL；运行结束健康检查 200，无未捕获异常。
- 最后调整 HTTP 关闭等待后，再运行 `npx vitest run --project unit tests/server.test.ts`：2 PASS，真实 HTTP、API/SPA 404、requestId、异步异常脱敏、400/413、数据库故障的 503、清理顺序/幂等、顺序重启、占用端口启动失败及随后恢复均覆盖。

变化：恢复失败保留待检查记录，避免静默删除；启动失败回收资源；SIGINT/SIGTERM 最长 15 秒退出。Colyseus matchMaker 是进程全局，仅支持每进程一个 runtime；多实例测试须进程隔离。OutcomeSink 默认关闭且不暴露外部路由，不能据此声明可靠结算已完成。
