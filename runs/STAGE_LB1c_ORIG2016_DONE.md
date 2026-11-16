# LB-1c 比赛场地按原版对战截图重绘 — DONE

## 做了什么
- 新皮肤 `orig_2016`「原版·早期球场」（`data/fields.json` 第一个，`style: "drawn"`），社区联赛（Image_01）改用它。
  参考 `references/taptap_original_3.jpg`、`2016_gallery_4`、`taptap_promo`。资料包里没有这张场地的贴图，所以整屏都用代码绘制：
  - 草坪是浅绿棋盘格（#b9d348 / #9ec443，从截图取样），每格 6/17 m，带细噪点，墙脚有草须和阴影。
  - 白色圆角围墙和四角白石块，球门口留出缺口。
  - 四角有红色弧形护垫和两个蓝灰盘簧，被球撞到时沿用原来的 `springHits` 回弹和发光。
  - 白色球门框和球网凸出在墙外、压在树篱上。视觉深度是 goalDepth+0.24 m，物理球袋仍然是 0.4 m。
  - 外圈是树篱，上方有彩旗串和石块，四角插橙色角旗，两侧是红色看台，地面黄绿色。
  - 顶部青｜黑｜红比分条，位置和 SCENE_BAR 一致，DOM 计分照旧叠在上面。
- `render.ts`：静态层（背景、树篱、草坪、围墙）按布局缓存到 `drawnCache`（canvas 尺寸、缩放、flip 任一变化就重建），每帧只重画护垫和球门。
  版式复用 sceneMode（虚拟 sceneSize [1440,2050]、artCrop [242,330,1198,1889]），`game.ts` 不用改。
- `tools/shot-skins.mjs` 新增 `SHOT_ONLY`、`SHOT_DPR`、`SHOT_WAIT` 三个参数。

## 没动
物理几何、physics 常量、dataVersion、服务端都没改。scene_01–05 仍然可以在局内「场地外观」里选。

## 验证
typecheck、physics 15/15、net 176/0、build、e2e 7/0/0、portrait-smoke PASS、lineup-smoke PASS、e2e-local（10/10 头像，无控制台错误）、shot-skins 0 page errors。
对照图：`runs/_diag/orig2016_compare.jpg`（左原版，右重绘），顶部特写 `runs/_diag/orig2016_top.png`。
