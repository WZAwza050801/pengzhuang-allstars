"""AR-1: build the original pitch art used by the field skins.

data/fields.json is the single source of the art -> physics mapping. Every skin with `art` carries
  artSource  original image, relative to the project root
  artCrop    [left, top, right, bottom) source pixels of the playable area (between the two goal lines)
  artRotate  degrees clockwise applied after cropping. The originals are portrait with the goals at the top
             and bottom, which is also how the project draws the field (goals at y = +-length/2 in
             client/src/render.ts), so every skin uses 0.
  artFit     how client/src/render.ts lays the image over the playable rectangle ("cover")

The crop was measured from the 1.5.5 textures: the two goal lines are the long white runs in the
middle band, and the white side walls bound the pitch. Cropping between them gives 956x1559 px,
which maps exactly onto the 6.0 x 9.78 m physics rectangle (159.3 px/m in x, 159.4 px/m in y), and
the original centre line / centre circle land on 4.89 m / 3.89 and 5.89 m, matching the geometry.
and the result is written to client/public/<art>.

  python art/build_field_skins.py            build the images
  python art/build_field_skins.py --diag     also draw the geometry over the art (runs/_diag/ar1_overlay.png),
                                             scan the art's white lines and sample its colours
  python art/build_field_skins.py --compare  compose docs/img/ar1_<id>.jpg from docs/img/ar1_game_<id>.jpg

Pillow lives in the managed environment only:
  C:/Users/31168/.workbuddy/binaries/python/envs/default/Scripts/python.exe
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageStat, features

ROOT = Path(__file__).resolve().parents[1]
DIAG = ROOT / "runs" / "_diag"
DOCS_IMG = ROOT / "docs" / "img"
MARK = (255, 0, 160)
POST = (0, 220, 255)


def art_skins():
    fields = json.loads((ROOT / "data" / "fields.json").read_text(encoding="utf-8"))
    return fields["geometry"], [s for s in fields["skins"] if s.get("art")]


def load(sk):
    src = Image.open(ROOT / sk["artSource"]).convert("RGB")
    art = src.crop(tuple(sk["artCrop"]))
    if sk["artRotate"]:
        art = art.rotate(-sk["artRotate"], expand=True)  # PIL turns counter-clockwise
    return src, art


def build(skins):
    if not features.check("webp"):
        raise SystemExit("this Pillow has no WebP support")
    for sk in skins:
        _, art = load(sk)
        out = ROOT / "client" / "public" / sk["art"]
        out.parent.mkdir(parents=True, exist_ok=True)
        art.save(out, quality=85, method=6)
        print(f"{sk['id']}: {Path(sk['artSource']).name} crop {sk['artCrop']} rotate {sk['artRotate']} "
              f"-> {sk['art']} {art.width}x{art.height} {out.stat().st_size} B")
        if sk.get("scene"):
            # The whole original screen (stands, walls, corner springs, score bar). render.ts places it
            # with artCrop so the cropped rectangle still lands exactly on the physics rectangle.
            src = Image.open(ROOT / sk["artSource"]).convert("RGB")
            if list(src.size) != sk["sceneSize"]:
                raise SystemExit(f"{sk['id']}: sceneSize {sk['sceneSize']} != source {src.size}")
            full = ROOT / "client" / "public" / sk["scene"]
            src.save(full, quality=82, method=6)
            print(f"  full scene -> {sk['scene']} {src.width}x{src.height} {full.stat().st_size} B")


def white_spans(pixels, min_len=2):
    """[first, last] pixel index of every run of near-white pixels."""
    spans, start = [], None
    for i, (r, g, b) in enumerate(pixels + [(0, 0, 0)]):
        if min(r, g, b) >= 170:
            if start is None:
                start = i
        elif start is not None:
            if i - start >= min_len:
                spans.append([start, i - 1])
            start = None
    return spans


def white_runs(pixels):
    """Centres (pixel index) of runs of near-white pixels."""
    return [(a + b) / 2 for a, b in white_spans(pixels)]


def contact(tiles, out, gap=8, head=18):
    """Labelled tiles side by side."""
    sheet = Image.new("RGB", (sum(t.width for _, t in tiles) + gap * (len(tiles) - 1), max(t.height for _, t in tiles) + head), (255, 255, 255))
    x = 0
    for name, t in tiles:
        sheet.paste(t, (x, head))
        ImageDraw.Draw(sheet).text((x + 4, 3), name, fill=(0, 0, 0))
        x += t.width + gap
    sheet.save(out)
    print(f"sheet -> {out.relative_to(ROOT).as_posix()} {sheet.width}x{sheet.height}")


def hex_of(rgb):
    return "#%02x%02x%02x" % tuple(round(c) for c in rgb[:3])


def overlay(art, g, width=360):
    """The art scaled to `width` px with the physics geometry drawn on top."""
    W, L, c = g["width"] / 2, g["length"] / 2, g["cornerCut"]
    im = art.resize((width, round(art.height * width / art.width)), Image.LANCZOS)
    kx, ky = im.width / g["width"], im.height / g["length"]

    def P(x, y):
        return (x + W) * kx, (y + L) * ky

    d = ImageDraw.Draw(im)
    d.polygon([P(-W + c, -L), P(W - c, -L), P(W, -L + c), P(W, L - c), P(W - c, L), P(-W + c, L), P(-W, L - c), P(-W, -L + c)], outline=MARK)
    d.line([P(-W, 0), P(W, 0)], fill=MARK)
    r = g["centerRadius"]
    d.ellipse([P(-r, -r), P(r, r)], outline=MARK)
    bw, bd, ar = g["boxWidth"] / 2, g["boxDepth"], g["arcRadius"]
    for s in (-1, 1):
        y, yb = s * L, s * (L - bd)
        d.rectangle([P(-bw, min(y, yb)), P(bw, max(y, yb))], outline=MARK)
        d.arc([P(-ar, yb - ar), P(ar, yb + ar)], 0 if s < 0 else 180, 180 if s < 0 else 360, fill=MARK)
        sy = s * (L - g["penaltySpot"])
        d.ellipse([P(-0.05, sy - 0.05), P(0.05, sy + 0.05)], fill=MARK)
        for sx in (-1, 1):
            x = sx * g["goalWidth"] / 2
            d.ellipse([P(x - 0.08, y - 0.08), P(x + 0.08, y + 0.08)], outline=POST, width=2)
    return im


def diag(g, skins):
    DIAG.mkdir(parents=True, exist_ok=True)
    near = [g["penaltySpot"], g["boxDepth"], g["boxDepth"] + g["arcRadius"]]
    half = g["length"] / 2
    expect = near + [half - g["centerRadius"], half, half + g["centerRadius"]] + [g["length"] - v for v in reversed(near)]
    print("geometry expects down the centre column:", [round(v, 2) for v in expect], f"and box sides at x = +-{g['boxWidth'] / 2:.3f}")
    tiles = []
    for sk in skins:
        src, art = load(sk)
        kx, ky = art.width / g["width"], art.height / g["length"]
        print(f"{sk['id']}: {art.width}x{art.height} px = {kx:.2f} x {ky:.2f} px/m")
        col = [art.getpixel((art.width // 2, v)) for v in range(art.height)]
        print("  white runs down the centre column (m from the top goal line):", [round(v / ky, 2) for v in white_runs(col)])
        for depth in (0.4, g["length"] - 0.4):
            row = [art.getpixel((u, round(depth * ky))) for u in range(art.width)]
            print(f"  white runs across y = {depth:.2f} m (x in m):", [round(u / kx - g["width"] / 2, 2) for u in white_runs(row)])
        left, top, right, bottom = sk["artCrop"]
        grass = ImageStat.Stat(art).median
        wall = ImageStat.Stat(src.crop((left - 24, top + 200, left - 6, bottom - 200))).median
        outside = ImageStat.Stat(src.crop((10, top + 200, 120, bottom - 200))).median
        print(f"  median colours: grass {hex_of(grass)}  left wall strip {hex_of(wall)}  far left margin {hex_of(outside)}")
        tiles.append((sk["id"], overlay(art, g)))
    gap, head = 8, 18
    sheet = Image.new("RGB", (sum(t.width for _, t in tiles) + gap * (len(tiles) - 1), max(t.height for _, t in tiles) + head), (255, 255, 255))
    x = 0
    for name, t in tiles:
        sheet.paste(t, (x, head))
        ImageDraw.Draw(sheet).text((x + 4, 3), name, fill=(0, 0, 0))
        x += t.width + gap
    out = DIAG / "ar1_overlay.png"
    sheet.save(out)
    print(f"overlay sheet -> {out.relative_to(ROOT).as_posix()} {sheet.width}x{sheet.height}")


def compare(skins, height=960, gap=16):
    for sk in skins:
        src, _ = load(sk)
        left, top, right, bottom = sk["artCrop"]
        ImageDraw.Draw(src).rectangle([left, top, right - 1, bottom - 1], outline=MARK, width=6)
        game = Image.open(DOCS_IMG / f"ar1_game_{sk['id']}.jpg").convert("RGB")
        a = src.resize((round(src.width * height / src.height), height), Image.LANCZOS)
        b = game.resize((round(game.width * height / game.height), height), Image.LANCZOS)
        sheet = Image.new("RGB", (a.width + gap + b.width, height), (255, 255, 255))
        sheet.paste(a, (0, 0))
        sheet.paste(b, (a.width + gap, 0))
        out = DOCS_IMG / f"ar1_{sk['id']}.jpg"
        sheet.save(out, quality=85)
        print(f"{out.relative_to(ROOT).as_posix()} {sheet.width}x{sheet.height} {out.stat().st_size} B")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--diag", action="store_true", help="overlay sheet, white-line scan and colour samples")
    ap.add_argument("--compare", action="store_true", help="compose the docs comparison images (needs the game screenshots)")
    a = ap.parse_args()
    geometry, skins = art_skins()
    if a.compare:
        compare(skins)
    else:
        build(skins)
        if a.diag:
            diag(geometry, skins)
