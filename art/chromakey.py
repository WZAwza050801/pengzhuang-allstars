"""Chroma-key AI renders into in-game assets.

Takes the AI-generated full-body renders (art/ai/raw/*.png, flat green
background) and produces the same two files the hand-made pipeline produces:

  client/public/assets/players/{id}_avatar.png   256x256 circular head crop
  client/public/assets/players/{id}_full.png     512x640 transparent cutout

Green is removed with a plain chroma-key pass instead of a neural segmenter:
the AI renders use a flat #00FF00 background, so the key is unambiguous and
this keeps the pipeline dependency-free (Pillow only).

Usage:
  python art/chromakey.py            # process everything in art/ai/raw
  python art/chromakey.py p17 p35    # process only these ids
"""
import io
import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from avatar import make_avatar, make_full  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'players.json')
SRC = os.path.join(ROOT, 'art', 'ai', 'raw')
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'players')
CONTACT = os.path.join(ROOT, 'art', 'ai', 'contact_sheet.png')

FONT_CANDIDATES = [
    'C:/Windows/Fonts/msyhbd.ttc',
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/simhei.ttf',
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def chroma_key(im, tolerance=62):
    """Removes the flat green backdrop, keeping a soft edge.

    The AI renders use a slightly shaded green, so the key accepts a range
    rather than one exact colour: greenness is measured as how far the green
    channel sits above the red and blue channels.
    """
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if g > 70 and g > r + 30 and g > b + 30:
                d = g - max(r, b)
                if d >= tolerance:
                    px[x, y] = (r, g, b, 0)
                else:
                    px[x, y] = (r, g, b, int(255 * (1.0 - float(d) / tolerance)))
    return im


def wipe_watermark(im):
    """Clears the generator watermark the AI burns into the bottom-right corner."""
    w, h = im.size
    box = (int(w * 0.80), int(h * 0.92), w, h)
    region = im.crop(box)
    # The watermark is light grey-white on green; after keying it survives, so
    # it is removed by dropping alpha where the pixel is near-neutral and bright.
    rp = region.load()
    rw, rh = region.size
    for y in range(rh):
        for x in range(rw):
            r, g, b, a = rp[x, y]
            if a and max(r, g, b) > 165 and max(r, g, b) - min(r, g, b) < 45:
                rp[x, y] = (r, g, b, 0)
    im.paste(region, box)
    return im


def trim(im):
    """Crops to the non-transparent bounding box."""
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def main():
    if not os.path.isdir(SRC):
        print('no source dir: %s' % SRC)
        return 1
    ids = sys.argv[1:]
    if not ids:
        ids = sorted(f[:-4] for f in os.listdir(SRC) if f.lower().endswith('.png'))
    os.makedirs(OUT, exist_ok=True)
    map_path = os.path.join(ROOT, 'data', 'portrait_map.json')
    original_ids = set()
    if os.path.exists(map_path):
        original_ids = {e['id'] for e in json.load(open(map_path, encoding='utf-8')).get('entries', [])}
    for pid in ids:
        if pid in original_ids:
            print('skip (original portrait): %s' % pid)
            continue
        src = os.path.join(SRC, pid + '.png')
        if not os.path.exists(src):
            print('skip (no source): %s' % pid)
            continue
        cut = chroma_key(Image.open(src))
        cut = trim(cut)
        make_avatar(cut).save(os.path.join(OUT, pid + '_avatar.png'))
        make_full(cut).save(os.path.join(OUT, pid + '_full.png'))
        print('ok %s' % pid)
    return 0


if __name__ == '__main__':
    sys.exit(main())
