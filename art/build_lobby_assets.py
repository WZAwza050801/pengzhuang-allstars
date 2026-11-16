#!/usr/bin/env python3
"""原版大厅 / 阵容界面素材与球员目录。

产出（全部来自原版资料，只切图、不重绘）：
  client/public/assets/orig_ui/<name>.png     Skin 图集里大厅、阵容、详情弹窗用到的切片
  client/public/assets/orig_ui/stadium/*.png  联赛 / 杯赛球场（texture/Image_*.png）与阵容底板 Img_01
  client/public/assets/skills/<icon>.png      目录里用到的技能图标（skillIcon 图集）
  data/player_catalog.json                    选人界面用的原版球员目录（只供显示，不进 GameData）

用法：python art/build_lobby_assets.py
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAT = os.path.join(ROOT, "materials", "pengzhuang_rebuild")
TEX = os.path.join(MAT, "03_art", "original_images", "1.5.5", "texture")
UI_OUT = os.path.join(ROOT, "client", "public", "assets", "orig_ui")
STADIUM_OUT = os.path.join(UI_OUT, "stadium")
SKILL_OUT = os.path.join(ROOT, "client", "public", "assets", "skills")
CATALOG_OUT = os.path.join(ROOT, "data", "player_catalog.json")

UI_SLICES = [
    # 顶栏
    "Lv_Background", "Lv_Add", "Lv_ProgressBar_03", "Ico_01", "Ico_02", "Ico_03",
    # 卡牌品质框
    "Box_Quality_01", "Box_Quality_02", "Box_Quality_03", "Box_Quality_04", "Box_Quality_05",
    "Box_Quality_01_Bg", "Box_Quality_02_Bg", "Box_Quality_03_Bg", "Box_Quality_04_Bg", "Box_Quality_05_Bg",
    "Box_LvBg", "Box_Select",
    # 属性图标（重量 / 力度 / 精准 / 心理 / 弧度）
    "Player_Attributes_01", "Player_Attributes_02", "Player_Attributes_03", "Player_Attributes_04", "Player_Attributes_05",
    # 页签与底部导航
    "Tab_01", "Tab_02", "Tab_03", "Tab_04", "Tab_Right",
    "Tab_Icon_01", "Tab_Icon_02", "Tab_Icon_03", "Tab_Icon_04", "Tab_Icon_05", "Tab_Icon_06", "Tab_Icon_07",
    # 阵容
    "LineUp_01", "Title_Bg01", "Title_Bg03", "List_04", "Btn_Icon_05", "Btn_Icon_06", "Btn_Icon_07",
    # 大厅：设置齿轮、奖杯、球场、任务、分享、邮件；自由 / 重磅合同
    "Btn_Icon_01", "Btn_Icon_02", "Btn_Icon_03", "Btn_Icon_04", "Btn_Icon_08", "Btn_Icon_09",
    "Store_Icon_01", "Store_Icon_05",
    # 弹窗
    "Windos_TipsBox", "Windos_TipsBox_Close", "Box_01", "Box_02", "Btn_01", "Btn_05",
]
STADIUMS = ["Image_01", "Image_02", "Image_03", "Image_04", "Image_05", "Image_A", "Image_B", "Img_01"]
POSITION = {"ST": "FW", "CM": "MF", "DC": "DF", "GK": "GK"}


def sha(path: str) -> str:
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def slice_ui() -> None:
    subprocess.run(
        [sys.executable, os.path.join(ROOT, "art", "extract_atlas.py"), "--version", "1.5.5",
         "--names", ",".join(UI_SLICES), "--out", UI_OUT],
        check=True,
    )
    missing = [n for n in UI_SLICES if not os.path.exists(os.path.join(UI_OUT, n + ".png"))]
    if missing:
        raise SystemExit(f"切片缺失：{missing}")
    os.makedirs(STADIUM_OUT, exist_ok=True)
    for n in STADIUMS:
        shutil.copyfile(os.path.join(TEX, n + ".png"), os.path.join(STADIUM_OUT, n + ".png"))


def build_catalog() -> dict:
    players = json.load(open(os.path.join(ROOT, "data", "players.json"), encoding="utf-8"))["players"]
    portrait = {e["id"]: e["portraitId"] for e in json.load(open(os.path.join(ROOT, "data", "portrait_map.json"), encoding="utf-8"))["entries"]}
    cards = dict(json.load(open(os.path.join(ROOT, "data", "cards.json"), encoding="utf-8"))["cards"])
    records = json.load(open(os.path.join(MAT, "02_players_and_data", "skill_records.json"), encoding="utf-8"))
    skill_by: dict[tuple[str, str], dict] = {}
    for r in records:
        key = (r["version"], r["skill_id"])
        # 同一 skill_id 多条时取 level 最小的那条（技能本身的第一级描述）
        if key not in skill_by or r["level"] < skill_by[key]["level"]:
            skill_by[key] = r

    entries, icons = [], set()
    for p in players:
        if not p.get("srcId") or p["id"] not in portrait:
            continue
        card_key = next((k for k in (f"1.5.5|{p['srcId']}", f"1.2.0|{p['srcId']}") if k in cards), None)
        card = cards.get(card_key) if card_key else None
        version = card_key.split("|")[0] if card_key else "1.5.5"
        skills = []
        if card:
            for sid, unlock in zip(card.get("skillIds", []), card.get("unlockLevels", [])):
                rec = skill_by.get((version, sid)) or skill_by.get(("1.5.5", sid)) or skill_by.get(("1.2.0", sid))
                if not rec:
                    continue
                icons.add(rec["icon"])
                skills.append({"id": sid, "name": rec["name"], "desc": rec["description"], "icon": rec["icon"], "unlock": unlock})
        entries.append({
            "id": p["id"],
            "name": p["name"],
            "position": p["position"],
            "srcPosition": card["position"] if card else p.get("srcPosition"),
            "quality": p["quality"],
            "rarity": card["rarity"] if card else p.get("rarity"),
            "portraitId": portrait[p["id"]],
            "card": card_key,
            "skills": skills,
        })
    return {"entries": entries, "icons": sorted(icons)}


def copy_skill_icons(icons: list[str]) -> list[str]:
    subprocess.run(
        [sys.executable, os.path.join(ROOT, "art", "extract_atlas.py"), "--version", "1.5.5",
         "--names", ",".join(icons), "--out", SKILL_OUT],
        check=True,
    )
    return [i for i in icons if not os.path.exists(os.path.join(SKILL_OUT, i + ".png"))]


def main() -> int:
    slice_ui()
    cat = build_catalog()
    missing_icons = copy_skill_icons(cat["icons"])
    out = {
        "version": "catalog-1",
        "note": "选人 / 阵容界面的显示目录：原版球员（有 srcId 且有原版头像）、原版卡的位置 / 稀有度 / 技能名与原文描述。只供界面显示，不进 GameData，不影响 dataVersion。",
        "generatedBy": "art/build_lobby_assets.py",
        "sources": {
            "data/players.json": sha(os.path.join(ROOT, "data", "players.json")),
            "data/cards.json": sha(os.path.join(ROOT, "data", "cards.json")),
            "data/portrait_map.json": sha(os.path.join(ROOT, "data", "portrait_map.json")),
            "materials/.../skill_records.json": sha(os.path.join(MAT, "02_players_and_data", "skill_records.json")),
        },
        "excluded": "重建球员 p06–p16（原版没有）按用户决定不进卡池",
        "missingSkillIcons": missing_icons,
        "entries": cat["entries"],
    }
    with open(CATALOG_OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    with_skills = sum(1 for e in cat["entries"] if e["skills"])
    print(f"目录 {len(cat['entries'])} 人（有技能 {with_skills}），技能图标 {len(cat['icons'])} 个，缺 {len(missing_icons)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
