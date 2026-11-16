# STAGE AR-5 DONE · 游戏 UI

时间：2026-11-16 11:08
状态：✅ 完成。只换了外观，点击和联机流程没改

## 用上的原版素材

切到 `client/public/assets/orig_ui/`，一共 24 个文件。

| 界面 | 素材 |
|---|---|
| 大厅背景 | `Background.jpg` |
| 标题 | `Logo_zh.png`（560×260） |
| 普通按钮 | `Btn_00` 绿 |
| 主按钮 | `Btn_02` 橙 |
| 认输 | `Btn_04` 红 |
| 返回 / 取消 | `Btn_03` 灰 |
| 菜单按钮 | `Btn_Return` |
| 大厅分组、「怎么玩」 | `Box_02` / `Box_01` |
| 菜单和结算框 | `Windos_TipsBox` |
| 回合条 | `Tab_05` |
| 当前行动方 | `Box_Select` 蓝圈 |

按钮的 class 和 `data-bot` 都没动。窄屏仍是原来的 560 宽、按钮自动换行。

## 先不接的

- **技能图标** 83 张。`skill_XXX_XXXX` 和技能 id 的对应还没对上，标 `pending-confirmation`，等 T4-c。
- **俱乐部徽章** 66 张。一场的一方不是一家俱乐部，没有按 `club_cn` 硬套。
- **品质框** `Box_Quality_01/03/05` 已切出。没有套到场上圆盘上，避免挡住头像。
- `Black_Translucent_Bottom` 的不透明像素中位数是白色，不是黑条，没有铺到底栏。

## 实跑

```
python art/extract_atlas.py  → 切出 22 个，跳过 0
npm run typecheck            → exit 0
npm run build                → exit 0
npm run test:e2e             → PASS=7 SKIP=0 FAIL=0（一杆球 shotNo 0 → 1）
npx tsx tools/online-e2e.ts  → 17 项 PASS，0 失败
node tools/portrait-smoke.mjs → PASS
                                 主按钮背景是 Btn_02，Logo 能解码
                                 门框石墙 228,228,226，开口 62,109,42
```

物理文件没改，没有重跑 physics / net。上一轮 net 是 176-0，dataVersion 仍是 field-2/phys-2/players-2/skills-1/rules-1/levels-1/attrmap-1。
