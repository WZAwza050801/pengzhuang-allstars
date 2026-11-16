"""Cut the top-left corner spring out of Scenes_01.jpg.

The playable crop is the same rectangle AR-1 uses (x 242..1198, y 243..1802).
The corner assembly — pale stone, blue-gray coil, sand slope — stays.
Pitch grass and shrubs become transparent. One sprite is mirrored onto all four corners.

    python art/extract_spring.py
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(
    ROOT, 'materials', 'pengzhuang_rebuild', '03_art', 'original_images', '1.5.5', 'texture', 'Scenes_01.jpg')
OUT = os.path.join(ROOT, 'client', 'public', 'assets', 'fields', 'spring_corner.png')

# scene_01 artCrop, shared with data/fields.json. 956 px == geometry.width (6 m).
CROP = (242, 243, 1198, 1802)
# 0.5 m chamfer is ~80 px; 128 px keeps the coil and the inner sand slope.
N = 128


def main():
    src = Image.open(SRC).convert('RGB')
    corner = src.crop(CROP).crop((0, 0, N, N)).convert('RGBA')
    arr = np.asarray(corner).copy()
    r = arr[:, :, 0].astype(np.int16)
    g = arr[:, :, 1].astype(np.int16)
    b = arr[:, :, 2].astype(np.int16)
    # Green or yellow-green vegetation. Sand (red leads) and blue-gray metal stay.
    veg = (g > b + 25) & (r < g + 25) & (g > 70)
    alpha = np.where(veg, 0, 255).astype(np.uint8)
    arr[:, :, 3] = alpha
    Image.fromarray(arr).save(OUT)

    ys, xs = np.where(alpha > 0)
    tri = (np.arange(N)[:, None] + np.arange(N)[None, :]) < 80
    tri_opaque = float((alpha[tri] > 0).mean()) if tri.any() else 0
    print({
        'out': OUT,
        'size': N,
        'opaque': int((alpha > 0).sum()),
        'bbox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None,
        'triangle_opaque': round(tri_opaque, 3),
        'bytes': os.path.getsize(OUT),
    })
    step = 8
    rows = []
    for y in range(0, N, step):
        row = []
        for x in range(0, N, step):
            block = alpha[y:y + step, x:x + step]
            row.append('#' if block.mean() > 127 else '.')
        rows.append(''.join(row))
    print('\n'.join(rows))
    if tri_opaque < 0.35 or len(xs) < 400:
        raise SystemExit('FAIL spring sprite is too empty')
    print('PASS')


if __name__ == '__main__':
    main()
