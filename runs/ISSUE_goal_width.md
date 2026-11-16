# 待办：球门开口「有点偏大」（安安 2026-11-15 17:51 反馈）

## 现状

| 项 | 值 | 位置 |
|---|---|---|
| 门宽 `goalWidth` | **2.05 m** | `data/fields.json` → `geometry.goalWidth` |
| 场宽 `width` | 6.00 m | 同上 |
| 门宽 / 场宽 | **34.2 %** | — |
| 门深 `goalDepth` | 0.40 m | 同上 |
| 门柱半径 `postRadius` | 0.07 m | 同上 |
| 版本 | `field-2` | 同上 |

**这个数字是有出处的**：`fields.json` 的 `geometry.source` 明确写了「对战宣传图 taptap_original_3.jpg（1242×2208）量得球门开口 ≈ 0.34 场宽」。所以当前值是**按原版比例复刻**，不是 bug。

## 为什么不能现在直接改

`fields.json` 的 note 已写明：「geometry 是唯一的物理边界来源，所有皮肤共享；**改动 geometry 等于改手感，需要重跑校准**」。门宽会连锁影响：

1. `shared/physics.ts`：门柱位置（`gw = goalWidth / 2`）、进球线判定、球网碰撞体；
2. `docs/calibration.md` 的校准基线（含「门柱擦边 13 个横向偏移」用例）；
3. `npm run test:physics` 14/14 中的门柱擦边 / 高速入门 / 部分过线不算进球等用例；
4. `npm run test:net` 176 用例里三场整局的进球分布与 `shot-limit` 结束条件；
5. `field-2` 版本号需升位 → `GameData.version` → `configVersion` → 服务端校验链。

**当前 C 阶段（OnlineHost + 重连）正在进行、会话在跑，此时改物理数据会让它的验收基线失效。** 故本轮只登记，不动数据。

## 候选值（待安安拍板）

| 门宽 | 占场宽 | 相对当前 | 说明 |
|---|---|---|---|
| 2.05 m | 34.2 % | — | 现状，原版量测值 |
| **1.90 m** | 31.7 % | −7 % | 轻微收口，手感变化最小（推荐先试） |
| 1.80 m | 30.0 % | −12 % | 明显收口 |
| 1.65 m | 27.5 % | −20 % | 大幅收口，进球率会显著下降 |

## 执行时机与步骤（V0.2 全绿之后单独做一轮）

1. 备份 `data/fields.json` 与 `docs/calibration.md`（可用 `npm run backup`）；
2. 只改 `geometry.goalWidth`，**同步升版本号** `field-2 → field-3`，不要动其它 geometry 字段；
3. 依次实跑：`npm run typecheck` → `npm run calibrate` → `npm run test:physics`（14/14）→ `npm run test:net`（176）→ `npm run build` → `npm run test:e2e`；
4. 更新 `docs/calibration.md` 的门柱相关结论，并把新旧进球率（30 场完整比赛）做 before/after 对照；
5. 若物理回归出现 FAIL，回退到 2.05 并如实记录，不要弱化断言。

## 备注

若反馈的其实是**视觉观感**（门框画得太粗 / 网太显眼）而非物理开口，则应改 `client/src/render.ts` 的绘制或 `fields.json` 的 `goalFrame` 颜色/线宽，**完全不用碰物理与校准**——这条路径成本最低，建议先确认属于哪一种。
