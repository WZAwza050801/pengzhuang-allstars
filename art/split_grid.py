"""Splits AI 3x3 character sheets into individual in-game player assets.

One ImageGen call produces nine characters on a green background; this cuts
that sheet into nine, keys out the green, and writes the same avatar/full
pair the hand-made pipeline writes.

The head crop is not hard-coded per character: the alpha bounding box gives
the body extent, and the head is taken as the top slice of it, so characters
with different heights and hair still land correctly.

Usage:
  python art/split_grid.py g01:p18,p19,p20,p21,p22,p23,p24,p25,p26
"""
import io
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GRID_DIR = os.path.join(ROOT, 'art', 'ai', 'grid')
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'players')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from avatar import make_avatar, make_full  # noqa: E402
from chromakey import chroma_key, trim, wipe_watermark  # noqa: E402


def split_sheet(sheet, cols=3, rows=3, inset=9):
    """Yields the panels of a grid sheet in reading order.

    The panels are inset so the white divider lines the generator draws
    between them are not part of any panel.
    """
    w, h = sheet.size
    cw, ch = w // cols, h // rows
    for r in range(rows):
        for c in range(cols):
            x0 = c * cw + inset
            y0 = r * ch + inset
            x1 = (c + 1) * cw - inset
            y1 = (r + 1) * ch - inset
            yield sheet.crop((x0, y0, x1, y1))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    os.makedirs(OUT, exist_ok=True)
    for spec in sys.argv[1:]:
        name, _, ids = spec.partition(':')
        pids = [i for i in ids.split(',') if i]
        path = os.path.join(GRID_DIR, name + '.png')
        if not os.path.exists(path):
            print('skip (no sheet): %s' % path)
            continue
        sheet = Image.open(path).convert('RGB')
        panels = list(split_sheet(sheet))
        for idx, pid in enumerate(pids):
            if idx >= len(panels):
                break
            cut = chroma_key(panels[idx])
            cut = trim(cut)
            cut = wipe_watermark(cut)
            make_avatar(cut).save(os.path.join(OUT, pid + '_avatar.png'))
            make_full(cut).save(os.path.join(OUT, pid + '_full.png'))
            print('ok %s <- %s panel %d' % (pid, name, idx + 1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
