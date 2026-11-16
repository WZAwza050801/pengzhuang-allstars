"""Cropped field boards (empty score bar removed) from the five field scenes.

Retired 2026-11-16 by D11: the lobby now shows the original isometric stadium
models (orig_ui/stadium/Image_0N.png), so these boards have no consumer and were
deleted. This script is kept only as the regeneration path — running it recreates
five orphaned assets, so don't run it unless something needs them again.

The only edit is cutting off the empty score bar at the top (148 px). Grass,
walls, stands and springs are the original pixels.

    python art/process_arena.py
"""
from pathlib import Path

from PIL import Image, features

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "client" / "public" / "assets" / "fields"
# The black center tab of the original score bar ends just under y=140.
CROP_TOP = 148


def main():
    if not features.check("webp"):
        raise SystemExit("this Pillow has no WebP support")
    for i in range(1, 6):
        src = Image.open(SRC / f"scene_0{i}_full.webp").convert("RGB")
        board = src.crop((0, CROP_TOP, src.width, src.height))
        out = SRC / f"scene_0{i}_board.webp"
        board.save(out, quality=82, method=6)
        print(f"scene_0{i}_board.webp {board.size[0]}x{board.size[1]} from {src.size[0]}x{src.size[1]} crop y={CROP_TOP}")


if __name__ == "__main__":
    main()
