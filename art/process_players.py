"""Cut out raw character renders and produce in-game player assets.

Outputs (client/public/assets/players/):
  {id}_full.png    512x640 transparent cutout, bottom-aligned (card art / detail)
  {id}_avatar.png  256x256 circular head crop, transparent outside circle (match discs, lists)
Also writes art/contact_sheet.png for visual review.
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, 'raw')
CUT = os.path.join(ROOT, 'cutout')
OUT = os.path.join(ROOT, '..', 'client', 'public', 'assets', 'players')
os.makedirs(CUT, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

# Per-image manual nudges for the head crop: (dx, dy, scale) in raw pixels.
HEAD_TWEAK = {
    'p03': (0, 10, 1.0),
    'p08': (0, 0, 1.12),
    'p12': (10, 0, 1.05),
    'p14': (0, 0, 1.08),
    'p16': (0, 10, 1.05),
}


def cutout(name):
    dst = os.path.join(CUT, name + '.png')
    if os.path.exists(dst):
        return Image.open(dst).convert('RGBA')
    from rembg import remove, new_session
    global _session
    if '_session' not in globals():
        _session = new_session('isnet-general-use')
    im = Image.open(os.path.join(RAW, name + '.jpg')).convert('RGB')
    res = remove(im, session=_session, post_process_mask=True)
    res.save(dst)
    return res


def head_box(alpha, name):
    h, w = alpha.shape
    rows = np.where(alpha.max(axis=1) > 128)[0]
    top = int(rows[0])
    band = alpha[top:top + 330] > 128
    ys, xs = np.nonzero(band)
    cx = float(xs.mean())
    side = 450.0
    dx, dy, sc = HEAD_TWEAK.get(name, (0, 0, 1.0))
    side *= sc
    cy = top + side * 0.5 - 8 + dy
    cx += dx
    return cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2


def make_avatar(rgba, name):
    a = np.array(rgba)[:, :, 3]
    box = tuple(int(round(v)) for v in head_box(a, name))
    # paste over a soft backdrop so the circle reads on any pitch colour
    crop = rgba.crop(box).resize((256, 256), Image.LANCZOS)
    bg = Image.new('RGBA', (256, 256))
    grad = Image.new('L', (256, 256))
    gd = ImageDraw.Draw(grad)
    for r in range(128, 0, -1):
        gd.ellipse((128 - r, 128 - r, 128 + r, 128 + r), fill=int(255 - (128 - r) * 0.7))
    sky = Image.new('RGBA', (256, 256), (214, 236, 250, 255))
    deep = Image.new('RGBA', (256, 256), (120, 175, 220, 255))
    bg = Image.composite(sky, deep, grad)
    bg.alpha_composite(crop)
    mask = Image.new('L', (1024, 1024), 0)
    ImageDraw.Draw(mask).ellipse((8, 8, 1016, 1016), fill=255)
    mask = mask.resize((256, 256), Image.LANCZOS)
    out = Image.new('RGBA', (256, 256))
    out.paste(bg, (0, 0), mask)
    out.save(os.path.join(OUT, name + '_avatar.png'))
    return out


def make_full(rgba, name):
    a = np.array(rgba)[:, :, 3]
    ys, xs = np.nonzero(a > 10)
    crop = rgba.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    W, H = 512, 640
    s = min((W - 16) / crop.width, (H - 8) / crop.height)
    crop = crop.resize((max(1, int(crop.width * s)), max(1, int(crop.height * s))), Image.LANCZOS)
    out = Image.new('RGBA', (W, H))
    out.alpha_composite(crop, ((W - crop.width) // 2, H - crop.height))
    out.save(os.path.join(OUT, name + '_full.png'))
    return out


def main():
    names = sorted(f[:-4] for f in os.listdir(RAW) if f.endswith('.jpg'))
    if len(sys.argv) > 1:
        names = [n for n in names if n in sys.argv[1:]]
    avatars, fulls = [], []
    for n in names:
        rgba = cutout(n)
        avatars.append(make_avatar(rgba, n))
        fulls.append(make_full(rgba, n))
        print('ok', n)
    cols = 8
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * 140, rows * (140 + 180)), (40, 120, 60, 255))
    for i, (av, fu) in enumerate(zip(avatars, fulls)):
        x, y = (i % cols) * 140, (i // cols) * 320
        sheet.alpha_composite(av.resize((128, 128), Image.LANCZOS), (x + 6, y + 6))
        sheet.alpha_composite(av.resize((40, 40), Image.LANCZOS), (x + 6, y + 136))
        sheet.alpha_composite(fu.resize((128, 160), Image.LANCZOS), (x + 6, y + 150))
    sheet.save(os.path.join(ROOT, 'contact_sheet.png'))


if __name__ == '__main__':
    main()
