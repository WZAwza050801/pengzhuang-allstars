# 碰撞全明星

竖屏 5v5 弹射足球：本地练习、同屏双人和浏览器房间约战。服务端负责联机规则和出手结果。

## 产品化实施入口

请先阅读 **[完整实施规划与 Agent 工作流](docs/productization/README.md)**。

- [112 项待办、依赖与验收](docs/productization/TASKS.md)
- [技术栈与架构](docs/productization/01-architecture.md)
- [球场建模](docs/productization/03-field-model.md)
- [数值与成长设计](docs/productization/04-game-balance.md)
- [大厅及多端界面](docs/productization/05-client-design.md)
- [执行记录](docs/productization/EXECUTION_LOG.md)

## 当前 Demo 本地运行

当前锁定 Node.js 24.22.1（24 LTS）和 npm 11.9.0；`.nvmrc`、`.node-version`、`engines` 与安装前检查保持一致。升级需在独立变更中更新这些约束、锁文件并完成兼容验证。

```bash
npm ci
npm run build
npm start
```

浏览器访问 `http://localhost:2567`。开发时分别启动 `npm run dev:server` 与 `npm run dev:client`。

```bash
npm run typecheck
npm test
npm run test:e2e
node tools/check-plan.mjs
```

日常开发运行 `npm run check`（工具链、Lint、增量格式、类型、配置、任务和资源检查、单元测试）。新增代码放入 config/tests/packages 时自动纳入严格规则；`npm run format` 只格式化这些模块和新工具，避免重排旧游戏代码。完整游戏回归仍运行 `npm test` 与浏览器测试。

浏览器测试需要安装与项目 Playwright 版本一致的 Chromium：`npx playwright install chromium`。这组命令适用于当前 Demo；尚未实施的数据库、小游戏与 App 命令在规划中有明确标记。

联机说明见 [docs/how-to-play-online.md](docs/how-to-play-online.md)。历史记录见 `runs/`；当其中内容与当前实现或新规划不同，以现行代码、测试和已记录决策为准。
