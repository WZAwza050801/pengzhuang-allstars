# Stage B — 真实 Colyseus 网络测试 · 验收记录

## 验收命令与结果（本会话实跑，2026-11-15 17:24–17:26；原始输出已存档）
| 命令 | 结果 | 原始输出 |
|---|---|---|
| `npm run typecheck` | exit 0，0 错误 | `runs/STAGE_B_typecheck.out.txt` |
| `npm run test:net`（连跑 4 次） | 每次 exit 0，`net-tests: PASS=176 FAIL=0` | `runs/STAGE_B_net-tests.out.txt`（第 4 次） |
| `npm run test:physics` | exit 0，`14/14 passed`（30 场完整比赛 30/30，240 次随机出手 8.4 ms/次） | `runs/STAGE_B_physics.out.txt` |

`test:net` 末次输出的 info 行：
```
info  aimed match: 100 shots in 2579 ms, score 2-1, ended by shot-limit
info  AI match #1: 5 shots in 3855 ms, score 3-2, ended by goals
info  the server logged 3 line(s) for the 3 oversize frames (expected, captured): Max payload size exceeded
info  error codes exercised over the wire: 25/25
net-tests: PASS=176 FAIL=0
```

## 测试组（均为真实 ws://127.0.0.1 连接 colyseus.js 客户端，进程内起真实 Colyseus 服务器）
- **lobby**：6 位房间码；两座位；第三客户端被拒；8 种非法房间码加入；7 种非法创建选项；协议版本不符；30 个并发房间码互不相同；房间释放。
- **lineup**：`bad-lineup` / `bad-level` / `bad-message`；改阵容取消准备；双方准备 → 同一份 `match_start`；种子不上线；开赛后锁房。
- **shot-chain**：完整校验链；`NaN` / `±Infinity` → `bad-number`；重放同一 `clientShotId` → `duplicate-shot`（带 `ref` 与 `seq`）；被拒之后状态不变；两座位收到逐字节相同的包。
- **disconnect**：大厅断线释放座位；比赛中断线（Stage B 语义：状态不动、房间仍 playing、新人进不来）——**Stage C 要改这一段**。
- **matches**：三场整局（瞄准随机 / 强制 shot-limit / AI 驱动进球）。每场都验证：全局 `end` 事件恰好 1 次且只出现在最后一个包、seq 连续、两座位事件流一致、最终状态一致、服务端 phase 为 `ended`、结束后双方出手均 `match-over`、再 ready 得 `match-already-started`、之后不再广播。
- **hostile**：超限 3000 B / 100 KB / 1 MB → 连接 close 1009（并捕获服务端日志，只允许出现 "Max payload size exceeded"）；1500 B → `bad-message`；13 种探针；100 条突发 → `rate-limited`；进程 `uncaughtException` = 0；`/healthz` 仍 200。
- **faults**：无座位客户端的 `ready` / `set_lineup` / `shot` → `not-seated`；向活房间注入抛异常的 handler → `internal-error`、日志一行、发送者不被踢、卸载后恢复正常。
- **serving**：全部破坏性用例之后，新房间仍可完整对局。

## 变更文件
- `tools/net-tests.ts`（新增，约 770 行）
- `server/rooms/MatchRoom.ts`：覆盖 Colyseus 内部保留键 `__no_message_handler`（远程可踢人 / 崩进程的漏洞，证据 `runs/PROGRESS_AB.md` 16:17–16:20 两行与 `tools/_scratch_nmh_1.ts` / `_scratch_nmh_2.ts`）；`guard()`；限速；`internal-error`
- `package.json`：`test:net`、`test`（physics && net）

## 遗留 / 诚实说明
- 瞄准随机整局的结束原因随服务端随机种子而变（进球 或 shot-limit），`verify` 两者都接受；AI 驱动的那一局稳定以进球结束（`hard` AI 约 180–500 ms/步，5 步分出胜负）。
- `disconnect` 组里"比赛中断线不动状态"的断言属于 Stage B 语义，Stage C 加入重连窗口 / 超时判负后需同步更新。
- `tools/_scratch_nmh_*.ts` 两个探针保留，作为安全修复的证据。
