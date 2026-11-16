# 美术资产管线

场上的球员圆盘、名单里的头像，都来自 `client/public/assets/players/{id}_avatar.png`。
这份文档说明这些图是怎么来的，以及将来要加新人时怎么走一遍。

## 现状

| 范围 | 来源 | 说明 |
|---|---|---|
| p01 – p16 | 手绘原图 | `art/raw/*.jpg` → 抠图 → `art/cutout/*.png` → 头像/全身 |
| p17 – p117 | AI 生成 | 12 张 3×3 宫格 → 切分 → 抠绿 → 圆形头像 |
| 任意缺失者 | 程序化徽章 | `art/gen_placeholders.py`，永远能补齐，绝不留灰饼 |

游戏里只用到 `_avatar.png`（256×256 圆形，透明外圈）。`_full.png` 目前没有任何代码引用，
保留只是为了将来做卡面时不必重跑。

## AI 路线（推荐用于新增球员）

### 1. 出 prompt

```bash
python art/gen_prompts.py
```

读 `data/players.json` 的 name / position / quality，为尚未有 AI 头像的球员生成
外观描述，写到 `art/ai/prompts/gNN.txt`，并把"哪张宫格对应哪些球员"记到
`art/ai/plan.json`。外观特征按 `position` 决定球衣、按 `quality`/`rarity` 决定配色，
脸部特征（发型、肤色、胡子、眼镜）从固定池子里按 id 确定性抽取，所以同一个
id 每次生成的结果描述都一样，但 101 个人彼此不同。

### 2. 生成宫格

把 `art/ai/prompts/gNN.txt` 的内容原样丢给图像模型，尺寸 2048×2048。
一张图出 9 个角色，101 个人只要 12 次调用（逐个生成要 101 次）。

要求模型输出：3×3 等分格、每格一张**头肩特写**、脸部居中填满格子、
纯绿 (#00FF00) 背景、格间细白线、不要文字和水印。

生成完把图片按顺序命名成 `art/ai/grid/g01.png` … `g12.png`。

### 3. 切分抠图

```bash
python art/split_heads.py g01:p17,p18,p19,p20,p21,p22,p23,p24,p25
```

格子边界不是按固定比例切的，而是**检测模型画的白色分隔线**再切——按固定比例
切会把顶到格子边缘的角色削掉头顶。分隔线和最外层的白色边框会先被涂回绿色，
否则白边会混进第一个和最后一个格子。

抠绿用纯 Pillow 的 chroma-key（绿通道高于红蓝即为背景），不依赖神经网络，
所以不需要 rembg / onnxruntime。

最后头像会在正方形里留 24% 边距再套圆形遮罩，否则头顶会被圆形切出一条硬边。

### 4. 兜底

```bash
npm run build:avatars
```

给任何还没有头像的球员生成一个程序化徽章（位置色圆盘 + 品质色环 + 稀有度点 +
姓名文字）。它永远不会覆盖已有文件，所以可以随时跑，用来保证"没人是灰饼"。

## 环境

脚本用托管的 Python 环境（Pillow + numpy）：

```
C:\Users\31168\.workbuddy\binaries\python\envs\default\Scripts\python.exe
```

`rembg` 在这个环境里没有装。AI 路线本来也不需要它（绿幕是纯色，chroma-key 更准），
只有 `art/process_players.py`（处理手绘原图）依赖 rembg。

## 目录

```
art/
  raw/            手绘原图 p01-p16
  cutout/         手绘抠图结果
  process_players.py  原图 → avatar/full（依赖 rembg）
  gen_placeholders.py 程序化徽章兜底
  gen_prompts.py  生成 AI 宫格 prompt
  chromakey.py    绿幕抠图 + 去水印
  avatar.py       头像/全身的共用构造
  split_heads.py  宫格 → 圆形头像
  ai/
    prompts/      gNN.txt 宫格 prompt
    grid/         gNN.png 生成的宫格图
    plan.json     宫格 → 球员 id 映射
```
