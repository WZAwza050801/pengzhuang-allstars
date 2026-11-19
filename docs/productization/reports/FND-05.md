# FND-05 · 日常工程检查

日期：2026-11-17。安装并锁定 ESLint 10.15.0、typescript-eslint 8.73.0、Prettier 3.10.1、Vitest 5.1.0；与当前 Node 24、TypeScript 5.9、Vite 7 的发行依赖范围相容。

## 真实命令

- `npm run lint` 扫描项目 TS/MJS，排除资料包、生成文件和历史 scratch 文件；不是 echo 或空检查。
- `npm run format:check` / `npm run format` 检查/修正新拥有的 config、tests、packages 及新工具。旧比赛实现不做无关全量重排。
- `npm run test:unit` 使用 Vitest unit project，当前执行 5 个真实配置行为测试。contract/integration project 已定义，但对应命令和用例在 ARC 任务真正实现后添加。
- `npm run check` 串联工具链、lint、格式、类型、配置、任务依赖、资源清单及 unit 测试；任何失败都停止并退出非零。
- 原有游戏测试和构建命令保留；没有放行 passWithNoTests 或核心 SKIP。

## 增量规则与债务

游戏 client/server/shared 保持 recommended 检查；新 config/tests/packages 和新工具另外禁止未使用变量。旧导入工具的 any、gen-art 的条件式副作用、旧测试的回调观察赋值/清理 catch、calibrate 的特殊空白和 ai-bench 的 const 建议，使用精确到文件的少量规则例外；没有全局关闭 lint。

这些例外不是认为旧工具已完成严格迁移：导入边界由 BAL-01 规范，测试退出与清理由 QA-01 整理。新模块不继承对应放宽规则；工具和清单仍真实执行。

## 验证

`npm run check` 全部通过，Vitest 1 文件/5 测试通过。故意创建 TS 类型错误、格式错误、lint 错误和含未知依赖的清单副本，对应检查均退出非零；随后移除夹具，正常检查恢复通过。

用户级玩法、球场尺寸与原版资源没有改动。FND-04 的配置测试从 node:test 迁移至 Vitest，保留原行为断言。
