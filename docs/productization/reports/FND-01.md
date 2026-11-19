# FND-01 · 可复现基线验证

验证日期：2026-11-16 22:26–22:30 Asia/Shanghai。

## 范围与版本

- 验证源：`b60b10eed31715daf54dde8150526f5c81e2df8f`，本地分支 `docs/productization-roadmap`。
- 游戏代码基线：`70a8df4e134eb3051b35e9343b875a80c39efb9c`。两提交之间 `client/`、`server/`、`shared/`、`data/`、`package.json` 和锁文件无差异。
- 开始时工作区干净；随后只在规划分支写执行记录。通过 `git archive` 导出已提交版本到隔离目录，不复用原审查副本的 node_modules、dist 或生成报告。
- 环境：Linux 6.18.57 / x86_64 / glibc 2.41；Node.js v24.22.1；npm 11.9.0。
- 锁文件 SHA-256：`fca91f2174244ad9eb7f0dd3739b7b58fef1f1bbcf38f80c4b7dd8f6f0fcc7e2`；安装后与提交版本一致。
- Chromium 使用同一项目 Playwright 1.65.1 所安装的 headless shell 1255；浏览器二进制来自工作目录缓存，项目依赖为本次全新安装。

这次验证用于完成 FND-01，不沿用早期审查的测试结果；不包含新功能实现、生产部署或其它平台支持声明。

## 实际执行与结果

| 命令/场景 | 结果 | 本次耗时 | 原始证据 |
|---|---|---:|---|
| `npm ci --no-audit --no-fund` | 退出 0，安装 203 个包 | npm 输出 17 s | [install.txt](FND-01/install.txt) |
| `npm run typecheck` | 退出 0 | 4.451 s | [typecheck.txt](FND-01/typecheck.txt) |
| `npm run build` | 退出 0，生成 client/server | 3.961 s | [build.txt](FND-01/build.txt) |
| `npm run test:physics` | 18/18；240 次固定随机出手，30 场完整规则比赛通过 | 8.935 s | [physics.txt](FND-01/physics.txt) |
| `NET_TEST_PORT=0 npm run test:net` | PASS=176，FAIL=0；25/26 错误码覆盖 | 10.115 s | [net.txt](FND-01/net.txt) |
| `npm run test:e2e` | PASS=7，SKIP=0，FAIL=0；真实 Chromium 开局并出手，JS 错误 0 | 9.137 s | [browser.txt](FND-01/browser.txt) |
| 对独立服务运行 `npx --no-install tsx tools/online-e2e.ts` | 17 个 PASS，0 failure；两个 SDK 客户端出手与座位恢复 | 1.420 s | [online.txt](FND-01/online.txt)、[server.txt](FND-01/server.txt) |

机器可读环境、命令、端口、耗时和生成文件列表见 [results.json](FND-01/results.json)。耗时只是当前环境的一次观测，不是服务容量或产品 SLO。

归档日志仅清理行尾空格和文件末尾空行，未改动命令、结果或警告内容；原始运行输出留在隔离证据目录。

## 复现方法

从待验证提交创建独立工作区，按锁文件安装；所有命令在该工作区执行。Unix shell 示例：

```bash
git worktree add --detach <clean-directory> b60b10eed31715daf54dde8150526f5c81e2df8f
cd <clean-directory>
npm ci --no-audit --no-fund
npm run typecheck
npm run build
npm run test:physics
NET_TEST_PORT=0 npm run test:net
```

浏览器需要与锁定 Playwright 对应的 Chromium。没有缓存时执行 `npx playwright install chromium`；本次复用了已安装的对应浏览器二进制。`PLAYWRIGHT_BROWSERS_PATH` 可指定缓存目录。

```bash
E2E_SERVER_PORT=<free-port-a> E2E_WEB_PORT=<free-port-b> ROOM_STORE_DIR=<temporary-room-directory> npm run test:e2e
```

本次使用服务端 52817、静态端 43617，均为本地空闲端口。双客户端脚本依赖先启动服务器，本次用独立端口 44605：

```bash
PORT=44605 ROOM_STORE_DIR=<temporary-room-directory> node dist/server/index.js
# 在另一个终端，等待 /healthz 返回 200 后：
TEST_URL=ws://127.0.0.1:44605 npx --no-install tsx tools/online-e2e.ts
```

实际执行由临时编排脚本启动服务器、等待健康检查、运行客户端，并在 finally 终止/等待服务端；未留下后台进程。脚本没有改动被验证的游戏代码。此处不提前实现 QA-01 的正式 runner。

## 生成文件与工作区隔离

对照提交树计算 Git blob hash，发现既有命令会重写以下已跟踪文件：

1. `client/public/art/manifest.json`（构建生成）。
2. `docs/physics-tests.md`（物理脚本生成）。
3. `docs/screens/e2e-build-boot.png`、`docs/screens/e2e-build-shot.png`（浏览器截图）。

这些变化均留在隔离副本，没有覆盖原工作区，也不作为游戏改动提交。除上述生成文件外，提交内其它文件与验证输入一致，锁文件未改动。正式测试的输出目录治理仍由 QA-01 负责。

## 当前事实与旧资料差异

| 项目 | 当前事实 | 旧资料/注意事项 |
|---|---|---|
| 物理测试数量 | 18/18 | `docs/how-to-play-online.md` 与历史 CHECKPOINT 仍写 14/14 |
| 弧线角速度 | `physics.json` 为 1.98 rad/s | `docs/gameplay-defaults.md` 仍写 0.33；不能按旧说明回退参数 |
| 弹簧出速上限 | 9.12 m/s | 同一旧说明仍写 7.6 |
| 球员数据 | 117 名，106 名带 srcId，11 名重建 | 来源精度不同，不能全部标为原始恢复数据 |
| 几何 | 6×9.78 m，门宽 2.05 m，门深 0.4 m | 同一几何适用于所有皮肤，不按屏幕缩放改变物理 |
| 构建体积 | 主 JS 607.86 kB，gzip 151.34 kB；AI worker 333.64 kB | Vite 提示 chunk >500 kB；优化归 WEB-04，不属于基线失败 |
| 在线脚本输出 | 17 项 PASS；有一条未注册 `room` handler 警告 | 是 SDK 测试客户端警告，记录保留；不据此声称完整 OnlineHost 恢复链路覆盖 |

不改写历史 CHECKPOINT；后续 Agent 以当前数据、实现和本报告为准。基础测试通过不代表长期账号、数据库、小游戏或 App 已存在。

## 验收边界与交接

- FND-01 的干净导出、锁定安装、六类命令、环境证据和旧资料差异已完成。
- 浏览器套件验证单个 Web 运行环境中的开局/出手；双客户端脚本是 SDK 联机与座位重领，不能冒充两台手机浏览器整局或微信/App 真机验收。
- `bad-seat-token` 仍未被现有联机脚本覆盖；已记录，未来契约/账号联机任务补齐，不伪称 26/26。
- GitHub 创建分支仍返回 403，远端未更新；本地任务完成与远端同步是不同状态。
- 下一可领取：FND-02（工具链）、FND-03（来源盘点）、FND-06（范围/ADR）；不自动勾选其它任务。
