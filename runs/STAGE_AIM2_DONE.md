# AIM-2 瞄准线 / 弧线 / 门线内球员（2026-11-16）

## 用户要求
1. 力线、精准线在所有图层之上。
2. 弧线用键盘左右方向键控制，不再用鼠标划。
3. 准星定长；碰墙后按反射补全剩余长度。
4. 弧线碰墙镜面反弯（不按物理），弧线准星与直线同长。
5. 弧线参数上调。
6. 圆心进门线的球员，回合结束时移动（不是刷新）到周边空位。

## 改动
- `client/src/render.ts`：力度圈从主画布（球员下面）移到 `.aim-layer` 覆盖层，和拉线、预测点一起最后画。
- `client/src/game.ts`：
  - ← / → 每次调 10%，限制在 ±100%，瞄准前后都能调，出手后归零。鼠标拖拽不再改弧线，触屏仍可划弧。
  - 预测线：先在空场跑一次自由飞行（含弧线），再用 `shared/aim.ts foldAimPath` 折进球场。长度 = aimAssist × 6 m（`AIM_LENGTH`，rebuilt），不随力度和弧线变化。
  - 门线内球员结算后从最后一帧位置用 450 ms 缓动滑到新位置，期间不能瞄准。
- `shared/aim.ts`（新）：按墙线、门网、角落弹簧和门柱逐段镜面反射。遇到第一个球员或足球就停，并在那里画虚影。
- `shared/physics.ts`：出手球员撞墙或角落弹簧时转向反号、继续拐。碰球员、足球、门柱或球网后弧线消失。
- `data/physics.json`：`phys-3`，`curve.turnRate` 0.329 → 0.55，`maxTurnDeg` 保持 103.354。`tools/calibrate.ts` 的弧线目标按用户反馈上调为 3.0–3.8 m 和 0.9–1.5 m。`--curve` 自动搜索会把最大转角压到 56°，与"弧线更大"相反，所以手动定参数，并用 `--check` 确认全部达标。
- `shared/match.ts`：未进球时，圆心 |y| > L/2 的球员用 `freeSpot` 移到门前（x 夹在场内，y = ±(L/2 − r − 0.3)），产生 `relocate` 事件。`data/rules.json` 升为 `rules-2`，并加 `behindGoalRule` 说明。
- `client/src/main.ts` 玩法说明、HUD 提示改为方向键。

## 验证
- `npm run typecheck` 0 错误。
- `npm run test:physics` 18/18，新增 3 项：弧线撞墙后镜面反弯、准星定长且碰墙镜面补全（直线和弧线）、门线内球员移到门前空位。
- `npx tsx tools/net-tests.ts` 176/0。
- `npm run build` 通过。
- `npm run test:e2e`（2701/4273）7/0/0，dataVersion `field-2/phys-3/players-2/skills-1/rules-2/levels-1/attrmap-1`。
- `tools/e2e-local.mjs`：1b 改为检查方向键：鼠标划弧仍是直线，→×6 = 60%，←×9 = −30%，到底 −100%，预测线长度不变。整体全部通过，无控制台错误。
- `tools/portrait-smoke.mjs`、`tools/lineup-smoke.mjs` PASS。
- 截图 `docs/screens/aim-bounce-curve.png`：左旋 80% 的预测线碰右墙后镜面弯回，长度 3.98 m，与直线相同。
