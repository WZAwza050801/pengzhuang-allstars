# LB-2 原版大厅（比赛页）· DONE 2026-11-16

## 做了什么
"比赛"页照原版 1.5.5 大厅重做（依据 `taptap_promo.jpg`、`2016_gallery_2.jpg`、`2017_global_2.jpg`）：
- **资料栏**：徽章（Btn_Icon_06）、昵称、"我的俱乐部"、金币（Ico_03）、设置齿轮（Btn_Icon_01）。昵称框就是 `.nick`，点一下就能改。
- **合同**：自由合同（Store_Icon_01）和重磅合同（Store_Icon_05）。按安安的决定只做界面，点击提示"暂未开放"。
- **联赛球场**：标题条 + 原版球场模型 Image_01–05，可左右切换，下方有圆点指示。切换会写入 `pz_skin`，每座球场对应同序号的原版比赛场景 scene_01–05。联赛名是重建的（社区 / 地区 / 甲级 / 超级 / 全明星联赛），截图里只能看到"地区联赛 / League Two"。
- **两侧图标按钮**：杯赛、任务、成就、训练、分享、邮件，用的是原版 Btn_Icon 图标，目前都是"暂未开放"。
- **底部按钮**："杯赛"（未开放）和"竞技模式"。"竞技模式"会打开原版风格的弹窗，练习（简单 / 普通 / 困难）、同屏双人、在线约战和回合计时都在里面。
- **设置弹窗**（齿轮）：卡牌等级、静音、服务器、怎么玩、数据版本。
- **按钮九宫格**：原版按钮图是 44×44 的切片，现在按九宫格拉伸，角不再发糊，用于弹窗、底部按钮、比赛菜单和结算窗。
- 从 Skin 图集新增 8 个切片（`art/build_lobby_assets.py`）。

## 测试脚本跟随 UI 调整（只调整流程，没有放松断言）
- 练习入口收进了弹窗，所以 `e2e-browser`、`e2e-local`、`portrait-smoke`、`shot-skins`、`lineup-smoke` 在开局前都先点 `.btn-play`。
- `portrait-smoke`：
  - 等待目标从 `.skin`（大厅已经没有场地下拉框）改成 `.btn-play`。
  - "主按钮是 Btn_02"的检查改为同时读 `border-image` 和 `background-image`，因为按钮现在是用九宫格 border-image 画的。
- `e2e-local`：头像加载检查原来写死旧 Q 版路径 `/assets/players/<id>_avatar.png`（这批文件已按安安要求删除），所以一直是 0/10。现在改为读渲染器实际绑定的头像，结果 10/10。
- `lineup-smoke`：新增大厅截图，并断言点"下一座"后 `pz_skin` 变成 scene_02。

## 测试结果
- typecheck 0；physics 15/15；net-tests 176-0；build 0；e2e 7-0。
- portrait-smoke PASS；lineup-smoke PASS；e2e-local 全部正常（头像 10/10，没有控制台错误）。
- 截图：`runs/_diag/s2_home.png`、`s2_sheet.png`。

## 下一步（LB-3）
联赛积分和解锁：赢了加分、输了扣分，分数存在本地；没解锁的球场显示锁定；顶栏经验条跟着比赛走；比分条上加队徽。
