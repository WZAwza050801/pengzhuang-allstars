
---

# 【续跑指令 · 2026-11-15 14:4x】优先于上文所有"待确认"表述

## 0. 上一轮的阻塞已解除，本轮必须真正动手

上一轮（日志 `runs/stageAB-20261115-141231.log`）你因为 headless 下 `node`/`npm`/`npx`/`tsx` 命令需要人工批准，没有改任何文件，只输出了计划。这个阻塞已经由协调方修复：

- `C:\Users\31168\.claude\settings.json` 已补上正确的 `permissions.defaultMode = "bypassPermissions"`（原来只写了无效字段 `permissions.bypassPermissions`）；
- 本次启动显式带 `--dangerously-skip-permissions`；
- 所有 `node` / `npm` / `npx` / `tsx` 命令，以及对 `localhost` 的 HTTP / WebSocket 请求，均已放行，无需再等待任何人确认。

**所以：不要再输出计划等批准，不要再因为权限被拦就整体停机。直接读代码、直接落盘、直接实跑命令。** 如果仍遇到某条具体命令被拒，先尝试替代写法（例如 `npm.cmd`、`npx.cmd`、直接调用 `node_modules/.bin/` 下的可执行文件、或改用 Node 脚本），并把该命令的原始报错记录进交接报告；只有全部替代都失败才算真阻塞。

## 1. 直接复用上一轮的成果，不重新规划

`runs/stageAB-20261115-141231.log` 是你自己产出的阶段 A/B 实施计划（含 Colyseus 0.16.5 源码核实结果、校验链顺序、`tools/net-tests.ts` 用例清单、7 个默认项）。**先完整读它，然后照着执行**，不要重新做架构调研，不要再产出第二份计划书。

上一轮第 5 节的 7 个默认项，全部按你列的默认值执行，无需再问。补充两点：

- **git：不要 `git init`，不要改版本控制结构**，保持目录现状（`git status` 会报 not a repository，这是已知状态，不是阻塞）。任务书里"小步提交"改为"按文件落盘 + 在交接报告里列出修改文件清单"。
- **等级 / 阵容 / 字段命名 / 同步方式 / 目录偏离**：全部按你上一轮写的默认值执行。

## 2. 已核实的环境事实（不用再查）

- Node：`v22.22.2`，满足 `package.json` 的 `>=22.12`。
- Colyseus：`0.16.5`，已安装在 `node_modules`。
- Vite 已配置 `/api` → `http://localhost:2567`、`/colyseus` → `ws://localhost:2567`，服务端端口固定 2567。
- `server/`、`dist/`、`tools/net-tests.ts` 目前仍不存在；`package.json` 里 `build:art`(tools/gen-art.ts)、`test:e2e`(tools/e2e-browser.mjs)、`backup`(tools/backup.ts) 引用缺失文件，这些属于阶段 D/E，**本轮不要动、不要顺手修**。

## 3. 范围（不变，硬边界）

只做**阶段 A + 阶段 B**：

- A：`server/app.ts`、`server/index.ts`、`/healthz`、`.env.example`，服务端可启动。
- B：`shared/protocol.ts`、`server/validation.ts`、`server/auth.ts`、`server/rooms/MatchRoom.ts`、`tools/net-tests.ts`、`docs/online.md`；服务端权威一杆球 + 真实双客户端 WebSocket 网络测试。

**禁止**：进入阶段 C/D/E、导入全量 106 名球员、写客户端 `OnlineHost`、做断线重连/持久化、部署、修改物理核心 `shared/physics.ts` 与 `shared/match.ts` 的既有行为、删改现有测试来伪造通过、购买任何服务。

## 4. 验收（必须实跑，命令与原始输出要贴进交接报告）

1. `npm run typecheck` —— 0 错误（不回归）。
2. `npm run test:physics` —— 14/14 全 PASS（不回归）。
3. `npm run test:net` —— **本轮新建且必须通过**，覆盖上一轮计划第 4 节列出的全部用例。
4. 服务端能起、`GET /healthz` 返回 200 且字段齐全；起完记得关掉进程，不要留常驻端口。
5. 客户端 `npm run dev` 能启动（可用 curl 验证首页 200 后关闭）。

任何一条没过就继续修到达标，**不许把未通过项写成"已知问题"交差**。

## 5. 实时进度落盘（新增硬性要求，便于外部监控）

`claude -p` 的输出要等会话结束才写日志，外部看不到中途状态。所以：

- 每完成一个关键步骤（读完计划、A 阶段文件落盘、服务端首次启动成功、B 阶段每个文件落盘、每条验收命令跑完），**立刻用追加方式往 `runs/PROGRESS_AB.md` 写一行**：`时间 | 阶段 | 做了什么 | 命令及结果摘要`。
- 文件不存在就新建，之后一律追加，不要覆盖。
- 若会话中途上下文重置，第一步先读 `runs/PROGRESS_AB.md` 和 `runs/stageAB-20261115-141231.log` 恢复状态，**不要从头重来、不要重复写已完成的文件**。

## 6. 停止条件与交接格式

阶段 B 全部验收通过即停止。把交接报告**同时**写成文件 `runs/HANDOVER_AB.md` 并在最终输出里给出，包含：

1. 完成项（逐条对应任务书 A–B 验收）；
2. 实跑过的命令 + 原始结果摘要（含失败过又修好的命令）；
3. 修改/新增文件清单（完整路径）；
4. 未完成项与原因；
5. 下一步建议（阶段 C 起），以及你上一轮列的"尚未验证的假设"现在验证结果如何；
6. 明确写出 `npm run test:net` 的最终 PASS/FAIL 数字。

若确实遇到无法自行解决的阻塞，也要写 `runs/HANDOVER_AB.md` 说明卡在哪一步、试过哪些命令、原始报错，再停止，不要自行扩大范围。
