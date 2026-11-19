# ARC-01 · 增量 workspace 与纯核心入口

日期：2026-11-17。新增私有源码工作区 `@pengzhuang/game-core`，将实际使用的确定性 RNG 移入 src；旧 shared/rng 重导出，现有 AI、比赛及测试继续调用同一实现。

这是首个真实模块迁移，没有创建空壳假装全部规则已搬迁。其余 shared 仍保留原路径，按专项任务逐步迁移；数据配置保持唯一来源，物理和玩法参数未变。

源码包由 Vite/tsx/应用 bundler 读取；它不是可直接发布给外部 Node 消费的编译产物包。现有 server 通过相对重导出由 esbuild 打包，不能在未来外部化源码 workspace 后假设 Node 会编译它。

`check:boundaries` 用 TypeScript AST 检查 shared、game-core 和 contracts，拒绝 Node/数据库/UI依赖及平台全局；新增 Node 环境 API/旧入口一致性与随机状态恢复测试。

验证：npm workspace 链接安装、unit、typecheck、build、physics/net 均通过；临时引入 node:fs 的纯核心反例由边界检查拒绝，移除后通过。所有已有启动/构建/测试命令保留，变更不包含大厅重写。
