# 原版美术重建施工单（Art Rebuild Spec）

> 本文件是**实测数据 + 逐项施工步骤**，不是需求描述。所有像素坐标、尺寸、颜色都已在原图上量过。
> 素材根目录：`materials/pengzhuang_rebuild/`
> 施工者：**只做本文件列的事**，不要重新调研 materials/（已全量摸底，见 `runs/MATERIALS_DIGEST.md`）。

---

## 0. 总原则

1. **换皮只改画面，绝不改碰撞几何。** `data/fields.json` 的 `geometry` 是唯一物理边界来源。
   原版图里的墙线、门柱位置**不自动**成为碰撞体。反过来，物理几何改动必须走 T3 流程（重跑 calibrate + 全回归）。
2. **原版素材是权威来源**，优先级高于任何手绘/AI 重绘。
3. **原图 → 物理坐标的映射只做一次**，写进 `data/fields.json` 的 `skin.art` 元数据里，其余模块只读。
4. 每完成一项 → 写 `runs/STAGE_<ID>_DONE.md` + 在 `runs/PROGRESS_ALL.md` 追加一行 + 把队列对应项改成 `[x]`。
5. **单会话工具调用上限 60 次**（见 `runs/RESUME_V4.prompt.md` 第 4 节）。接近上限就落盘收尾。

---

## 1. 球场底图（5 套原版球场）

### 1.1 素材
```
materials/pengzhuang_rebuild/03_art/original_images/1.5.5/texture/Scenes_01.jpg  1440x1920 RGB 277KB
                                                              Scenes_02.jpg  1440x1920
                                                              Scenes_03.jpg  1440x1920
                                                              Scenes_04.jpg  1440x1920
                                                              Scenes_05.jpg  1440x1920 237KB
（1.2.0 版同名 5 张也存在，见 materials/.../original_images/1.2.0/texture/）
```
现状：项目里的 3 套皮肤（classic/cup/sunset）是**程序化重绘**的纯色块 + 画线（`client/src/render.ts` `drawField()`，
配色在 `data/fields.json` 的 `skins[]`）。没有用上一张原版图。

### 1.2 ★ 已实测的关键几何（务必沿用，不要重算）
| 项 | 实测值 | 来源 |
|---|---|---|
| 原图尺寸 | 1440 x 1920 px | PIL 实测 |
| **可玩区（白色边墙内沿）** | **956 x 1559 px** | 实测；`fields.json` 的 `geometry.source` 已引用 |
| 可玩区在原图中的位置 | x ∈ [242, 1198]，y ∈ [180, 1739] | 实测 |
| 可玩区长宽比 | 1559 / 956 = **1.631** | 与现有 `length/width = 9.78/6.0 = 1.630` 一致 ✅ |
| 底图是**俯视**视角 | 球场沿**纵向**（y 轴），两个球门在 y 上下两端 | 目视 `runs/_diag/Scenes_01.jpg` |
| 底图**自带**的内容 | 草坪纹理、白色边墙、白线（禁区/中圈/中线）、看台、场外广告牌、球门挡板 | 目视 |

> ⚠️ **底图是纵向的**（门在上下），而项目渲染的球场是**横向**（门在左右，`render.ts` 里 goal 在 `±L` 的 x 方向）。
> 接入时必须做 **90° 旋转**才能对上。旋转方向：把原图的"上"转到项目的"右"（或反之，选定后写进代码常量，别两处不一致）。

### 1.3 施工步骤
1. 新建 `art/build_field_skins.py`：
   - 读 5 张 Scenes_XX.jpg
   - 裁出可玩区 + 适当外扩（**含边墙和球门挡板**，即 x ∈ [242-60, 1198+60]，y ∈ [180-60, 1739+60]）
   - 旋转 90° 对齐项目横向球场
   - 输出到 `client/public/assets/fields/scene_01.png` … `scene_05.png`（PNG 或 WebP，控制体积）
2. `data/fields.json` 的 `skins[]` 扩到 5 条，每条新增：
   ```json
   { "id": "scene_01", "name": "原版·经典草坪", "art": "assets/fields/scene_01.png",
     "artSource": "materials/pengzhuang_rebuild/03_art/original_images/1.5.5/texture/Scenes_01.jpg",
     "artCrop": [182, 120, 1258, 1799], "artRotate": 90, "artFit": "cover" }
   ```
   保留原有 3 套程序化皮肤（`pattern: checker/rings/stripes`）作为**低清/离线兜底**，当 `art` 缺失时走原逻辑。
3. `client/src/render.ts` `drawField()`：若 skin 有 `art`，则
   - 先 `drawImage` 铺底图（覆盖整个 outline 裁剪区）
   - **再叠加**程序化画的白色球场线？还是**完全用底图自带的白线**？
     → **推荐：完全用底图自带白线**，不再叠加程序化线（避免双线错位）。程序化线只在无 `art` 时画。
   - 球门网/门框仍由程序化画（因为物理开口是 1.68m，与底图的开口宽度不一定一致 —— 见 §2.3）
4. **不要**把底图上的看台/广告牌画进可玩区 —— 裁剪时只保留边墙内沿以内 + 一点点墙。

### 1.4 验收
- 5 套球场都能在 UI 里选，且画面里白线位置与 `geometry` 的禁区/中圈对得上（球门除外，见 §2.3）
- `typecheck` + `test:physics` + `test:e2e` 全绿（换皮不该影响物理）
- `docs/art-rebuild.md` 里贴 5 张对比截图

---

## 2. 四角弹簧（Corner Springs）

### 2.1 ★ 已实测：原版长什么样
目视 `runs/_diag/c_tl.png`（原版左上角 300x300 放大裁切）：
- **不是一个柱子**，是**斜着嵌进墙角的弹簧组**：
  - 一段**深灰/蓝灰色金属螺旋弹簧**（盘绕 2 圈，直径约 40px），斜向插在墙角
  - 弹簧上方/外侧接着一段**白色石质边墙**（有横向分块接缝）
  - 弹簧内侧是一片**沙土色三角**（墙内角的小土坡）
- 四个角结构完全对称。**上半球场左右上角各一组，底球场左右下角各一组**（共 4 组，
  正好对应项目里 `SPRING_SIGNS = [[-1,-1],[1,-1],[1,1],[-1,1]]`）。

**原版并没有"角柱"**。它就是**墙角的斜切面 + 一根盘绕的金属弹簧 + 内侧土坡**。
现有 `render.ts` 的 `drawSprings()` 画的是「housing（斜三角深色块）+ 两圈线圈 + pad」，
**方向和结构是对的**，但配色偏抽象。

### 2.2 坐标
- 弹簧组在原图中的位置：左上角约 x ∈ [242, 300]，y ∈ [180, 250]（原图像素）
- 对应可玩区左上角，即项目坐标里的**左上/右上/左下/右下四个角**
- 项目 `geometry.cornerCut = 0.5` m（切角边长），弹簧组直径约 `0.06 ~ 0.09` 场宽
  → 现行取 **0.5 m** 是合理的，**不要改**

### 2.3 施工步骤
1. **优先方案（推荐）**：用原图**切出**弹簧 sprite
   - 从 `Scenes_01.jpg` 裁出四角弹簧区域 → 去背景（绿幕/草地抠图）→ 存为透明 PNG
   - 放进 `client/public/assets/fields/spring_corner.png`
   - 抠图可以用 `art/chromakey.py`（已存在，纯 Pillow 绿幕抠图）
   - 注意：弹簧是蓝灰色，草地是黄绿色，黄色灌木也在 —— 需要针对这一小块调阈值
2. **兜底方案**：抠不干净就用程序化重绘，但改成原版观感：
   - 弹簧体：蓝灰色（`#6b7a9c`）金属圈，画 2~3 圈螺旋，斜 45° 朝向场心
   - 墙：白色石质（`#f0f0ee`）+ 横向接缝
   - 内侧土坡：沙土色（`#d9c08a`）小三角
3. `render.ts` `drawSprings()`：改为绘制 sprite（或重绘），保留现有的**受击回弹动画**
   （`springHits[]` + `tau` 衰减），动画幅度要匹配 sprite 尺度。

### 2.4 验收
- 四角看起来像原版（斜切角 + 金属盘簧 + 土坡），不再是抽象三角块
- 球撞角时弹簧有可见压缩回弹
- 物理完全不变（`cornerCut` / 碰撞体不动）

---

## 3. 球员头像（原版 106 人）

### 3.1 素材（★ 全覆盖，无需生成）
```
materials/pengzhuang_rebuild/02_players_and_data/portraits/1.5.5/head_XXXX_YYYYY.png
```
- **107 张** PNG，**194x188 RGBA**
- 命名规则 `head_<cardGroup>_<playerId>.png`，例 `head_1001_10101.png`
- **106 张对应正式球员（覆盖率 106/106）**，第 107 张 `head_4001_40109` 是小罗候选
  （按 `runs/DECISIONS.md` D5：**不进正式名单**）
- 内容占比 46%，alpha 边界约 x ∈ [32,169], y ∈ [1,168]（不是满图，**留白在四周**）

### 3.2 ★ 映射关系（已实测连通，106/106 命中）
```
data/players.json 的 srcId  ==  earlier_exports/player_portrait_mapping.csv 的 player_id
                                 ↓ csv 的 portrait_id 列
                              head_<cardGroup>_<playerId>.png
```
实测：`players.json` 里 107 条有 `srcId`，其中 **106 条命中 csv**，唯一未命中的是 `srcId=null` 的那 1 条。
csv 共 106 行，每行的 `portrait_id` 对应头像文件**全部存在（0 缺失）**。

### 3.3 现状对比
| | 现役 | 原版 |
|---|---|---|
| 目录 | `client/public/assets/players/p01..p117_avatar.png` | `materials/.../portraits/1.5.5/` |
| 数量 | 117（16 手绘 + 101 AI 生成） | 106 |
| 尺寸 | 256x256 RGBA | 194x188 RGBA |
| 来源 | AI 宫格生成（ImageGen） | **原版美术** |
| 加载 | `client/src/render.ts` 按 `player.id` 取 `pNN_avatar.png` | — |

### 3.4 施工步骤
1. 写 `art/import_original_portraits.py`：
   - 读 `data/players.json` + `player_portrait_mapping.csv`
   - 按 `srcId → portrait_id` 匹配，把原版 PNG **复制**到 `client/public/assets/players_original/`
   - 文件名保持 `head_<cardGroup>_<playerId>.png`
   - 同时输出映射表 `data/portrait_map.json`：`{ "p01": "head_4001_40108", ... }`（含 srcId → portrait_id → 路径）
2. **留白处理（关键）**：原版 194x188 的 alpha 内容只占 46%，四周有大量留白。
   直接缩放到 256x256 会让人物变小很多。正确做法：
   - 按 **alpha 内容框**裁剪出实际人像 → 再放进圆形遮罩
   - 现役头像的圆形遮罩实现在 `art/avatar.py`（已存在），**复用它的圆形遮罩与边距逻辑**
   - 参考 `art/split_heads.py` 里 `MARGIN = 1.24` 的经验值（头顶硬边教训）
3. `client/src/render.ts` 增加 **头像来源切换**：
   - `data/fields.json` 或新建 `data/settings.json` 加 `"portraitStyle": "original" | "redrawn"`
   - 默认 `"original"`（按 `runs/DECISIONS.md` D2）
   - 加载路径：`players_original/<portraitId>.png` 优先，回退 `players/pNN_avatar.png`
4. UI 里给玩家一个开关（原图 / AI 重绘），存 localStorage。

### 3.5 验收
- 场上 106 人显示的是**原版头像**（不是 AI 重绘）
- 没有原版图的那 1 人回退到 AI 重绘，不出现破图
- 圆形遮罩头顶不切头、不留黑边
- `docs/art-rebuild.md` 贴「原版 vs AI 重绘」并排对比图

---

## 4. 双边门框（Goal Frame）

### 4.1 ★ 已实测：原版门框长什么样
**结论：原版球场底图里没有独立的"门框 sprite"**，球门是**围挡中间的一个缺口**。

目视 `runs/_diag/goal_mouth_area.png`（原图 x ∈ [150,1300], y ∈ [120,420]）：
- 上端是一条**浅灰石质围挡**（分段板块，有竖直接缝），左右各延伸一段
- 围挡中间**断开**，断口处是**绿色草坪直接延伸出去**（那就是球门口）
- 断口左右两侧各有一组**金属盘绕弹簧**（即 §2 的四角弹簧，与上方围挡同款，斜插在围挡端头）
- 围挡**外侧**是黄绿色灌木 + 蓝紫色看台立柱 + 红色小旗
- 围挡**上表面**有淡淡的高光

### 4.2 ★ 球门口宽度的实测（重要，直接影响 T3 决策）
| 口径 | 数值 | 说明 |
|---|---|---|
| 原图 1.5.5 底图实测开口 | **约 350–380 px** | 多次不同阈值扫描，稳定落在 350~380 区间 |
| 占可玩区（956px）比例 | **约 37% ~ 40%** | |
| 现行 `geometry.goalWidth = 2.05 m` | **34.2%** 场宽 | 来自宣传图 `taptap_original_3.jpg` 量测 |
| `prototype_settings.json` 建议 `goal_width_units = 0.28` | 28% ≈ 1.68 m | 材料包标注"是建议值不是原版值" |
| **安安已拍板（D1）** | **1.68 m** | 见 `runs/DECISIONS.md` |

> ⚠️ **所以底图自带的开口（~38%）比物理开口（1.68m = 28%）大**。
> 接入底图时**不能**让底图的开口当碰撞依据 —— 物理以 `geometry.goalWidth` 为准。
> **画法**：底图上的围挡照贴，但**球门网区用程序化画**（净空按 1.68m 算），覆盖在底图开口上。
> 否则会出现「球从门口旁边的墙上穿过去」的视觉穿帮。
>
> 备选（更简单、更稳）：**底图只取可玩区内部（不含球门围挡）**，球门区完全程序化重画。
> → **推荐这条**，冲突最小。

### 4.3 ★ 关于 `Goal_00..03.png` 的真相（别被文件名骗了）
```
materials/.../original_images/1.5.5/texture/Goal_00.png  1054x203  调色板模式
                                              Goal_01.png  1054x203
                                              Goal_02.png  1054x203  RGBA
                                              Goal_03.png  1054x203
```
目视 `runs/_diag/goal_sprites_white.png`（4 张叠白底）：它们是**一条横贯的圆角护栏/围挡条**，
分别是 棕金渐变 / 红斜纹 / 蓝霓虹 / 灰色四种配色 —— **是球场边墙的贴图，不是球门框**。
（另有 `selected_sprites/1.5.5/Goal_01.png` 和 `Goal_03.png` 同尺寸。）

### 4.4 施工步骤
1. **球门网 + 门框程序化重画**，但改成原版观感：
   - 门框：白色石质（`#f2f2f0`），**带竖直接缝**（每 ~1/6 门宽一条），有顶面高光
   - 门柱端头：与 §2 弹簧同款的**金属盘簧**（画在门柱外侧）
   - 网：原版底图**看不到网**（缺口直接通到外面灌木）→ 建议**弱化或去掉网**，
     或保留极淡的网（当前 `sk.net = rgba(255,255,255,0.85)` 偏重，视觉上比原版"实"很多）
   - 门框**开口宽度 = `geometry.goalWidth`**（1.68 m），这是硬约束
2. `data/fields.json` 的 `skins[].goalFrame` / `net` 配色按原版调整。
3. `render.ts` `drawGoalFronts()` 的门柱圆点（现在是 `goalFrame` 色圆 + 描边）→ 改成原版的弹簧端头造型。
4. **物理不动**（1.68m 由 T3-a 负责，本任务只在 T3-a 完成后做视觉层）

### 4.5 验收
- 球门开口视觉宽度与物理 1.68m 一致（球不会"穿过门框"）
- 门框有原版的石质分段感 + 端头弹簧
- 进球判定与 `test:physics` 全部保持绿

---

## 5. 游戏 UI 重做

### 5.1 ★ 素材来源（已实测，坑已修）
UI 切片在 `sprite_frames.json` 里，但**`texture_file` 字段对 UI 类切片是错的**：
`Btn_02` 标注来源 `texture/ID_14.png`（实际只有 844x284），而它的 `rect=[1151,1995,44,44]`
的 y=1995 **远超图片高度** —— 真正的来源是同 UUID 的 `atlas/Skin.png`（**2048x2048 RGBA**）。

**已写好修复版工具**（不要重写）：
```bash
python art/extract_atlas.py --version 1.5.5 --list-sources          # 看每个切片的真实来源
python art/extract_atlas.py --version 1.5.5 --out client/public/assets/orig_atlas
python art/extract_atlas.py --version 1.5.5 --names Btn_02,Box_Select --out runs/_diag
```
规则：按 `texture`(UUID) → `image_inventory.json` 找候选 → **选尺寸 ≥ rect 右下角的那个**（通常在 `atlas/` 下），
`texture_file` 只当候选之一校验。`rotated=1` 表示切片在图集里转过 90°，切出后要 `-90°` 转回来。

### 5.2 已验证可用的 UI 切片（已实切并目视确认）
来自 `atlas/Skin.png`（2048x2048 RGBA），实测切出 17/17 成功：
| 名称 | 尺寸 | 目视 |
|---|---|---|
| `Btn_00` ~ `Btn_05` | 44x44 | 小圆角方块按钮（橙 / 蓝 / 绿等彩色） |
| `Btn_06` | 80x80 | 绿色立体信息按钮（带白色 "i"） |
| `Btn_Box2_00` | 88x88 | 绿色发光圆角框（选中态按钮底） |
| `Box_00` | 8x8 | 白色小圆角块 |
| `Box_01` | 38x38 | 白色圆角方块 |
| `Box_02` | 70x70 | 白色圆角方块（大） |
| `Box_Select` | 100x100 | 蓝色发光圆（选中光圈） |
| `Tab_05` | 94x80 | 白色标签页（带下方折角） |
| `Tab_06` | 62x48 | 小标签页 |
| `Windos_TipsBox` | 229x212 | 灰色圆角提示框（内含白色输入条） |
| `TeamLogo_default` | 223x222 | 虚线框（空队徽占位） |
| `Black_Translucent_Bottom` | 50x50 | 黑色半透明渐变（底部遮罩） |

其他可用图集：
| 图集 | 尺寸 | 内容 |
|---|---|---|
| `atlas/Badge.png` | 2048x2048 | **66 个俱乐部徽章** `badge_icon_XXXX` |
| `atlas/skillIcon.png` | 2048x2048 | **83 个技能图标** `skill_XXX_XXXX` |
| `atlas/PlayerSkin.png` | 1024x1024 | 34 个球员皮肤/ID 图标 |
| `atlas/ShopIcon.png` | 1024x2048 | 44 个商店图标（钻石、礼包、球员卡） |
| `02_players_and_data/source_atlases/1_5_5/head.png` | 1024x1024 | 37 个：**原版角色头部渲染**（男/女写实风）、品质框 `Box_Quality_01..09`、表情 `Expression_01..03`、球衣 `shirt_XXXX` |
| `texture/Goal_00..03.png` | 1054x203 | 边墙护栏条（4 配色），见 §4.3 |
| `texture/ballBg.png` | 64x64 | 球的圆形底衬 |
| `texture/football.png` | 128x128 | ⚠️ **是展开的纹理图不是渲染好的球，不能直接当球用** |
| `texture/Guide_Quan.png` | 128x128 | 瞄准辅助圈 |
| `texture/Logo_zh.png` | 560x260 | 中文 Logo |
| `texture/Background.jpg` | 1242x1920 | 大厅背景 |
| `texture/UpgradingBg.png` | 1080x259 | 升级界面横幅 |

### 5.3 施工步骤
1. 批量切出需要的切片 → `client/public/assets/orig_atlas/`
2. 重做大厅（`client/src/style.css` + `main.ts`）：
   - Logo 用 `Logo_zh.png`
   - 按钮用 `Btn_0X` 系列 + `Btn_Box2_00` 作底
   - 面板/分组用 `Box_0X` / `Windos_TipsBox`
   - 队伍徽章用 `Badge.png` 切出的 `badge_icon_*`（按 `player_portrait_mapping.csv` 的 `club_cn` 匹配）
   - 大厅背景用 `Background.jpg`
3. 重做 HUD（`style.css` 的 `.hud-top` / `.hud-bottom` / `.turn` / `.timer` / `.shots`）：
   - 回合提示用 `Tab_05` / `Tab_06` 造型
   - 选中/激活态用 `Box_Select` 蓝色光圈
   - 品质框用 `head.png` 的 `Box_Quality_0X`
4. 技能图标：T4-c 的技能数据入库后，把 `skillIcon.png` 切出的 `skill_*` 与技能 id 对接
   （`skill_records.json` 里的技能 id 与 `skill_XXX_XXXX` 命名规则的对应关系**需要先查清**，查不清就标 `pending-confirmation`）
5. **保留所有现有交互逻辑**，只换视觉。`main.ts` 的 DOM 结构可小改，但**不要改功能**。

### 5.4 验收
- 大厅与 HUD 换上了原版 UI 素材，不再是纯 CSS 圆角块
- 所有按钮仍可点、功能不变
- 移动端不溢出（T2-d 未做前，至少保证窄屏不破版）
- `test:e2e` 7/7 与 `online-e2e` 全绿（UI 改动不能弄坏联机流程）

---

## 6. 素材与工具速查

| 需要什么 | 在哪 |
|---|---|
| 全部原版美术 | `materials/pengzhuang_rebuild/03_art/` |
| 原版头像 107 张 | `materials/pengzhuang_rebuild/02_players_and_data/portraits/1.5.5/` |
| 头像 ↔ 球员映射 | `materials/.../earlier_exports/player_portrait_mapping.csv`（表头含 BOM，用 `utf-8-sig`） |
| 切片坐标 | `materials/pengzhuang_rebuild/03_art/sprite_frames.json`（1.2.0: 696 条 / 1.5.5: 885 条） |
| 图集真实文件 + 尺寸 + SHA | `materials/pengzhuang_rebuild/03_art/image_inventory.json`（90 条） |
| 切图工具（已修坑） | `art/extract_atlas.py` |
| 绿幕抠图 | `art/chromakey.py` |
| 头像构建 / 圆形遮罩 | `art/avatar.py` |
| 宫格切分 | `art/split_grid.py` / `art/split_heads.py` |
| 官方截图（目视参考） | `materials/.../01_game_research/assets/`（19 张） |
| 参考图 | `materials/.../01_game_research/references/`（10 张，含 `taptap_original_*.jpg`） |
| 联系表（批量核对头像） | `materials/.../02_players_and_data/contact_sheets/players_001_024.jpg` … `players_097_106.jpg` |
| **本次实拍诊断图** | `runs/_diag/`（`c_tl/c_tr/c_br/c_bl.png` 四角、`goal_top.png`、`goal_mouth_area.png`、`goal_ruler*.png`、`ui_sheet.png`、`atlas_head_half.png`） |

### ⚠️ 已知坑
1. **`texture_file` 不可信** → 用 `art/extract_atlas.py`（已修）。
2. **`rect` 可能是字符串** `"[1054, 854, 140, 160]"` → 工具里已做 `parse_rect` 兼容。
3. **`rotated=1`** → 切完要 `-90°` 转回来。
4. **底图纵向 / 项目横向** → 必须旋转 90°。
5. **底图开口 ~38% vs 物理 28%** → 球门区程序化重画，或底图只取可玩区内部。
6. **`portrait_mapping.csv` 有 BOM** → `encoding="utf-8-sig"`。
7. **PNG 调色板模式**（`P`）→ PIL 打开后要 `.convert("RGBA")`。
8. **沙箱 safe-delete 守卫** → 删 `dist/client` 会被拦，改名而非删除。
9. **PowerShell 吞 stdout** → 结果写临时文件再读；`python -c` 内联多引号易炸 → 写 `.py` 脚本执行。
10. **PIL 只在托管环境**：`C:\Users\31168\.workbuddy\binaries\python\envs\default\Scripts\python.exe`
    （系统 python 没装 Pillow）。
