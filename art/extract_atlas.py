#!/usr/bin/env python3
"""从原版 sprite_frames.json 切出图集 sprite。

★ 关键坑（已实测）：sprite_frames.json 的 `texture_file` 字段对 UI 类切片是**错的**。
  例：`Btn_02` 标注 texture_file=`03_art/original_images/1.5.5/texture/ID_14.png`，
  但该文件实际只有 844x284，而 rect=[1151,1995,44,44] 的 y 坐标 1995 远超图片高度。
  这些切片真正的来源是同 texture_uuid 的 `atlas/Skin.png`（2048x2048 RGBA）。

正确规则：
  1. 用 `texture`（UUID）→ 在 image_inventory.json 里找候选文件；
  2. 优先选尺寸 >= rect 右下角的那个候选（通常在 atlas/ 下）；
  3. texture_file 只作为候选之一参与校验，不单独采信。

用法：
  python art/extract_atlas.py --version 1.5.5 --out client/public/assets/orig_atlas
  python art/extract_atlas.py --version 1.5.5 --names Btn_02,Box_Select --out runs/_diag
  python art/extract_atlas.py --version 1.5.5 --list-sources
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MATERIALS = os.path.join(ROOT, "materials", "pengzhuang_rebuild")
FRAMES = os.path.join(MATERIALS, "03_art", "sprite_frames.json")
INVENTORY = os.path.join(MATERIALS, "03_art", "image_inventory.json")


def parse_rect(value) -> list[int]:
    """rect/originalSize 可能是 list[int] 或字符串 "[x, y, w, h]"。"""
    if isinstance(value, (list, tuple)):
        return [int(round(float(v))) for v in value]
    nums = re.findall(r"-?\d+\.?\d*", str(value))
    return [int(round(float(n))) for n in nums]


def load_sources() -> dict[str, list[str]]:
    """texture_uuid -> [候选文件相对路径...]，尺寸大的优先。"""
    with open(INVENTORY, encoding="utf-8") as fh:
        inv = json.load(fh)
    items = inv if isinstance(inv, list) else inv.get("images", inv)
    out: dict[str, list[tuple[int, str]]] = {}
    for item in items:
        uuid = str(item.get("texture_uuid") or "")
        path = item.get("file")
        if not uuid or not path:
            continue
        area = int(item.get("width") or 0) * int(item.get("height") or 0)
        out.setdefault(uuid, []).append((area, path))
    result = {}
    for uuid, lst in out.items():
        lst.sort(reverse=True)
        result[uuid] = [p for _, p in lst]
    return result


def pick_source(uuid: str, rect: list[int], claimed: str | None, sources: dict[str, list[str]]) -> str:
    """为切片挑一张足够大的图集文件。"""
    need_x = rect[0] + rect[2]
    need_y = rect[1] + rect[3]
    candidates = list(sources.get(uuid, []))
    if claimed:
        candidates = [claimed] + [c for c in candidates if c != claimed]

    def size_of(rel: str) -> tuple[int, int]:
        from PIL import Image

        try:
            with Image.open(os.path.join(MATERIALS, rel)) as im:
                return im.size
        except Exception:
            return (0, 0)

    for rel in candidates:
        w, h = size_of(rel)
        if w >= need_x and h >= need_y:
            return rel
    # 都放不下就退回原版声明（切片会被截断，调用方需自行发现）
    return claimed or (candidates[0] if candidates else "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="1.5.5", help="1.2.0 / 1.5.5")
    ap.add_argument("--names", default="", help="逗号分隔的 sprite 名；留空=全部")
    ap.add_argument("--out", default="", help="输出目录")
    ap.add_argument("--list-sources", action="store_true", help="只打印切片刻度与来源")
    args = ap.parse_args()

    try:
        from PIL import Image
    except ImportError:
        print("需要 Pillow：pip install pillow", file=sys.stderr)
        return 2

    with open(FRAMES, encoding="utf-8") as fh:
        frames = json.load(fh)
    if args.version not in frames:
        print(f"没有版本 {args.version}", file=sys.stderr)
        return 2
    items = frames[args.version]

    wanted = {n.strip() for n in args.names.split(",") if n.strip()}
    sources = load_sources()

    resolved: list[tuple[str, list[int], int | None, list[int], str]] = []
    for item in items:
        name = item.get("name", "")
        if wanted and name not in wanted:
            continue
        rect = parse_rect(item.get("rect"))
        size = parse_rect(item.get("originalSize")) or [rect[2], rect[3]]
        rotated = item.get("rotated")
        uuid = str(item.get("texture") or "")
        src = pick_source(uuid, rect, item.get("texture_file"), sources)
        resolved.append((name, rect, rotated, size, src))

    if args.list_sources:
        for name, rect, rotated, size, src in resolved:
            print(f"{name:28s} rect={str(rect):24s} size={str(size):16s} rot={rotated}  src={src}")
        return 0

    out_dir = os.path.abspath(args.out) if args.out else os.path.join(ROOT, "client", "public", "assets", "orig_atlas", args.version)
    os.makedirs(out_dir, exist_ok=True)

    cache: dict[str, object] = {}
    written, skipped = 0, 0
    for name, rect, rotated, size, src in resolved:
        if not src:
            skipped += 1
            continue
        if src not in cache:
            cache[src] = Image.open(os.path.join(MATERIALS, src)).convert("RGBA")
        atlas = cache[src]
        if rect[0] + rect[2] > atlas.width or rect[1] + rect[3] > atlas.height:
            skipped += 1
            continue
        if rotated:
            # Cocos 的 rotated=1 表示切片在图集里顺时针转了 90°
            crop = atlas.crop((rect[0], rect[1], rect[0] + size[1], rect[1] + size[0])).rotate(-90, expand=True)
        else:
            crop = atlas.crop((rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]))
        crop.save(os.path.join(out_dir, f"{name}.png"))
        written += 1

    print(f"切出 {written} 个，跳过 {skipped} 个 -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
