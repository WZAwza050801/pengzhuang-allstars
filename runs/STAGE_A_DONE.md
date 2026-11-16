# Stage A — 服务端骨架 · 验收记录

## 验收命令与原始输出（本会话实跑，2026-11-15 17:26）
```
npm run typecheck                       -> exit 0，tsc 无任何输出（0 错误）
node --import tsx server/index.ts       -> 启动 1.3 s 后
GET http://127.0.0.1:2567/healthz       -> 200 {"status":"ok","service":"collision-allstars","protocol":1,"dataVersion":"field-2/phys-2/players-1/skills-1/rules-1","uptimeSec":1}
GET http://127.0.0.1:2567/nope          -> 404
Stop-Process 之后                        -> 2567 无 LISTEN
服务端 stdout: [server] listening on port 2567  (GET /healthz)；stderr 0 行
```
更早的一次（冷缓存，15:38:03，记录在 `runs/PROGRESS_AB.md`）：冷启动约 13.5 s，healthz 同样 200。

## 变更文件
- `shared/protocol.ts`（协议常量、C2S/S2C 消息形状、25 个 `NET_ERROR_CODES` + `isNetErrorCode`）
- `server/validation.ts`、`server/auth.ts`（入站消息/加入选项的严格解析）
- `server/rooms/MatchRoom.ts`、`server/app.ts`、`server/index.ts`
- `.env.example`
- `package.json`：`dev:server` / `test:net` 脚本

## 遗留
- 无阻塞项。服务端计时（回合 20 s / 全局 180 s）、断线重连与持久化属于 Stage C。
