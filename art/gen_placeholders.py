"""Generate placeholder badges for every player that has no real cutout art yet.

Real art (art/raw -> art/cutout -> client/public/assets/players) always wins:
this script skips any player whose _avatar.png already exists, so it can be
re-run at any time without clobbering hand-made or generated assets.

Outputs (client/public/assets/players/):
  {id}_avatar.png   256x256 RGBA, circular badge, transparent outside
  {id}_full.png     512x640 RGBA, card face with the five attributes

Badge design: position-coloured disc, quality-coloured outer ring, rarity glow,
and the player's Chinese name in the middle. It reads clearly at the small size
the match view uses (a disc roughly 40px across), which a generic grey blob
does not.
"""
import io
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'players.json')
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'players')

FONT_CANDIDATES = [
    'C:/Windows/Fonts/msyhbd.ttc',
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/Dengb.ttf',
]

POSITION_COLORS = {
    'GK': (139, 92, 246),
    'DF': (59, 130, 246),
    'MF': (16, 185, 129),
    'FW': (249, 115, 22),
}
DEFAULT_POSITION = (100, 116, 139)

QUALITY_COLORS = {
    'blue': (59, 130, 246),
    'green': (34, 197, 94),
    'purple': (168, 85, 247),
    'orange': (249, 115, 22),
    'white': (226, 232, 240),
}
DEFAULT_QUALITY = (148, 163, 184)

RARITY_GLOW = {
    1: (203, 213, 225),
    2: (203, 213, 225),
    3: (96, 165, 250),
    4: (167, 139, 250),
    5: (251, 191, 36),
    9: (244, 114, 182),
}

ATTR_LABELS = ['WT', 'PO', 'CV', 'AC', 'ME']


def load_font(size, index=0):
    """Loads the first Chinese-capable font that exists on this machine."""
    for i in range(index, len(FONT_CANDIDATES)):
        path = FONT_CANDIDATES[i]
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def radial_gradient(size, inner, outer):
    """Builds a radial gradient RGB image, brightest in the centre."""
    small = 64
    grad = Image.new('RGB', (small, small))
    px = grad.load()
    cx = cy = (small - 1) / 2.0
    maxd = (small - 1) / 2.0
    for y in range(small):
        for x in range(small):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / maxd
            d = min(1.0, d)
            px[x, y] = tuple(int(inner[i] + (outer[i] - inner[i]) * d) for i in range(3))
    return grad.resize((size, size), Image.LANCZOS)


def circle_mask(size):
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def fit_text(draw, text, font_path, max_size, max_w, max_h):
    """Shrinks the font until the text fits inside the given box."""
    for size in range(max_size, 15, -2):
        font = load_font(size, font_path)
        box = draw.textbbox((0, 0), text, font=font)
        if box[2] - box[0] <= max_w and box[3] - box[1] <= max_h:
            return font
    return load_font(16, font_path)


def label_for(name):
    """Two characters for Chinese names, up to two words for latin names."""
    name = (name or '').strip()
    if not name:
        return '?'
    if name[0].isascii():
        parts = name.split()
        if len(parts) >= 2:
            return (parts[0][0] + parts[-1][0]).upper()
        return name[:2].upper()
    return name[:2]


def make_avatar(player, size=256):
    """Circular badge: position disc, quality ring, rarity glow, name in the middle."""
    pos = POSITION_COLORS.get(player.get('position'), DEFAULT_POSITION)
    qual = QUALITY_COLORS.get(player.get('quality'), DEFAULT_QUALITY)
    rarity = player.get('rarity') or 3
    glow = RARITY_GLOW.get(rarity, RARITY_GLOW[3])

    inner = tuple(min(255, int(c * 0.35 + 90)) for c in pos)
    base = radial_gradient(size, inner, tuple(int(c * 0.55) for c in pos)).convert('RGBA')

    # Rarity glow: a soft halo bleeding outside the disc.
    halo = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    hd.ellipse((6, 6, size - 7, size - 7), fill=glow + (110,))
    halo = halo.filter(ImageFilter.GaussianBlur(14))
    base = Image.alpha_composite(halo, base)

    disc = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    dd = ImageDraw.Draw(disc)
    pad = 16
    dd.ellipse((pad, pad, size - pad - 1, size - pad - 1), fill=pos + (255,))
    base = Image.alpha_composite(base, disc)

    # Quality ring.
    ring = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    rd.ellipse((pad, pad, size - pad - 1, size - pad - 1), outline=qual + (255,), width=9)
    base = Image.alpha_composite(base, ring)

    draw = ImageDraw.Draw(base)
    text = label_for(player.get('name'))
    font = fit_text(draw, text, 0, 120, 150, 120)
    box = draw.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    draw.text(
        ((size - tw) / 2 - box[0], (size - th) / 2 - box[1] - 4),
        text,
        font=font,
        fill=(255, 255, 255, 255),
        stroke_width=5,
        stroke_fill=(0, 0, 0, 150),
    )

    # Rarity pips along the bottom of the disc.
    if rarity:
        pip_r = 5
        total = rarity if rarity <= 5 else 5
        gap = 13
        start = size / 2 - (total - 1) * gap / 2
        py = size - pad - 20
        for i in range(total):
            px = start + i * gap
            draw.ellipse((px - pip_r, py - pip_r, px + pip_r, py + pip_r), fill=glow + (255,))

    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(base, (0, 0), circle_mask(size))
    return out


def make_full(player, w=512, h=640):
    """Card face: name plate, big label, and the five attribute bars."""
    pos = POSITION_COLORS.get(player.get('position'), DEFAULT_POSITION)
    qual = QUALITY_COLORS.get(player.get('quality'), DEFAULT_QUALITY)

    card = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)

    # Card body with a vertical gradient.
    grad = Image.new('RGB', (w, h))
    gp = grad.load()
    top = tuple(int(c * 0.55) for c in pos)
    bot = tuple(int(c * 0.22 + 18) for c in pos)
    for y in range(h):
        t = y / float(h - 1)
        for x in range(w):
            gp[x, y] = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
    card = Image.alpha_composite(card, grad.convert('RGBA'))
    mask = Image.new('L', (w * 2, h * 2), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w * 2 - 1, h * 2 - 1), radius=72, fill=255)
    card.putalpha(mask.resize((w, h), Image.LANCZOS))

    d = ImageDraw.Draw(card)
    d.rounded_rectangle((0, 0, w - 1, 10), radius=5, fill=qual + (255,))

    name = (player.get('name') or '?').strip()
    d.text((28, 26), name[:8], font=load_font(40), fill=(255, 255, 255, 255))

    # Big badge in the middle.
    badge = make_avatar(player, 256)
    card.alpha_composite(badge, ((w - 256) // 2, 88))

    attrs = player.get('attrs') or [50, 50, 50, 50, 50]
    bar_x, bar_w = 28, w - 56
    for i, (lab, val) in enumerate(zip(ATTR_LABELS, attrs)):
        y = 380 + i * 44
        d.text((bar_x, y - 4), lab, font=load_font(24), fill=(255, 255, 255, 210))
        d.rounded_rectangle((bar_x + 56, y, bar_x + bar_w, y + 20), radius=10, fill=(0, 0, 0, 90))
        ratio = max(0.0, min(1.0, (float(val) - 40) / 59.0))
        d.rounded_rectangle(
            (bar_x + 56, y, bar_x + 56 + int((bar_w - 56) * ratio), y + 20),
            radius=10,
            fill=qual + (255,),
        )

    pos_label = {'GK': 'GK', 'DF': 'DEF', 'MF': 'MID', 'FW': 'FWD'}.get(player.get('position'), '—')
    d.text((w - 96, 30), pos_label, font=load_font(32), fill=(255, 255, 255, 230))
    return card


def main():
    with io.open(DATA, encoding='utf-8') as fh:
        data = json.load(fh)
    players = data.get('players') if isinstance(data, dict) else data
    if not players:
        print('no players found in data/players.json')
        return 1

    os.makedirs(OUT, exist_ok=True)
    map_path = os.path.join(ROOT, 'data', 'portrait_map.json')
    original_ids = set()
    if os.path.exists(map_path):
        original_ids = {e['id'] for e in json.load(io.open(map_path, encoding='utf-8')).get('entries', [])}
    made = 0
    skipped = 0
    for p in players:
        pid = p.get('id')
        if not pid:
            continue
        # Original head icons replaced these. Regenerating them would put the Q版 back.
        if pid in original_ids:
            skipped += 1
            continue
        avatar_path = os.path.join(OUT, '%s_avatar.png' % pid)
        full_path = os.path.join(OUT, '%s_full.png' % pid)
        if os.path.exists(avatar_path) and os.path.exists(full_path):
            skipped += 1
            continue
        make_avatar(p).save(avatar_path)
        make_full(p).save(full_path)
        made += 1

    print('players=%d generated=%d kept_existing=%d' % (len(players), made, skipped))
    print('out=%s' % OUT)
    return 0


if __name__ == '__main__':
    sys.exit(main())
