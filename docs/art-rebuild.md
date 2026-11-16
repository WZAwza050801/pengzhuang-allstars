# 原版头像接入（AR-3）

场上圆盘用原版 1.5.5 的 `head_*.png`。只做裁切和圆形遮罩。

Q 版重绘已经从 `client/public/assets/players/` 删掉（有原图的 106 人，头像和全身各一张）。没有「切回 Q 版」的开关。

p06–p16 没有原版图，这 11 张旧头像留着，否则圆盘会变成灰饼。

| 路径 | 作用 |
|---|---|
| `data/portrait_map.json` | 106 条 `球员 id → srcId → portraitId` |
| `client/public/assets/players_original/<portraitId>.png` | 256×256 圆形原图 |
| `client/public/assets/players/p06..p16_avatar.png` | 仅这 11 人 |

重新生成原图：`python art/import_original_portraits.py`。

对照图：`python art/preview_style.py`，输出 `runs/_diag/style_compare.png`。
