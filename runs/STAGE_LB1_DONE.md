# LB-1 阵容与选人 · DONE 2026-11-16

## 为什么做
安安试玩后指出：101 名原版球员（p17–p117）数据和头像都已导入，但比赛阵容写死在
`rules.defaultLineup` 和 `main.ts` 的 `BOT_LINEUP` / `P2_LINEUP` 里，没有选人界面，所以场上几乎只有 p01–p05 和自制的 p06–p16。

## 做了什么
- `art/build_lobby_assets.py`（新）：
  - 从 Skin 图集切 48 个大厅和阵容切片，放到 `client/public/assets/orig_ui/`。
  - 复制 Image_01–05、Image_A/B、Img_01 到 `orig_ui/stadium/`。
  - 切 69 个原版技能图标，放到 `client/public/assets/skills/`。
  - 生成 `data/player_catalog.json`（catalog-1）：106 名原版球员（有 srcId 且有原版头像），带原版卡的位置、稀有度、技能名、技能原文描述和解锁等级。这个文件只供界面显示，不进 GameData，dataVersion 不变。
- `client/src/lineup.ts`（新）：
  - "首发阵容"半场：2-2-1，位置照 `rules.formation` 换算。
  - 1/2/3 三套阵容存档，键名 `pz_lineups`。
  - 卡池分全部、前锋、中场、后卫，用 Box_Quality 01–04 卡框，按品质对应。
  - 详情窗仿原版"特队"窗：品质、位置、五项属性（按卡牌等级读 levels 表，附下一级加成）、三段技能和解锁等级，再加"上场"按钮。
  - 已在场上的球员会和当前位置互换，不会重复。
  - 新装默认阵容取每个位置最强的原版球员。
- `client/src/main.ts`：
  - 新的大厅外壳：原版顶栏（等级、经验、钞票、钻石，数值本地存，"+"提示未开放），底部导航（商店、阵容、比赛、成就、俱乐部）。
  - 默认打开"比赛"页，原有表单暂时放在这一页，LB-2 再重做。
  - 练习、同屏和联机都改用 `activeLineup()`。电脑和玩家 2 用 `randomLineup()`，只从原版球员里挑，按位置配齐。
  - 删除了 `BOT_LINEUP` / `P2_LINEUP`。
- `client/src/style.css`：新增外壳、阵容和详情窗的样式。
- 未改动：`rules.defaultLineup`（服务端兜底和测试基线仍用它）、`shared/`、`server/`、物理常量。

## 测试
- typecheck 0；physics 15/15；net-tests PASS=176 FAIL=0；build 0。
- e2e（2701/4273）PASS=7 SKIP=0 FAIL=0。
- `node tools/portrait-smoke.mjs` PASS。场上 10 人全是原版头像，断言从"必须混有回退头像"改成"必须全部是原版"，比原来更严格。
- `node tools/lineup-smoke.mjs`（新，需要 dev 服务器在 5180）PASS：
  - 卡池正好 106 人，不含 p06–p16，没有坏图。
  - 换人后存档正确，没有重复球员。
  - 进入比赛后，我方 5 人就是所选阵容，电脑方全是原版球员。
- 截图：`runs/_diag/s1_lineup.png`、`s1_detail.png`、`s1_play.png`。

## 已知问题
- 71 名原版球员的技能在比赛里仍是 `unimplemented`。详情窗显示的是原版技能原文，并注明"比赛里目前只有部分技能已实现"。这部分归 T4-c1。
- 卡牌等级还是大厅设置里的统一等级，没有逐卡升级（经济系统按决定只做界面）。
- 白色品质的 3 人用绿色卡框去色显示，原版白卡框没找到。
