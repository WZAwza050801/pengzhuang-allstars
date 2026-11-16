# STAGE AR-1 DONE · 原版球场底图 ×5

时间：2026-11-16 08:15（巴蒂执行，Opus 三次会话崩溃后接管收尾）
状态：✅ 完成，回归全绿

## 交付内容

| 产物 | 说明 |
|---|---|
| `client/public/assets/fields/scene_01..05.webp` | 五套原版球场底图，各 956×1559 px，共约 700 KB |
| `data/fields.json` | 新增 5 个 `scene_xx` skin，各带 `art` / `artSource` / `artCrop` / `artRotate` / `artFit` 字段 |
| `art/build_field_skins.py` | 底图构建工具（crop/rotate/webp 编码 + `--diag` 白线扫描与配色采样） |
| `client/src/render.ts` | 渲染层接入原版底图；`Skin` 接口新增 `art` / `artFit` 可选字段 |
| `tools/shot-skins.mjs` | 皮肤截图工具（Playwright，输出 `runs/_diag/skin_<id>.png`） |

## ★ 修掉一个真 bug：底图裁剪纵向偏移 63px

Opus 前一轮写入的 `artCrop` 是 `[242, 180, 1198, 1739]`。这个范围**上下都错位**：

- 真实球门线在原图 y=243..251（顶）与 y=1793..1801（底），五套图一致；
- 旧裁剪顶部多切了 63px 的**广告板/看台区**（不是球场）；
- 旧裁剪底部把**底线整条切掉了**（1793 > 1739，差 54px）。

**实测方法**（不要重算，已验证）：
1. 在中带 x=500..940 内找白像素占比 >45% 的长横线 → 得到每套图的顶/底球门线；
2. 在中场 y=900..1140 内找白占比 >32/250 的竖直白带 → 得到左右墙内沿；
3. 换算：Scenes_01 顶线 y=243 / 底线 y=1801 / 左墙内沿 x=245 / 右墙带 x=1198..1222。

**修正后的裁剪**（每套图顶线不同，逐套实测）：

| 场景 | artCrop | 结果 |
|---|---|---|
| scene_01 | [242, 243, 1198, 1802] | 956×1559 |
| scene_02 | [242, 244, 1198, 1803] | 956×1559 |
| scene_03 | [242, 244, 1198, 1803] | 956×1559 |
| scene_04 | [242, 245, 1198, 1804] | 956×1559 |
| scene_05 | [242, 246, 1198, 1805] | 956×1559 |

**验证对齐**：裁剪区高 1559 px ↔ 物理 9.78 m（159.4 px/m），宽 956 px ↔ 6.0 m（159.3 px/m）。
原图中列白线换算成米：0.03 / 1.23 / 1.52 / **3.93 / 4.89 / 5.87** / 8.36 / 8.66 / 9.23
→ 中线 4.89 m、中圈 3.89 与 5.89 m 与 `geometry` **完全吻合**，证明裁剪正确。

## 渲染层接入要点

- `Renderer.artImage()` 按 `skin.art` 懒加载 `/{art}`，解码完成后才绘制；
- **有底图时跳过程序化草皮与白线**（原图自带草色与白线，两者同画会变成双线）；
- 无底图的 3 个 skin（classic / cup / sunset）行为不变；
- `skin` 可在局内菜单热切换（`game.ts` 已有 `skinSel` 监听），底图随之切换。

## 实跑验证（原始输出）

```
npm run typecheck      → exit 0
npm run test:physics   → 15/15 passed（含 30 场完整比赛 30/30）
npx tsx tools/net-tests.ts → net-tests: PASS=176 FAIL=0
npm run build          → exit 0，dist/client/assets/fields/ 5 张 webp 已打包
npm run test:e2e       → [e2e-browser] PASS=7 SKIP=0 FAIL=0
node tools/shot-skins.mjs → 8 个 skin 全部截图成功，page errors: 0
```

目视复核（`runs/_diag/skin_scene_01.png` / `skin_scene_05.png`）：原版草坪纹理、原图自带的中线/中圈/禁区/罚球弧全部清晰且位置正确，无拉伸变形、无空白条带。

## 遗留 / 交接

1. **球门口宽度冲突仍在**（AR-4 的活）：底图球门口实测约 38% 场宽，而物理 `goalWidth=2.05 m`（34.2%），T3 已拍板改 1.68 m（28%）。
   底图裁剪**只取两条球门线之间**，球门网与门框仍程序化绘制（AR-4），开口宽度取 `geometry.goalWidth`。
2. **四角弹簧仍是程序化绘制**（AR-2）。
3. **球门/边墙仍是程序化绘制**（AR-4）。
4. 底图的 `outside`（场外看台）没有包含在裁剪内，场外仍用 `skin.outside` 纯色填充。
