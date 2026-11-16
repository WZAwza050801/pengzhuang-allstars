"""Splits AI headshot sheets into circular in-game player avatars.

One ImageGen call produces nine character portraits on a green background.
Because the portraits are headshots with the face filling the panel, the
pipeline is just: cut the panel, key out the green, scale, mask to a circle.
No head detection is needed.

Two details matter for quality:

* The panels are located by detecting the white divider lines the generator
  draws between them, rather than by dividing the sheet into equal parts.
  Cutting at fixed offsets shaved the tops off characters that reach the
  edge of their cell.
* The portrait gets a small margin around it. Without one, a character whose
  hair touches the top of the panel ends up cut flat across the forehead by
  the circular mask.

Usage:
  python art/split_heads.py g01:p18,p19,p20
  python art/split_heads.py g12:2x2:p116,p117
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GRID_DIR = os.path.join(ROOT, 'art', 'ai', 'grid')
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'players')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chromakey import chroma_key, trim, wipe_watermark  # noqa: E402

SIZE = 256
MARGIN = 1.24


def circle_mask(size):
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def _divider_ratios(sheet):
    """Finds the rows and columns that are (almost) entirely white."""
    arr = np.array(sheet.convert('RGB'))
    white = (arr[:, :, 0] > 232) & (arr[:, :, 1] > 232) & (arr[:, :, 2] > 232)
    return white.mean(axis=1), white.mean(axis=0)


def _divider_bands(ratios, length, min_gap=40):
    """Groups the near-white rows into divider bands.

    Returns a list of (start, end) pairs, one per divider line. A band that
    touches the edge of the sheet is the outer frame of the grid, not a
    divider, so it is reported separately by the caller.
    """
    hits = np.where(ratios > 0.8)[0]
    bands = []
    for idx in hits:
        if bands and idx - bands[-1][-1] <= 3:
            bands[-1].append(idx)
        else:
            bands.append([idx])
    out = []
    for band in bands:
        start, end = int(band[0]), int(band[-1])
        if out and start - out[-1][1] < min_gap:
            continue
        out.append((start, end))
    return out


def _clean_white(sheet):
    """Paints the white divider lines and the outer frame back to green.

    The generator frames every sheet with a white border, and that border
    ends up inside the first and last panels if it is not removed.
    """
    arr = np.array(sheet.convert('RGB'))
    white = (arr[:, :, 0] > 225) & (arr[:, :, 1] > 225) & (arr[:, :, 2] > 225)
    rows = white.mean(axis=1) > 0.8
    cols = white.mean(axis=0) > 0.8
    arr[rows] = (0, 255, 0)
    arr[:, cols] = (0, 255, 0)
    return Image.fromarray(arr)


def split_sheet(sheet, cols=3, rows=3):
    """Yields the panels of a grid sheet in reading order.

    The panel boundaries are taken from the white divider lines, so nothing
    of the artwork is cut away.
    """
    w, h = sheet.size
    row_ratios, col_ratios = _divider_ratios(sheet)
    col_bands = _divider_bands(col_ratios, w)
    row_bands = _divider_bands(row_ratios, h)

    def edges(bands, length, axis):
        # A band at the very edge is the frame of the grid, not a divider.
        inner = list(bands)
        lead = 0
        tail = 0
        if inner and inner[0][0] <= 4:
            lead = inner.pop(0)[1]
        if inner and inner[-1][1] >= length - 4:
            tail = length - inner.pop()[0]
        starts = [lead] + [b[1] for b in inner]
        ends = [b[0] for b in inner] + [length - tail]
        return starts, ends

    x_starts, x_ends = edges(col_bands, w, 'x')
    y_starts, y_ends = edges(row_bands, h, 'y')

    # Fall back to an even split when no divider was detected.
    if len(x_starts) < cols:
        x_starts = [round(i * w / cols) for i in range(cols)]
        x_ends = x_starts[1:] + [w]
    if len(y_starts) < rows:
        y_starts = [round(i * h / rows) for i in range(rows)]
        y_ends = y_starts[1:] + [h]

    clean = _clean_white(sheet)
    for r in range(rows):
        for c in range(cols):
            if c >= len(x_starts) or r >= len(y_starts):
                continue
            yield clean.crop((x_starts[c], y_starts[r], x_ends[c], y_ends[r]))


def panel_to_avatar(panel, size=SIZE):
    """Keys the green out of one panel and masks it into a circle."""
    cut = trim(chroma_key(panel))
    cut = wipe_watermark(cut)
    if not cut.getbbox():
        return None
    w, h = cut.size
    side = int(max(w, h) * MARGIN)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.paste(cut, ((side - w) // 2, (side - h) // 2), cut)
    square = square.resize((size, size), Image.LANCZOS)

    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(square, (0, 0), square)
    out.putalpha(Image.composite(out.split()[3], Image.new('L', (size, size), 0), circle_mask(size)))
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    os.makedirs(OUT, exist_ok=True)
    for spec in sys.argv[1:]:
        # name[:ROWSxCOLS]:ids  — the grid shape is optional and defaults to 3x3.
        name, _, rest = spec.partition(':')
        rows, cols = 3, 3
        if 'x' in rest.split(':')[0]:
            shape, _, rest = rest.partition(':')
            rows, cols = (int(v) for v in shape.split('x'))
        pids = [i for i in rest.split(',') if i]
        path = os.path.join(GRID_DIR, name + '.png')
        if not os.path.exists(path):
            print('skip (no sheet): %s' % path)
            continue
        panels = list(split_sheet(Image.open(path).convert('RGB'), cols=cols, rows=rows))
        if len(panels) != rows * cols:
            print('warn %s: found %d panels, expected %d' % (name, len(panels), rows * cols))
        for idx, pid in enumerate(pids):
            if idx >= len(panels):
                break
            avatar = panel_to_avatar(panels[idx])
            if avatar is None:
                print('fail (empty panel): %s' % pid)
                continue
            avatar.save(os.path.join(OUT, pid + '_avatar.png'))
            print('ok %s <- %s panel %d' % (pid, name, idx + 1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
