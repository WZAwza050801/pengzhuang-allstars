# FND-02 · 工具链与依赖约束

日期：2026-11-17。运行环境 Node.js 24.22.1、npm 11.9.0。

## 已落实

- `.node-version`、`.nvmrc`、package engines、packageManager 固定同一版本；`.npmrc` 启用 engine-strict 和 save-exact。
- 安装前与 `npm run check:toolchain` 都执行真实运行时检查；错误版本退出非零。不输出任何环境秘密。
- 保留现有游戏依赖和代码，锁文件只新增运行时/安装钩子元数据，没有升级物理引擎或对战协议。
- README 更新开发环境要求；安全补丁升级需一起更新版本约束并重新验证，不能绕过安装前检查。

## 发行元数据核查

原始 npm 元数据见 [FND-02-dependencies.json](FND-02-dependencies.json)。这些是未来接入候选，不代表本任务已安装其功能。

| 候选 | 查询版本 | 当前兼容依据 |
|---|---|---|
| React | 19.3.1 | MIT；React Router / Query / Zustand 同时声明支持 React 19 |
| Zod | 4.6.7 | MIT；后续配置和契约使用此精确版本 |
| ESLint / Prettier | 10.15.0 / 3.10.1 | 运行时约束支持 Node 24；FND-05 接入后实际验证 |
| Vitest | 5.1.0 | 支持 Node 24、Vite 7 与当前 @types/node 22；FND-05 验证 |
| pg / node-pg-migrate | 8.23.1 / 9.0.0 | pg<9 的 peer 范围相容，Node 24 满足 engines；ARC-04 验证 |
| Capacitor | 8.6.2 | CLI 支持 Node>=22；替换旧规划的 7 候选，APP-01 仍须验证原生工具链 |
| Ant Design | 6.7.1 | peer 支持 React>=18；替换旧规划的 5 候选，UI 阶段再验证浏览器与组件兼容 |

以上查询未返回 deprecated 标记；这只是发行元数据事实，不能代替供应商长期支持承诺或各平台真机验收。框架候选变化在 FND-06 的 ADR 中固定，未偷偷加入旧客户端。

## 本次验证

- `npm ci --cache <work-cache> --no-audit --no-fund`：全新安装成功，安装前版本检查通过。
- `node tools/check-toolchain.mjs`：通过；临时副本将期望版本改成 0.0.0，实际检查拒绝并退出非零。
- `npm run typecheck`、`npm run build`：退出 0。
- `npm test`：物理 18/18，联机 PASS=176/FAIL=0。
- [命令记录](FND-02-checks.json)保存本次退出码和耗时；构建/测试改写的既有生成文件已恢复为执行前内容，不混入提交。

边界：此任务只固定工具链并核查候选，后续依赖需在真正使用的任务中安装、锁定和验证。
