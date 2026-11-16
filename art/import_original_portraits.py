"""Import original 1.5.5 head icons as circular disc avatars.

Reads data/players.json srcId → player_portrait_mapping.csv portrait_id →
materials/.../portraits/1.5.5/head_*.png.

Writes:
  client/public/assets/players_original/<portraitId>.png   256×256 RGBA, cropped + masked
  data/portrait_map.json

Pixels are the original art. The only operations are an alpha-content crop,
a 6% long-side pad, a uniform scale, and a circular alpha mask.
Players without a source portrait are listed as fallback and are not invented.
head_4001_40109 (D6, not on the roster) is never copied.

    python art/import_original_portraits.py
"""
import csv
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from avatar import alpha_content_box, make_original_disc  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORTRAIT_DIR = os.path.join(
    ROOT, 'materials', 'pengzhuang_rebuild', '02_players_and_data', 'portraits', '1.5.5')
CSV_PATH = os.path.join(
    ROOT, 'materials', 'pengzhuang_rebuild', '02_players_and_data',
    'earlier_exports', 'player_portrait_mapping.csv')
PLAYERS_JSON = os.path.join(ROOT, 'data', 'players.json')
OUT_DIR = os.path.join(ROOT, 'client', 'public', 'assets', 'players_original')
MAP_PATH = os.path.join(ROOT, 'data', 'portrait_map.json')

SIZE = 256
PAD_RATIO = 0.06
ALPHA_THRESH = 16
EXPECTED_FALLBACK = {f'p{i:02d}' for i in range(6, 17)}
EXCLUDED_PORTRAIT = 'head_4001_40109'


def pid_key(pid):
    return int(pid[1:])


def median_rgb(im):
    arr = np.asarray(im.convert('RGBA'))
    pix = arr[arr[:, :, 3] > ALPHA_THRESH][:, :3]
    if len(pix) == 0:
        return None
    return np.median(pix, axis=0)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    os.makedirs(OUT_DIR, exist_ok=True)

    with open(CSV_PATH, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    by_src = {}
    for row in rows:
        src = str(row['player_id']).strip()
        portrait_id = str(row['portrait_id']).strip()
        if src in by_src and by_src[src] != portrait_id:
            raise SystemExit(f'duplicate csv player_id {src}')
        by_src[src] = portrait_id

    players = json.load(open(PLAYERS_JSON, encoding='utf-8'))['players']
    entries = []
    fallback = []
    missing_src = []
    used_portraits = set()

    ratios = []
    fills = []
    insets = []
    deltas = []
    sizes = {}

    for p in players:
        pid = p['id']
        src = p.get('srcId')
        if src is None or str(src).strip() == '':
            fallback.append(pid)
            continue
        src = str(src).strip()
        portrait_id = by_src.get(src)
        if not portrait_id:
            missing_src.append((pid, src))
            continue
        src_path = os.path.join(PORTRAIT_DIR, portrait_id + '.png')
        if not os.path.isfile(src_path):
            missing_src.append((pid, src + ' file'))
            continue
        im = Image.open(src_path).convert('RGBA')
        sizes[im.size] = sizes.get(im.size, 0) + 1
        x0, y0, x1, y1 = alpha_content_box(im, ALPHA_THRESH)
        ratios.append(((x1 - x0) * (y1 - y0)) / float(im.width * im.height))
        crop = im.crop((x0, y0, x1, y1))
        out = make_original_disc(im, SIZE, PAD_RATIO, ALPHA_THRESH)
        a = np.asarray(out.getchannel('A'))
        cy = (SIZE - 1) / 2.0
        ys, xs = np.ogrid[:SIZE, :SIZE]
        circle = (xs - cy) ** 2 + (ys - cy) ** 2 <= cy ** 2
        fills.append(float((a[circle] > ALPHA_THRESH).mean()))
        ys_nz, xs_nz = np.where(a > ALPHA_THRESH)
        if len(xs_nz) == 0:
            insets.append(0)
        else:
            insets.append(int(min(xs_nz.min(), ys_nz.min(), SIZE - 1 - xs_nz.max(), SIZE - 1 - ys_nz.max())))
        src_med = median_rgb(crop)
        out_med = median_rgb(out)
        deltas.append(float(np.abs(src_med - out_med).max()) if src_med is not None and out_med is not None else 999)
        corners = [out.getpixel((0, 0))[3], out.getpixel((SIZE - 1, 0))[3],
                   out.getpixel((0, SIZE - 1))[3], out.getpixel((SIZE - 1, SIZE - 1))[3]]
        if any(c != 0 for c in corners):
            raise SystemExit(f'{portrait_id} circle mask missed a corner {corners}')
        if out.mode != 'RGBA' or out.size != (SIZE, SIZE):
            raise SystemExit(f'{portrait_id} bad output {out.mode} {out.size}')
        dest = os.path.join(OUT_DIR, portrait_id + '.png')
        out.save(dest)
        entries.append({'id': pid, 'srcId': src, 'portraitId': portrait_id})
        used_portraits.add(portrait_id)

    entries.sort(key=lambda e: pid_key(e['id']))
    fallback.sort(key=pid_key)

    expected_names = {e['portraitId'] + '.png' for e in entries}
    removed = []
    for name in os.listdir(OUT_DIR):
        if name.lower().endswith('.png') and name not in expected_names:
            os.remove(os.path.join(OUT_DIR, name))
            removed.append(name)

    disk_pngs = sorted(n for n in os.listdir(PORTRAIT_DIR) if n.lower().endswith('.png'))
    extra_sources = sorted(os.path.splitext(n)[0] for n in disk_pngs if os.path.splitext(n)[0] not in used_portraits)

    payload = {
        'version': 'portraits-1',
        'size': SIZE,
        'padRatio': PAD_RATIO,
        'alphaThresh': ALPHA_THRESH,
        'note': '原版 1.5.5 head_*.png。只做 alpha 内容框裁切、长边 6% 留白、等比缩放到 256、圆形遮罩。不重绘。无原图的球员不在 entries 里，渲染回退到 players/<id>_avatar.png。',
        'fallbackIds': fallback,
        'excludedPortraits': extra_sources,
        'entries': entries,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2) + '\n'
    with open(MAP_PATH, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)

    digest = hashlib.sha256()
    digest.update(text.encode('utf-8'))
    for e in entries:
        p = os.path.join(OUT_DIR, e['portraitId'] + '.png')
        digest.update(e['portraitId'].encode('utf-8'))
        with open(p, 'rb') as fh:
            digest.update(fh.read())

    problems = []
    if len(entries) != 106:
        problems.append(f'entries {len(entries)} != 106')
    if set(fallback) != EXPECTED_FALLBACK:
        problems.append(f'fallback {fallback} != p06-p16')
    if len(used_portraits) != len(entries):
        problems.append('duplicate portraitId')
    if missing_src:
        problems.append(f'unmapped srcId {missing_src[:8]}')
    if extra_sources != [EXCLUDED_PORTRAIT]:
        problems.append(f'excluded sources {extra_sources}')
    if not os.path.isfile(os.path.join(PORTRAIT_DIR, EXCLUDED_PORTRAIT + '.png')):
        problems.append('40109 source missing')
    if any(v < 4 for v in insets):
        problems.append(f'inset < 4 (min {min(insets) if insets else None})')
    if any(v < 0.35 or v > 0.98 for v in fills):
        problems.append(f'circle fill out of range min {min(fills):.3f} max {max(fills):.3f}')
    if any(v > 30 for v in deltas):
        problems.append(f'median color drift {max(deltas):.1f}')
    if removed:
        # leftover from a previous run is fine; just report
        pass

    def span(xs):
        return [round(float(min(xs)), 4), round(float(np.median(xs)), 4), round(float(max(xs)), 4)]

    total_bytes = sum(os.path.getsize(os.path.join(OUT_DIR, e['portraitId'] + '.png')) for e in entries)
    stats = {
        'entries': len(entries),
        'fallback': fallback,
        'excluded': extra_sources,
        'missing_src': missing_src,
        'source_sizes': {f'{w}x{h}': n for (w, h), n in sizes.items()},
        'content_ratio_min_med_max': span(ratios) if ratios else None,
        'circle_fill_min_med_max': span(fills) if fills else None,
        'inset_px_min_med_max': span(insets) if insets else None,
        'median_rgb_delta_min_med_max': span(deltas) if deltas else None,
        'png_bytes': total_bytes,
        'removed_stale': removed,
        'sha256': digest.hexdigest(),
        'sample': entries[:2] + entries[-1:],
    }
    print(json.dumps(stats, ensure_ascii=False))
    if problems:
        print('FAIL', '; '.join(problems))
        return 1
    print('PASS')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
