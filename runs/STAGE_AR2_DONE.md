# STAGE AR-2 DONE · 四角弹簧

时间：2026-11-16 10:45
状态：✅ 完成，回归全绿

## 交付

| 产物 | 说明 |
|---|---|
| `client/public/assets/fields/spring_corner.png` | 128×128，26,392 字节。从 `Scenes_01.jpg` 可玩区左上角切出 |
| `art/extract_spring.py` | 抠草地和灌木，留下石墙、蓝灰盘簧、沙土 |
| `client/src/render.ts` | 四角镜像这张图。有原版底图时只画切角三角，避免和底图叠两层。受击时缩到 0.88 再弹回，上限 1.08 |

`geometry.cornerCut` 仍是 0.5 m。碰撞没改。

切角三角里不透明像素占 96.1%。原版球场左上角采样是 RGB 175,171,181，蓝灰，不是原来的橙色垫。

图还没解码完时，用白石、蓝灰圈、沙土三角顶上，不再画橙色垫。

## 顺手删掉的 Q 版头像

有原图的 106 人，`players/` 里的 `_avatar.png` 和 `_full.png` 一共删了 212 张。大厅和局内的「Q版重绘」开关也去掉了。

p06–p16 没有原版图，这 11 人的头像留着。`gen_placeholders.py` 和 `chromakey.py` 不会再把已删的 106 张生成回来。

## 实跑

```
python art/extract_spring.py     → PASS（三角内不透明 0.961）
npm run typecheck                → exit 0
npm run test:physics             → 15/15 passed（角落弹簧仍四角弹出 3.95 m/s，足球不加力）
npx tsx tools/net-tests.ts       → PASS=176 FAIL=0
npm run build                    → exit 0，dist 里有 spring_corner.png，没有 p01_avatar.png，有 p06_avatar.png
npm run test:e2e（2701/4273）     → PASS=7 SKIP=0 FAIL=0
npx tsx tools/online-e2e.ts      → 17 项 PASS，0 失败
node tools/portrait-smoke.mjs    → PASS
                                   场上 4 原图 + 6 回退；106 文件 256×256
                                   原版球场左上角 RGB 175,171,181
```

## 遗留

下一项是 AR-4 双边门框。门宽仍是 2.05 m，T3 再改成 1.68 m。
