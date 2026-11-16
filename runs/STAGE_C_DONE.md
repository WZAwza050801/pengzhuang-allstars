# STAGE_C_DONE.md · C 阶段（双端联机 + 重连 + 持久化）全部完成

日期：2026-11-15 20:50
执行：Claude 会话 #3（C1 服务端）+ 巴蒂（C2/C3/C4/C5）

## 交付能力

**本机 / 局域网内，两名真人凭 6 位房间码即可对战。** 浏览器打开 → 「在线约战」→ 一人「创建房间」拿码、另一人输入码加入 → 双方「提交阵容并准备」→ 服务端开局 → 各自出手、比分同步、断线可重连恢复。

## 改动文件清单

| 文件 | 动作 | 字节变化 | 内容 |
|---|---|---|---|
| `server/rooms/MatchRoom.ts` | Claude 改写 | 12384 → 26411 | seatToken 签发/校验、ClockInfo 回合与比赛计时、`surrender` 消息、`createRoomStore` 落盘、`allowReconnection` 重连窗口、`S2C.resume` 恢复包、`static useStore/useTiming/restore` |
| `server/index.ts` | 巴蒂重写 | 924 → 1900 | `ROOM_STORE_DIR` 环境变量、`restoreRooms()` 启动恢复、`MatchRoom.useStore()` 挂载 |
| `client/src/onlineHost.ts` | 巴蒂新建 | ~13.5KB | colyseus.js 客户端、房间码创建/加入、消息桥接、时钟换算、断线两级重连（transport token → seat token）、`submitLineup/setReady`、`onMatchReady/onRoomSnapshot` |
| `client/src/main.ts` | 巴蒂重写 | 4368 → ~7KB | 「在线约战」入口、6 位房间码输入（自动大写+过滤）、服务器地址、在线等待室、房间码横幅 |
| `client/src/style.css` | 巴蒂追加 | +5 行 | `.room-banner`、`.lobby.online`、`.roomcode` |
| `tools/online-e2e.ts` | 巴蒂新建 | ~6KB | 双真实客户端 E2E（15 条断言） |

## 实跑验收（原始数字）

```
npm run typecheck                → exit 0，0 错误
npm run test:physics             → 14/14 passed
                                   · 固定出手 30/60/120/144 FPS 渲染一致
                                   · 240 次固定种子随机出手：穿墙 0、重叠 0、动能异常 0、超速 0
                                   · 30 场随机完整比赛：出手 2909 次、进球 66、技能事件 1949，30/30 正常结束
npx tsx tools/net-tests.ts       → PASS=176 FAIL=0（错误码 25/26，未覆盖 bad-seat-token）
npm run build                    → exit 0
                                   · dist/client/assets/index-DsOJggQS.js  408.72 kB │ gzip 112.91 kB
                                   · dist/client/assets/index-DFW4i8NI.css    6.04 kB │ gzip   2.06 kB
                                   · dist/server/index.js                     78.7  kB
npm run test:e2e                 → PASS=7 SKIP=0 FAIL=0
                                   · 构建产物存在 / /healthz 200 / 静态托管 / 起始界面 / canvas / UI 一杆球 shotNo 1→2 / JS 错误 0
npx tsx tools/online-e2e.ts      → PASS，0 failure（15 条断言全绿）
```

### `tools/online-e2e.ts` 15 条断言（全部 PASS）
```
[room]
  PASS  the server assigns a 6-character room code
  PASS  both clients see the room snapshot
  PASS  the snapshot carries the room code
  PASS  each seat gets its own secret seat token
  PASS  the two seat tokens differ
  PASS  both seats are taken
[match]
  PASS  both clients get the match_start
  PASS  the match start carries the clock
  PASS  the seed never leaves the server
[shot]
  PASS  the shot reaches both seats
  PASS  the two seats see byte-identical packets
  PASS  the packet carries frames
  PASS  the packet advances the shot number
  PASS  the packet carries the clock
[reconnect]
  PASS  the disconnected seat had a token
  PASS  the seat can be re-claimed with the token
[summary]
  PASS  no failure in this run
```

## 过程中发现并修复的真实缺陷

1. **工作区 typecheck 红灯**（20:02 巴蒂发现）：上一会话给 `protocol.ts` 加了必填 `clocks`，但 `MatchRoom.ts` 没跟上 → 退出码 2。Claude 会话 #3 在 20:25 写入新 MatchRoom 后修复。
2. **客户端首个快照竞态**（20:38 定位）：服务端 `onJoin` 立刻广播快照，客户端 `await join` 返回后才注册 handler → 首个快照被丢弃。正确写法是拿到 room 对象立刻同步注册。
3. **测试脚本 `until()` 语义坑**（20:44 定位）：条件返回 `false` 而非 `undefined` 时 `until` 立即返回、根本没等待，导致误判「服务端不回包」。
4. **Claude 会话 #3 卡死**（20:28:45 实证）：报 "Prompt is too long"，进程仍存活但无输出。watcher v2 只按 `PROGRESS_ALL.md` 增长判断，不识别此类卡死。

## 遗留 / 未完成

- **一条命令一个地址**（T1）：`dist/server` 尚未托管 `dist/client`，局域网需开两个进程或用 Vite。改动很小（`server/app.ts` 加 `express.static`）。
- **公网对战**：❌ 未做。需 HTTPS/WSS + 部署 + DNS，属安安保留的确认闸门，只出方案文档不执行。
- **随机快速匹配**：❌ 未做，属 V0.3。
- **V0.3 全量 106 人数据 / 五套球场 / 移动端适配**：❌ 未做。
- **球门宽度 `goalWidth = 2.05m`**：仍按原版量测值，未改（安安反馈偏大，等 V0.2 全绿后处理，见 `runs/ISSUE_goal_width.md`）。
- **`bad-seat-token` 错误码**未在 net-tests 中被覆盖（25/26）；online-e2e 已覆盖「凭 token 夺回座位」的成功路径，失败路径待补。
