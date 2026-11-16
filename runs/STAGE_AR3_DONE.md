# STAGE AR-3 DONE · 原版球员头像 106 张

时间：2026-11-16 10:00
状态：✅ 完成，回归全绿

## 交付内容

| 产物 | 说明 |
|---|---|
| `client/public/assets/players_original/*.png` | 106 张 256×256 RGBA，共 7,901,506 字节 |
| `data/portrait_map.json` | `portraits-1`，106 条 `id → srcId → portraitId`，另列 11 个回退 id |
| `data/settings.json` | `portraitStyle: "original"`。不进 `GameData.version` |
| `art/import_original_portraits.py` | 导入器。连跑两次资产 sha256 都是 `60f55b313031b77ebe6e4e48ccf80b90f4bc03ccd07c775c30b89a081a6f9983` |
| `art/avatar.py` | 新增 `make_original_disc`（裁切 / 留白 / 圆形遮罩） |
| `client/src/portraits.ts`、`render.ts`、`main.ts`、`game.ts` | 默认原版；大厅和局内菜单可切到 Q 版重绘，存在 `localStorage pz_portrait` |
| `tools/portrait-smoke.mjs` | 浏览器核对场上圆盘用的是哪张图 |

圆盘绘制（白边、队伍色环、圆形裁切）没有改。变的是喂进去的图。

## 裁切

源图 106/106 都是 194×188 RGBA。按 alpha>16 的内容框裁切，长边留白 6%，等比缩放到 256，再套圆。圆外 alpha 为 0。没有重绘，没有改色。

| 测量 | min / median / max |
|---|---|
| 不透明像素占原画布（这就是交接里说的「约 46%」） | 0.375 / 0.426 / 0.625 |
| 内容框面积占原画布 | 0.537 / 0.591 / 0.858 |
| 成图里脸到画布边缘的留白 | 12 / 13 / 14 px |
| 圆内不透明占比 | 0.484 / 0.615 / 0.741 |
| 裁切前后颜色中位数差（0–255） | 0 / 2 / 5 |

梅球王 `head_4001_40108`：不透明像素 46.4%，内容框 `(32, 8, 175, 172)`。施工单里的 `x∈[32,169], y∈[1,168]` 是约数，导入器用实测框。

## 谁用原图，谁回退

- 106 人有原图。样例：p01 `40108 → head_4001_40108`，p02 `40208 → head_4002_40208`，p117 `90003 → head_9001_90003`。
- p06–p16（坦克哥、门神、卷毛狮、鲁大师、卤蛋、丸子头、脏辫侠、红毛、金毛、飞猫、大胡子）没有 `srcId`，继续用 `players/pXX_avatar.png`。没有灰饼。
- `head_4001_40109`（小罗候选）按 D6 不进名单，也没有复制进 `players_original`。

原图加载失败时，这一张会改去读对应的重绘文件。

## 实跑验证

```
python art/import_original_portraits.py  → PASS（两次 sha256 相同）
npm run typecheck                        → exit 0
npm run test:physics                     → 15/15 passed
npx tsx tools/net-tests.ts               → PASS=176 FAIL=0
                                           dataVersion 仍是 field-2/phys-2/players-2/skills-1/rules-1/levels-1/attrmap-1
npm run build                            → exit 0
                                           dist/client/assets/players_original 106 张
npm run test:e2e（端口 2701/4273）        → PASS=7 SKIP=0 FAIL=0
npx tsx tools/online-e2e.ts（:2702）     → 17 项 PASS，0 失败
node tools/portrait-smoke.mjs            → PASS
```

场上核对（默认阵容 + 简单电脑，10 个圆盘）：4 张走原图，6 张走 p06–p16 的重绘回退；106 个原图文件全部解码为 256×256；局内开关切到「Q版重绘」再切回「原版原图」，地址跟着变；控制台错误 0。

对照图（给人眼看，本阶段没有用 Read 打开）：`runs/_diag/style_compare.png`（梅球王 / 小小罗 / 大罗）。

## 遗留

1. **AR-2 四角弹簧**还没做。
2. p06–p16 仍是 Q 版。要全场统一，得按原厂模板生成，这是生成不是取原图，和 D9 有张力，等安安确认（AR-6）。
3. 物理 `goalWidth` 仍是 2.05 m。AR-4 若先做门框，用这个宽度，T3-a 后再复核。
