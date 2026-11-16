# CHECKPOINT · 单一事实来源（接力会话第一份必读文件）

> 更新：2026-11-15 20:50（巴蒂整理 · 吸收了 Claude 会话 #3 的产出 + 巴蒂本人完成 C2/C3/C4 + 全部实测数字）
> **本文件取代重复调研。开工只读本文件 + `PROGRESS_ALL.md` 末尾，不要再通读源码。**
> 接力会话每完成一个子任务，立刻写 `runs/STAGE_X_DONE.md` 并追加 `PROGRESS_ALL.md`，然后**主动结束本会话**。

## 1. 全局状态

| 阶段 | 状态 | 实证 |
|---|---|---|
| A 服务端骨架 | ✅ DONE | `STAGE_A_DONE.md`：typecheck 0 错误、`/healthz` 200 |
| B 权威一杆球 | ✅ DONE | `STAGE_B_DONE.md`：`test:net` PASS=176 FAIL=0；physics 14/14；30 场完整比赛 30/30 |
| D 构建全链路 | ✅ DONE | `npm run build` exit 0：client 408.72KB / CSS 6.04KB / server 78.7KB |
| E 真实浏览器 E2E | ✅ DONE | `npm run test:e2e` **PASS=7 SKIP=0 FAIL=0**，UI 一杆球 shotNo 1→2，JS 错误 0 |
| **C1 服务端重连/时钟/落盘** | ✅ **DONE 20:25**（Claude 会话 #3 产出） | `MatchRoom.ts` 12.4KB→26.4KB；net 176/176 不回归 |
| **C2 启动恢复** | ✅ **DONE 20:40**（巴蒂） | `server/index.ts` 调 `store.loadAll()` + `MatchRoom.restore()` |
| **C3 OnlineHost** | ✅ **DONE 20:45**（巴蒂） | `client/src/onlineHost.ts` 新建 |
| **C4 在线入口** | ✅ **DONE 20:47**（巴蒂） | `client/src/main.ts` 加「在线约战」组 + 等待室 |
| **C5 双端联机实测** | ✅ **DONE 20:46**（巴蒂） | `tools/online-e2e.ts` **PASS 全绿**（见第 5 节） |
| V0.3 全量数据/快速匹配/五套球场 | 🔄 **IN PROGRESS**（watcher v3 会话 #2 在做「在线排队房间」） | 数据底账见 `runs/V03_ROSTER_PREP.md` |
| **美术资产 117 人头像** | ✅ **DONE 22:40**（巴蒂） | 117/117 覆盖（p01-p16 手绘 + p17-p117 AI）；e2e PASS=7/7 含头像加载断言；管线见 `docs/art-pipeline.md` |
| 球门宽度 | ⬜ 待办（V0.2 全绿后） | `runs/ISSUE_goal_width.md` |

**结论：C 阶段已实质完成。本机/局域网内两真人凭 6 位房间码可对战。**
剩余待办：① ~~静态托管 `dist/client`~~ **T1 已 DONE 20:55** ② V0.3 全量数据（**正在进行**）③ 公网部署（需安安确认）。

**当前运行中的接力**：`autopilot_watcher_v3.sh`（后台），任务书 `runs/RESUME_V3.prompt.md`；会话 #1 于 22:14 正常结束（rc=0，进度 6581→9087B），22:14 拉起 #2。
**v3 新增能力**：监控 claude transcript 文件大小 + `PROGRESS_ALL.md` 大小，**连续 12 分钟两者都不增长即判定卡死并杀掉重启**（针对 20:28 的 "Prompt is too long"——v2 无法识别这类卡死）。
**已验证可用入口**：`npm run build && npm start` → 本机 `http://localhost:2567`，局域网 `http://10.197.193.0:2567`。用法见 `docs/how-to-play-online.md`。

## 1b. 美术资产管线（22:40 交付，禁止重复调研）

**现状**：名单 117 人，头像 117/117 全覆盖。`render.ts:91` 只加载 `/assets/players/{id}_avatar.png`（256×256 圆形）；**`_full.png` 全项目无任何引用**，保留仅为将来做卡面。
**加载失败会回退成灰色圆饼 `#dde6ee`** —— 所以"每人都要有头像"是硬要求，不是锦上添花。

**两条产出路线**
- `art/gen_placeholders.py`（程序化徽章兜底，`npm run build:avatars`）：位置色圆盘 + 品质色环 + 稀有度点 + 中文名。**永不覆盖已有文件**，随时可跑，保证不留灰饼。
- `art/gen_prompts.py` → 图像模型 → `art/split_heads.py`（AI 头肩特写）：一张 3×3 宫格出 9 人，101 人只要 12 次调用（逐张要 101 次）。

**三个已踩过的坑（照抄即可，别再自己试错）**
1. **不要让 AI 出全身立绘再做头部检测**。肩线检测在 AI 构图上不可靠：尖发触发肩线、举手的门将让手臂宽度污染头宽。改让 AI 直接出头肩特写，切格→抠绿→套圆遮罩，零检测算法。
2. **宫格边界必须靠检测白色分隔线**，不能按固定比例切——AI 会把角色画到格子边缘，固定内缩会削掉头顶；而且整张图有**白色外边框**，不处理会混进首/末格子。代码里已实现"白线涂回绿色再定位"。
3. **头像正方形化要留 24% 边距**，否则圆形遮罩会在头顶切出一条硬边。

**抠绿用纯 Pillow chroma-key**（绿通道高于红蓝），不依赖 rembg/onnxruntime——托管 Python 环境里没有 rembg。`art/process_players.py`（处理手绘原图）仍依赖 rembg。
**Python 环境**：`C:\Users\31168\.workbuddy\binaries\python\envs\default\Scripts\python.exe`（有 Pillow + numpy）。

## 2. 本轮新核实的事实 · 禁止重复调研

**Colyseus 0.16.5 重连（巴蒂 20:37 直接读源码核实，Claude 曾反复翻此处）**
- `Room.allowReconnection(previousClient, seconds)` **必须在 `onLeave()` 内调用**；`seconds` 传数字=秒，传 `"manual"`=无限（缺参会打 DEPRECATED 警告）。
- 重连成功走 `Room.js:505` 的 `isWaitingReconnection` 分支 → **`onJoin` 不会被调用**，必须自己在 `reconnection.then(newClient => ...)` 里发 `resume`。
- `_reconnections[reconnectionToken]` 与 `reservedSeats[sessionId][3]` 共同决定能否重连；`checkReconnectionToken` 在 `Room.js:324`。
- 客户端：`room.reconnectionToken` 形如 `roomId:token`；`client.reconnect(token)` 内部拆成 `roomId` + token 再走 matchmake `reconnect` 方法。

**Colyseus 消息 type 编解码（巴蒂 20:40 核实）**
- 客户端 `room.send(type, msg)` → `encode.string(buffer, type)`；服务端 `Room.js:736` 用 `decode.stringCheck` 判断后 `decode.string` 或 `decode.number`，**两端一致**。
- 服务端 `Room.js:766`：**没有专用 handler 的 type** 才会落到 `'*'` 或 `'__no_message_handler'`；有专用 handler 就直接调它。
- `onMessage(type, cb)` 注册时用 `Object.create(null)` 建表，key 就是 type 字符串。

**客户端首个快照的竞态（关键坑）**
- 服务端在 `onJoin` 里立刻 `broadcastRoom()`，但客户端 `await client.joinById()` 返回后才拿到 room 对象 → **handler 注册晚于首个快照，消息被丢弃**。
- 正确写法：**拿到 room 对象就立刻同步注册 handler**，不要等第二个 await。
  - `tools/net-tests.ts:97` 注释已写明此事；`tools/online-e2e.ts` 已按此写。
  - `OnlineHost.connect()` 是 `await` 后立即 `bindRoom(room)`，写法正确。

**测试脚本自身的坑（巴蒂 20:44 踩过）**
- `until(fn)` 的契约是「返回 `undefined` = 还没好」。写成 `fn = () => a.x > 0 && b.x > 0` 时，未就绪会返回 **`false` 而不是 `undefined`** → 立即返回、根本没等。
  **必须写 `() => (cond ? true : undefined)`**，或让 `until` 额外忽略 `false`。

**其他**
- `shared/protocol.ts`（18:31）已含 `clocks: ClockInfo`、`seatToken`、`ResumeMsg`、`UpdateMsg`、`surrender`；`MatchStartMsg`/`ShotPacketMsg` 的 `clocks` 是**必填**。
- `data/rules.json`：`matchSeconds=180`、`turnSeconds=20`、`reconnectSeconds=60`、`goalsToWin=3`。
- `shared/physics.ts` 物理常量与 `docs/calibration.md` 校准基线：**禁止改**。
- `shared/match.ts` 导出：`createMatch/beginTurn/validateShot/resolveShot/passTurn/endByTime/forfeit`；`MatchState.rng` 是 uint32，**永不上线**（wireState 里置 0）。

**C1 已落盘的 `server/rooms/MatchRoom.ts`（26.4KB，Claude 产出，已通过 176/176）**
- 新增：`static useStore(store)` / `static useTiming(override)` 测试钩子、`static async restore(rec)` 启动恢复入口。
- 座位：`Seat` 增加 `token`、`windowEnd`、`window`；`reclaimSeat(client, token)` 凭 token 夺回座位并发 `S2C.resume`。
- 消息：`C2S.surrender` → `forfeit` → 广播 `S2C.update`；`S2C.update`/`S2C.resume`/`S2C.shotPacket` 都带 `clocks`。
- 落盘：`persist()` 存 `RoomRecord`（含真实 `rng`、accepted 表、clocks 剩余时间）；`onDispose` 也会 persist。
- 时钟：`armTurn(playbackMs + turnMs)`，出手后等客户端播完再给回合计时。

## 3. 已完成文件清单（C 阶段）

| 文件 | 动作 | 说明 |
|---|---|---|
| `server/rooms/MatchRoom.ts` | Claude 改写 12.4→26.4KB | token/时钟/投降/落盘/重连/resume |
| `server/index.ts` | 巴蒂重写 | `ROOM_STORE_DIR` 环境变量 + `restoreRooms()` + `MatchRoom.useStore()` |
| `client/src/onlineHost.ts` | 巴蒂新建 | colyseus.js 客户端 + 房间码 + 断线重连（transport token → seat token 两级兜底）+ `submitLineup/setReady` + `onMatchReady/onRoomSnapshot` |
| `client/src/main.ts` | 巴蒂重写 | 「在线约战」组（创建/输入房间码/服务器地址）+ `onlineLobby()` 等待室 + 房间码横幅 |
| `client/src/style.css` | 巴蒂追加 | `.room-banner`、`.lobby.online`、`.roomcode` |
| `tools/online-e2e.ts` | 巴蒂新建 | 双真实客户端 E2E（房间/快照/token/时钟/出手/重连） |
| `tools/net-tests.ts` | 未改 | 176 用例保持不变，作为 C1 的回归基线 |

## 4. 实跑验收数字（2026-11-15 20:46–20:50 全部实跑）

```
npm run typecheck                → exit 0，0 错误
npm run test:physics             → 14/14 passed（30 场随机完整比赛 30/30）
npx tsx tools/net-tests.ts       → PASS=176 FAIL=0（错误码 25/26，未覆盖 bad-seat-token）
npm run build                    → exit 0；client JS 408.72KB / CSS 6.04KB / server 78.7KB
npm run test:e2e                 → PASS=7 SKIP=0 FAIL=0；UI 一杆球 shotNo 1→2；JS 错误 0
npx tsx tools/online-e2e.ts      → PASS 全绿，0 failure（详见第 5 节）
```

**`tools/online-e2e.ts` 断言清单（全部 PASS）**
1. 服务端分配 6 位房间码
2. 两个客户端都收到房间快照
3. 快照带房间码
4. 两个座位各自拿到**不同的** seatToken
5. 两个座位都被占用
6. 两端都收到 match_start
7. match_start 带时钟（matchMs / turnMs 均为 number）
8. **种子永不上线**（`state.rng === 0`）
9. 出手包到达**双方**
10. 双方看到的包**逐字节一致**
11. 包带 frames
12. 包推进 shotNo
13. 包带时钟
14. 掉线座位有 token
15. **凭 token 夺回座位成功**（收到 `S2C.resume`）

## 5. 待办（按优先级）

### T1 · 一条命令一个地址 ✅ DONE 20:55
`server/app.ts` 已加 `express.static` 托管 `dist/client` + SPA fallback（正则 `/^\/(?!healthz|api\/).*/`）。
`clientDir()` 三级候选：`CLIENT_DIR` 环境变量 → `cwd/dist/client` → `../dist/client`。
实测：`GET /` 200（521B）、`GET /some/deep/path` 200（fallback）、`/healthz` 200、assets 正常、托管模式下 online-e2e 15/15 + test:e2e 7/7。
**用法文档**：`docs/how-to-play-online.md`。

### T2 · V0.3 全量数据（部分完成）
T2-a 名册 16→117 人 ✅ DONE 22:12（`runs/STAGE_T2a_DONE.md`）。施工单见 `runs/RESUME_V3.prompt.md` 第 2 节。
- `data/players.json` 16 人 → 117 人（源 106/106 经 srcId 覆盖）。
- 字段映射 `mind/radian/precision` → `curve/accuracy/mental`，`attrs` 落在 40–99，88 条 clamp 记录在 `docs/roster-conflicts.json`。
- 剩余：T2-b 快速匹配、T2-b2 `rematch`、T2-c 五套球场、T2-d 移动端、T2-e 公网方案文档。

### T4 · 材料包全量消化 ← **当前主线，watcher v4 (Opus) 在做**
安安确认「当时的压缩包里包含了很多信息，请 Claude 处理好了」。巴蒂已完成材料包全量摸底 →
**必读 `runs/MATERIALS_DIGEST.md`（不要重复调研 materials/）**，施工单见 `runs/RESUME_V4.prompt.md` 第 2 节，
队列见 `runs/TASK_QUEUE.md`，**工期预估见 `runs/V04_TIME_ESTIMATE.md`（中性 ≈35 机时 ≈1.5 个自然日）**，
**已固化的决策见 `runs/DECISIONS.md`（D2/D3/D5/D6/D7/D8 已按源材料预填，D1 球门宽度待安安拍板）**。
- 现状：材料包 591 条目，**只消化了 players.json 一小部分**。未消化的核心资产：
  等级属性 **2250 条**、卡牌 **224 张**、技能 **511 条 + 547 条关联**、阵型 **90 套**、
  **原版头像 107 张**、**五套球场原图 Scenes_01–05**、原版球门/球背景 sprite 14 个、图集切片 1581 条、系数表 110 条、参考配置表 92 张。
- 🔑 **T4-d 是最大增量**：原版 194×188 头像全在包内（覆盖率 106/106），现项目用的是 AI 重绘 → 做原图/重绘切换（REBUILD_PROMPT.md 原始要求）。
- 🔑 **T3 有了来源依据**：`materials/.../01_game_research/prototype_settings.json` 给 `goal_width_units 0.28 / field_width_units 1.0` = **28% 场宽**；现行 34.2% 偏大与此吻合。
- ⚠️ `reference_measurements.csv` **只有表头无数据行** —— 原版实测为空，**不要伪造测量值**。
- ⚠️ 20 条 card vs card_attr 等级 1 冲突、8 条 issues、小罗 40109、卡队法比奥、齐祖 90001、耳帝原名冲突 —— 全部保留记录，不编造。
- ⚠️ `probabilities` 是列表不是单概率；`duration` 是计数不是秒；`radian` 不是弧度；`weight` 不是 kg。

### T3 · 球门宽度（排在 T4 之后）
`data/fields.json` `geometry.goalWidth = 2.05m`（占场宽 34.2%）安安反馈偏大。候选 1.90 / 1.80 / 1.68 / 1.65m，详见 `runs/ISSUE_goal_width.md`。
**新增依据**：`prototype_settings.json` 的 `goal_width_units 0.28 / field_width_units 1.0` = 28% 场宽（≈1.68m），与「偏大」直觉吻合（详见 MATERIALS_DIGEST 第 3 节）。
会连锁影响门柱碰撞、进球判定、校准基线、physics/net 测试与版本号。若只是门框画得太粗，改 `client/src/render.ts` 即可。

## 6. 接力协议（硬性）

1. **开工第一件事**：读本文件 + `tail -20 runs/PROGRESS_ALL.md`，按 `runs/STAGE_*_DONE.md` 跳过已完成。**不许重新核实磁盘、不许重读本文件已列明的源码。**
2. 本会话**只做一个子任务**（T1 / T2 的某个子块 / T3），做完写 `runs/STAGE_X_DONE.md`（含实跑命令与原始结果数字）+ 追加 `PROGRESS_ALL.md`，**然后立即结束**。
3. 上下文纪律：禁止整体读 >300 行文件；禁止整体读 `materials/` 大 JSON；工具输出用 `head`/`tail` 截断；优先 `Grep` 定位行号再分段 `Read`。
4. 质量红线：不删测试、不弱化断言、不把失败标 skip；不把本地双标签页冒充公网联机；不引入按量计费服务；不 git init；公网发布/付费部署/DNS/对外邀请须安安确认。
5. **Claude 会话历史教训（20:28 实证）**：会话 #3 在写完 `MatchRoom.ts` 后于 20:28:45 报 **"Prompt is too long"** 卡死。`autopilot_watcher_v2.sh` 只看 `PROGRESS_ALL.md` 是否增长，不看会话是否卡在 API 错误 → 需要人工或改 watcher 增加「会话无输出超过 N 分钟即重启」的判断。

## 7. 已知待办（不阻塞）

- `data/rooms/` 是运行时落盘目录，应加入 `.gitignore`（本仓库尚未 `git init`）。
- `ROOM_STORE_DIR` 环境变量已支持切换落盘目录，测试可用临时目录。
