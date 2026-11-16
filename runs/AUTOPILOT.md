# 碰撞全明星复刻 · 全量无人值守总控（安安 2026-11-15 14:56 授权）

> 本文件是后续所有开发接力的**单一事实来源**，优先级高于此前任何 prompt 里的范围限制。
> 调度与复核：WorkBuddy（巴蒂）；执行：Claude Code headless / `claude-sonnet-5-5`。

## 1. 权限状态：已全开，不再是瓶颈

| 层 | 状态 |
|---|---|
| `~/.claude/settings.json` | `permissions.defaultMode = "bypassPermissions"`（已补正确字段；旧的无用字段 `bypassPermissions: true` 保留但不依赖） |
| 启动参数 | `--dangerously-skip-permissions` |
| 实测 | headless 下 Claude Code 执行 `node --version` → `v22.22.2`；实跑 `npm run typecheck` / `npm run test:physics` 成功 |
| 外层沙箱 | `reg.exe` 在黑名单，仅产生一条提示，不影响 node/npm/tsx/构建 |

**结论：不需要再改权限。所有 `node`/`npm`/`npx`/`tsx`、localhost HTTP/WS、文件读写均已放行。**

## 2. 范围：全量，撤销所有阶段限制

原先写在 `runs/stageAB.retry.addendum.md` 和第 3 节里的这些约束**全部作废**：

- ~~只做阶段 A + B~~
- ~~阶段 B 验收完成后立即停止~~
- ~~不得进入 C/D/E、不得导入全量球员~~
- ~~不写客户端 OnlineHost、不做断线重连/持久化~~

**新目标**：连续完成 `A → B → C → D → E → V0.3`，每阶段验收通过即自动进入下一阶段，**不因阶段完成而停机、不逐阶段向用户请示**。

顺序与交付：

| 阶段 | 内容 | 验收 |
|---|---|---|
| A（进行中） | 服务端骨架、`/healthz`、`.env.example` | 服务端/客户端可启动、typecheck、physics 不回归 |
| B（进行中） | 私人房间 + 服务端权威一杆球 + `tools/net-tests.ts` | `npm run test:net` 全绿、双客户端一致 |
| C | `OnlineHost` 接入 `main.ts`、三种模式选择、playbackDone 语义、重连快照 | 无需改代码即可建房/加入、本地模式不回归 |
| D | 服务端时钟、断线保留座位（用 `data/rules.json` 的值）、最小持久化、重启恢复 | 刷新/断网/运动中掉线/重启 四类测试 |
| E | 修 `build` 全链路缺失脚本、真实双浏览器 E2E、全量验证命令、`docs/` | typecheck / test / calibrate / build / E2E 全绿 |
| V0.3 | 可验证的全量人物、技能逐项标注、在线快速匹配、原图/重绘切换、五套球场、移动端适配 | 数据可溯源、不编造卡牌、匹配队列可用 |

**唯一保留的停止条件**（涉及对外不可逆操作，仍需安安点头）：

1. 公网发布 / 付费部署 / DNS 修改 / 对外邀请；
2. 需要新增付费服务、购买服务器或域名；
3. 测试反复修不好，或与现有架构发生根本冲突需要改设计；
4. 任务书第 8 节禁止事项被触发。

除以上四条，一律自主推进，不要停下来问。

## 3. 质量红线（不因"全量"放松）

- 不删测试、不弱化断言、不伪造联机结果；
- 不把两个 localhost 标签页称为"公网联机完成"；
- 不重写物理引擎 `shared/physics.ts` / `shared/match.ts` 的既有行为，不换前端框架；
- 服务端唯一权威、共享确定性代码、配置版本锁定、`clientShotId` 幂等、运行时校验；
- API key / token / 会话密钥不进仓库、文档、日志；数据库文件不进 Git；
- 不用"代码已写"替代"测试已跑"——每条验收都要贴实跑命令与原始结果。

## 4. 交接机制（无人值守的关键）

- **实时进度**：每完成一个关键步骤，追加一行到 `runs/PROGRESS_ALL.md`（A/B 阶段沿用 `runs/PROGRESS_AB.md`），格式 `时间 | 阶段 | 动作 | 命令与结果`。
- **阶段交接**：每阶段结束写 `runs/HANDOVER_<阶段>.md`，含完成项、实跑命令及结果、修改文件清单、未完成项、下一步。
- **上下文重置恢复**：任何会话中途上下文丢失，第一步先读 `runs/PROGRESS_ALL.md` + 最近的 `runs/HANDOVER_*.md`，从断点继续，不重头、不重复写已完成文件。
- **最终交付**：`docs/DEV_STATUS.md`（状态、验收结果、已知限制）+ `runs/FINAL_REPORT.md`（完整最终汇报）。

## 5. 接力方式

A/B 会话按原指令在阶段 B 验收后停止，这是**有意的验收关卡**，不是失败。巴蒂收到完成通知后立即启动接力：

```bash
cd "/d/ai_for_games/碰撞全明星复刻" && \
claude -p "$(cat runs/RELAY_CDE.prompt.md)" \
  --continue \
  --model claude-sonnet-5-5 \
  --dangerously-skip-permissions \
  --effort medium \
  --output-format text \
  < /dev/null > "runs/relay-$(date +%Y%m%d-%H%M%S).log" 2>&1
```

- `--continue` 恢复 A/B 会话上下文，省去重新读全库的成本；新指令首段明确撤销旧范围。
- 若 `--continue` 不可用，退化为新会话，并在指令里要求先读 `runs/HANDOVER_AB.md`、`docs/OPUS55_DEVELOPMENT_PROMPT.md` 和现有代码。
- 若 C→E 会话再次因上下文/时长中断，重复同样模式续跑 V0.3，直到 `runs/FINAL_REPORT.md` 产出。
- 每个接力会话结束，巴蒂**自己实跑** `npm run typecheck` / `test:physics` / `test:net` / `build` 复核，不只信执行者自报。

## 6. 成本约定

- 执行统一用 `claude-sonnet-5-5`；Opus 5.5 只在关键节点（E 阶段完成 / V0.3 完成）由巴蒂按需开一次复核会话，不常规使用。
- 尽量用 `--continue` 复用会话，减少每次新会话的系统提示缓存写入开销。
- 不开子 agent 军团，不为"看起来完整"重复调研。

## 7. 今日目标口径（15:23 安安最终确认：**今天全部完成，不设次日边界**）

| 优先级 | 内容 | 说明 |
|---|---|---|
| **P0** | **联机模式 = 阶段 A→E（V0.2）** | 服务端权威、私人房间、`OnlineHost`、重连/持久化、构建与真实双客户端 E2E 全绿 |
| **P1** | **美术资产接入（不是从零画素材）** | 项目已有 `art/` 约 14MB、16 名球员抠图与桌面/移动端截图归档。修 E 阶段缺失的 `tools/gen-art.ts`（`build:art` 指向它）、让构建链路吃进已有素材、原图/重绘切换、五套球场、移动端适配 |
| **P2** | 全量 106 人可验证数据导入、技能逐项标注、在线快速匹配 | **今天也要跑完**，不再顺延到次日 |

- 数据源已确认存在：`materials/pengzhuang_rebuild/02_players_and_data/` 下有 `card_records.json`、`earlier_exports/players*.json`、`reference_tables/1.2.0/*.json|tsv`、`language_player_names.json`、5 张 contact_sheet（覆盖 001–106）。导入时保留原值、来源版本与冲突记录，不编造缺失卡牌。
- 顺序不变：A→B→C→D→E→V0.3，逐阶段验收但**通过即继续、不停机**。
- 提速：后续所有接力会话统一带 `--effort medium`（全局 `CLAUDE_CODE_EFFORT_LEVEL=max` 是首轮 31 分钟只做规划的主因；当前会话已启动不受影响，项目级不覆盖全局配置）。
- 完成标志：`runs/FINAL_REPORT.md` + `docs/DEV_STATUS.md` 产出，且巴蒂实跑 `typecheck / test:physics / test:net / build` 复核通过。

## 8. 无人值守自愈接力（15:23 启用）

`D:\ai_for_games\autopilot_watcher.sh` 常驻后台，保证链路不断：

- 每 30 秒检查是否还有 headless Claude Code 进程；没有且 `runs/FINAL_REPORT.md` 不存在 → 自动拉起下一段会话（`--continue --dangerously-skip-permissions --effort medium`）。
- 无 `runs/HANDOVER_AB.md` → 判定 A/B 中断，用 `runs/stageAB.retry.prompt.txt` 续做 A/B；有 → 用 `runs/RELAY_CDE.prompt.md` 续做 C→E→V0.3。
- 最多自动拉起 5 次；会话异常快速退出会记警告并冷却；`FINAL_REPORT.md` 出现即退出。日志 `runs/WATCHER.log`，各次会话日志 `runs/auto-*.log`。
- **巴蒂不再手动启动接力**，避免与守护进程重复；收到完成通知时只做复核（检查进程、实跑测试、读交接文档），确认 watcher 仍活着。
- 若 watcher 触发了"已达最大重试"或连续失败，巴蒂接手人工诊断，不让链路静默停掉。

## 9. API 渠道冻结（15:46 安安："无所谓了，继续做"）

- **本轮全量任务期间，不动 `~/.claude/settings.json` 的 API 配置**：主模型 `claude-opus-5-5` / 执行 `claude-sonnet-5-5`、子 agent `claude-haiku-5-5`，全部继续走 MicuAPI（`https://www.micuapi.ai`）。
- "子 agent 改走 Qwen / 百炼"的调研结论已归档到工作区日志，**本轮搁置、不实施**。原因：改全局配置会让 watcher 拉起的接力会话断链；且百炼现有 key 是按量计费，与"不烧按量余额"冲突。
- 若将来要做：`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 是全局单值，需本地按 `model` 分流的网关（claude-* → MicuAPI，qwen-* → `https://dashscope.aliyuncs.com/apps/anthropic`），并把 `CLAUDE_CODE_SUBAGENT_MODEL` 设成 `qwen3-coder-plus`。**等 `FINAL_REPORT.md` 产出后再单独确认**，不要在任务中途动。
