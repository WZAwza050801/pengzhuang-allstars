# 怎么玩 · 联机对战

## 一条命令启动（推荐）

```bash
cd "D:/ai_for_games/碰撞全明星复刻"
npm run build      # 只需第一次或改动代码后
npm start          # 启动服务端 + 托管前端
```

启动后：

| 设备 | 地址 |
|---|---|
| 本机 | `http://localhost:2567` |
| 同一 Wi-Fi 下的手机 / 另一台电脑 | `http://10.197.193.0:2567` |

`/healthz` 会返回 JSON（`status: ok`），说明服务在跑。

> 服务端端口默认 2567，可用 `PORT=3000 npm start` 改。
> 房间落盘目录默认 `data/rooms/`，可用 `ROOM_STORE_DIR=/some/path npm start` 改。

## 两步约战

1. **房主**：大厅点「创建房间」→ 屏幕上方出现 6 位房间码（例如 `K7M2XP`）→ 把码告诉对手。
2. **对手**：大厅点「在线约战」→ 在输入框填 6 位房间码 → 点「加入」。
3. **双方**：各点「提交阵容并准备」→ **两边都点了才开局**（服务端权威判定，先准备的人会看到「已准备，等待对手…」）。
4. 开局后各自操作；比分、回合、出手结果全部由服务端裁定，两边画面一致。

## 断线了怎么办

- 掉线后服务器会保留你的座位 **60 秒**（`data/rules.json` 的 `reconnectSeconds`）。
- 客户端会自动重连：先试传输层重连（Colyseus reconnection token），失败再试座位 token 重新加入。
- 重连成功后服务端下发完整局面（`resume` 消息），**比分和棋子位置全部恢复**，可以接着打。
- 超过 60 秒没人回来，座位释放，对手可以判定为超时。

## 服务端重启也不丢局

- 每个进行中的房间会持续落盘到 `data/rooms/<房间码>.json`。
- 服务端重启时会自动恢复未结束的房间（时钟在停机期间冻结）。
- 记录里的数据版本与当前游戏数据不一致时会被拒绝并改名成 `.rejected`，不会污染房间。

## 开发模式（改代码时用）

```bash
npm run dev:server    # 服务端，watch 模式
npm run dev:client    # Vite 开发服务器，http://localhost:5173
```

Vite 已配好 `/colyseus` → `ws://localhost:2567` 的 WebSocket 代理，所以开发时前端用 5173 端口即可联机。

## 还不支持的

- **公网对战**：需要 HTTPS/WSS、域名与部署，属保留闸门，只出方案不执行。
- **随机快速匹配**：属 V0.3。
- **移动端专项适配**：V0.3。

## 自检命令

```bash
npm run typecheck          # 0 错误
npm run test:physics       # 14/14
npm run test:net           # PASS=176 FAIL=0
npm run build              # exit 0
npm run test:e2e           # PASS=7 SKIP=0 FAIL=0（真实 Chromium）
npx tsx tools/online-e2e.ts # 15/15（两个真实客户端走完整一局 + 断线重连）
```
