"""Shared avatar/full card builders for the AI art pipeline.

Both the single-render path (art/chromakey.py) and the 3x3 sheet path
(art/split_grid.py) use these, so an avatar looks the same no matter which
route produced the cutout.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    'C:/Windows/Fonts/msyhbd.ttc',
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/simhei.ttf',
]


def load_font(size):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return None


def _longest_run_per_row(mask):
    """Longest contiguous True run in every row.

    A raised arm is a separate run from the head, so measuring the longest
    run instead of the total row width keeps arms out of the head size.
    """
    out = np.zeros(mask.shape[0], dtype=np.int32)
    for i in range(mask.shape[0]):
        row = mask[i]
        if not row.any():
            continue
        diff = np.diff(np.concatenate(([0], row.astype(np.int8), [0])))
        starts = np.where(diff == 1)[0]
        ends = np.where(diff == -1)[0]
        if len(starts):
            out[i] = int((ends - starts).max())
    return out


def find_head(cut):
    """Locates the head inside a chibi full-body cutout.

    Returns (head_width, head_top, head_height) in pixels of the cutout.

    Everything is measured on the longest contiguous run per row rather than
    the total row width, so a raised arm (a separate run) never counts as
    part of the head, and spiky hair on top of the head never reads as a
    shoulder. The shoulder line is the first row whose run reaches 75% of
    the character's total width.
    """
    bbox = cut.getbbox()
    if not bbox:
        return None
    x0, y0, x1, y1 = bbox
    bw, bh = x1 - x0, y1 - y0

    alpha = np.array(cut.getchannel('A'))
    # A high alpha threshold keeps the soft ground shadow out of the profile.
    mask = alpha > 120
    runs = _longest_run_per_row(mask)

    wide = np.where(runs > 0.75 * bw)[0]
    if len(wide):
        shoulder = int(wide[0])
    else:
        shoulder = int(y0 + bh * 0.45)
    shoulder = max(shoulder, int(y0 + bh * 0.26))
    shoulder = min(shoulder, int(y0 + bh * 0.62))

    head_runs = runs[y0:shoulder]
    head_w = int(head_runs.max()) if len(head_runs) else bw
    head_w = max(1, min(head_w, bw))
    head_h = max(1, shoulder - y0)
    return head_w, y0, head_h


def alpha_content_box(im, thresh=16):
    """Bounding box of pixels whose alpha is above `thresh`. Full canvas if none."""
    bbox = im.convert('RGBA').getchannel('A').point(lambda v: 255 if v > thresh else 0).getbbox()
    return bbox or (0, 0, im.width, im.height)


def make_original_disc(im, size=256, pad_ratio=0.06, alpha_thresh=16):
    """Original head PNG → alpha crop → pad → circular mask.

    Geometric only. The disc is a uniform scale of the source pixels; nothing is
    redrawn. Pad is 6% of the long side of the content box (same rule as
    art/preview_style.py), so the circle does not shave the chin or the hair.
    """
    src = im.convert('RGBA')
    x0, y0, x1, y1 = alpha_content_box(src, alpha_thresh)
    crop = src.crop((x0, y0, x1, y1))
    w, h = crop.size
    side = max(w, h)
    pad = int(side * pad_ratio)
    canvas_side = max(1, side + 2 * pad)
    square = Image.new('RGBA', (canvas_side, canvas_side), (0, 0, 0, 0))
    square.paste(crop, ((canvas_side - w) // 2, (canvas_side - h) // 2), crop)
    out = square.resize((size, size), Image.LANCZOS)
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    out.putalpha(Image.composite(out.getchannel('A'), Image.new('L', (size, size), 0), mask))
    return out


def make_avatar(cut, size=256):
    """Circular head crop, filled to the edge of the circle."""
    found = find_head(cut)
    if not found:
        return Image.new('RGBA', (size, size), (0, 0, 0, 0))
    head_w, top, head_h = found
    bbox = cut.getbbox()
    x0 = bbox[0]
    bw = bbox[2] - bbox[0]

    # A chibi head is about as wide as it is tall, so the face width sets the
    # square; the small margin keeps spiky hair from being shaved off.
    side = int(head_w * 1.12)
    left = x0 + (bw - side) // 2
    head = cut.crop((left, top, left + side, top + side)).resize((size, size), Image.LANCZOS)

    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(head, (0, 0), head)

    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    circle = mask.resize((size, size), Image.LANCZOS)
    out.putalpha(Image.composite(out.split()[3], Image.new('L', (size, size), 0), circle))
    return out


def make_full(cut, w=512, h=640):
    """Transparent full-body cutout, bottom-aligned on the card canvas."""
    bbox = cut.getbbox()
    if not bbox:
        return Image.new('RGBA', (w, h), (0, 0, 0, 0))
    cut = cut.crop(bbox)
    cw, ch = cut.size
    scale = min((w - 40) / float(cw), (h - 40) / float(ch))
    cut = cut.resize((max(1, int(cw * scale)), max(1, int(ch * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    canvas.paste(cut, ((w - cut.size[0]) // 2, h - cut.size[1] - 10), cut)
    return canvas
