"""美术风格对比样例：原版素材 vs 当前项目资产。

只写 runs/_diag/，不碰 client/public，避免和 AR 阶段施工冲突。

对每个示例球员输出四栏：
  1) 原版 1.5.5 头像原图（materials/.../portraits/1.5.5/head_*.png，194x188 带 alpha）
  2) 原版头像按 alpha 内容框裁切 → 圆形遮罩（AR-3 完成后的实际显示效果）
  3) 当前项目资产 client/public/assets/players/pNN_avatar.png（256x256 圆形）
  4) 场上圆盘模拟（render.ts 的白边 + 队伍色环 + 头像裁切逻辑）

用法：
    python art/preview_style.py            # 默认三个示例球员
    python art/preview_style.py p01 p02    # 指定 id
"""
import csv
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from avatar import make_original_disc  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'runs', '_diag')

PORTRAIT_DIR = os.path.join(
    ROOT, 'materials', 'pengzhuang_rebuild', '02_players_and_data', 'portraits', '1.5.5')
CSV_PATH = os.path.join(
    ROOT, 'materials', 'pengzhuang_rebuild', '02_players_and_data',
    'earlier_exports', 'player_portrait_mapping.csv')
PLAYERS_JSON = os.path.join(ROOT, 'data', 'players.json')
CUR_ASSETS = os.path.join(ROOT, 'client', 'public', 'assets', 'players')

FONT_CANDIDATES = [
    'C:/Windows/Fonts/msyhbd.ttc',
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/simhei.ttf',
]

TEAM_COLORS = {'A': '#e04b3c', 'B': '#2f6fd0'}
TEAM_DARK = {'A': '#a12f22', 'B': '#1d4a92'}

CELL = 200          # 单格边长
LABEL_H = 46        # 标签高度
GAP = 18
BG = '#10161d'
FG = '#e8eef5'
SUB = '#8fa3b5'


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
    return ImageFont.load_default()


def circular_mask(size):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
    return m


def fit_into(src, size, pad_ratio=0.0):
    """等比缩放并居中放进 size 正方形。pad_ratio>0 时再留白边。"""
    inner = int(size * (1 - 2 * pad_ratio))
    w, h = src.size
    scale = inner / max(w, h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    r = src.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(r, ((size - nw) // 2, (size - nh) // 2), r)
    return canvas


def original_circle(path, size):
    """原版头像 → alpha 内容框裁切 → 圆形遮罩。与运行时导入同一函数。"""
    return make_original_disc(Image.open(path).convert('RGBA'), size)


def current_circle(path, size):
    """当前项目头像已是 256x256 圆形，直接缩放。"""
    im = Image.open(path).convert('RGBA')
    out = im.resize((size, size), Image.LANCZOS)
    out.putalpha(Image.composite(out.getchannel('A'), Image.new('L', (size, size), 0),
                                  circular_mask(size)))
    return out


def disc_sim(face, size, side='A'):
    """模拟 render.ts 的球员圆盘：白边 + 队伍色环 + 头像圆形裁切。"""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    rim = size // 2
    d.ellipse((2, 2, size - 3, size - 3), fill='#f2f6f9', outline='#b9c3cc', width=2)
    inner = int(rim * 0.88)
    d.ellipse((rim - inner, rim - inner, rim + inner, rim + inner),
              fill=TEAM_COLORS[side], outline=TEAM_DARK[side], width=2)
    ir = int(rim * 0.74)
    face = fit_into(face, ir * 2)
    mask = Image.new('L', (ir * 2, ir * 2), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, ir * 2 - 1, ir * 2 - 1), fill=255)
    im.paste(face, (rim - ir, rim - ir), mask)
    return im


def main():
    ids = sys.argv[1:] or ['p01', 'p02', 'p03']
    os.makedirs(OUT_DIR, exist_ok=True)

    with open(CSV_PATH, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    by_player_id = {r['player_id']: r for r in rows}

    players = json.load(open(PLAYERS_JSON, encoding='utf-8'))['players']
    by_id = {p['id']: p for p in players}

    cols = ['① 原版原图', '② 原版→圆形遮罩', '③ 当前重绘资产', '④ 场上圆盘(用②)']
    rows_out = []

    for pid in ids:
        p = by_id.get(pid)
        if not p:
            print('skip', pid, '(not in players.json)')
            continue
        src_id = p.get('srcId')
        row = by_player_id.get(str(src_id))
        if not row:
            print('skip', pid, '(no srcId mapping)')
            continue
        portrait_id = row['portrait_id']
        orig_path = os.path.join(PORTRAIT_DIR, f'{portrait_id}.png')
        cur_path = os.path.join(CUR_ASSETS, f'{pid}_avatar.png')
        if not os.path.exists(orig_path) or not os.path.exists(cur_path):
            print('skip', pid, '(missing asset)', orig_path, cur_path)
            continue
        rows_out.append({
            'pid': pid,
            'name': p['name'],
            'real': row['real_name_english'],
            'club': row['club_cn'],
            'orig': Image.open(orig_path).convert('RGBA'),
            'orig_circle': original_circle(orig_path, CELL),
            'cur': current_circle(cur_path, CELL),
            'cur_full': os.path.join(CUR_ASSETS, f'{pid}_full.png'),
        })

    if not rows_out:
        print('nothing to render')
        return

    n_cols = len(cols)
    width = GAP + n_cols * (CELL + GAP)
    head_h = 104
    height = head_h + LABEL_H + len(rows_out) * (CELL + GAP + 34) + GAP

    sheet = Image.new('RGBA', (width, height), BG)
    d = ImageDraw.Draw(sheet)
    f_title = load_font(28)
    f_col = load_font(17)
    f_name = load_font(23)
    f_sub = load_font(15)

    d.text((GAP, 16), '美术风格对照：原版《碰撞全明星》素材 vs 当前复刻资产',
           font=f_title, fill=FG)
    d.text((GAP, 52), 'AR-1 球场底图已 100% 用原图；球员头像（AR-3）目标同样是原版，'
                       '当前显示的仍是 AI/手绘 Q 版重绘', font=f_sub, fill=SUB)

    col_x = [GAP + i * (CELL + GAP) for i in range(n_cols)]
    for i, c in enumerate(cols):
        d.text((col_x[i], head_h - 30), c, font=f_col, fill=SUB)

    y = head_h + LABEL_H
    for r in rows_out:
        d.text((GAP, y - 52), f"{r['pid']}  {r['name']}", font=f_name, fill=FG)
        d.text((GAP, y - 26), f"{r['real']} · {r['club']}", font=f_sub, fill=SUB)

        orig = fit_into(r['orig'], CELL)
        sheet.alpha_composite(orig, (col_x[0], y))
        sheet.alpha_composite(r['orig_circle'], (col_x[1], y))
        sheet.alpha_composite(r['cur'], (col_x[2], y))
        sheet.alpha_composite(disc_sim(r['orig_circle'], CELL, 'A'), (col_x[3], y))
        y += CELL + GAP + 34

    out = os.path.join(OUT_DIR, 'style_compare.png')
    sheet.convert('RGB').save(out, quality=95)
    print('wrote', out)
    for r in rows_out:
        print(' ', r['pid'], r['name'], r['real'], '| 原版', r['orig'].size)


if __name__ == '__main__':
    main()
