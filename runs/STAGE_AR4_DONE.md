# STAGE AR-4 DONE · 双边门框

时间：2026-11-16 11:00
状态：✅ 完成。物理没动，回归全绿

## 画法

原版没有单独的门框图。球门是围挡中间的缺口，缺口按 `geometry.goalWidth` 留出来。现在这个数仍是 **2.05 m**。T3 改成 1.68 m 时，门框会跟着变，不用再改绘制代码。

| 位置 | 现在的样子 |
|---|---|
| 门柱外侧 | 浅灰石墙 `#f2f2f0`，竖直接缝大约每 1/6 门宽一条，外沿有一条高光 |
| 开口 | 正好是 `goalWidth`。开口里不再画白框 |
| 网 | 透明度从 0.85 降到 0.18。原图缺口是通出去的，网不该抢眼 |
| 门柱端头 | 蓝灰盘簧，换掉原来的白色圆点 |

`Goal_00..03.png` 是边墙护栏，没有拿来当门框。

原图球门口大约 360 px（场宽的 38%）。物理开口 2.05 m 是 327 px（34%）。石墙从门柱画到角上，把多出来的那段缺口盖住。

## 实跑

浏览器在原版球场上取样：门柱外石墙 RGB 228,228,226；开口中心 RGB 62,109,42，是场外绿色，不是白网。

```
npm run typecheck          → exit 0
npm run test:physics       → 15/15 passed（门柱擦边仍是碰柱 13、进 3 / 出 10）
npx tsx tools/net-tests.ts → PASS=176 FAIL=0
npm run build              → exit 0
npm run test:e2e           → PASS=7 SKIP=0 FAIL=0
node tools/portrait-smoke.mjs → PASS（含门框取样）
```

`goalWidth` 仍是 2.05。dataVersion 没变。

## 遗留

下一项是 AR-5 游戏 UI。T3 把门宽改成 1.68 m 之后，开口会自动收窄，到时看一眼石墙接缝即可。
