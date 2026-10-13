"""Render a building's floor-plan PDF into the per-floor PNGs the app loads.

Reads buildings/<ID>/building.json: plan.pdf, plan.dpi, and each floor's page and image path.
    pip install pymupdf
    python make_floors.py EER
"""
import json
import sys
from pathlib import Path

import pymupdf

# The UT sheets draw thin light-grey lines (~204/255) that wash out when the map is zoomed out.
# Darken the ink without moving any pixels; >1 darkens, 1 leaves the render as is.
INK_GAMMA = 6

if len(sys.argv) != 2:
    sys.exit("usage: python make_floors.py <BUILDING_ID>")

bdir = Path(__file__).resolve().parent / "buildings" / sys.argv[1]
cfg = json.loads((bdir / "building.json").read_text(encoding="utf-8"))
doc = pymupdf.open(bdir / cfg["plan"]["pdf"])

for floor in cfg["floors"]:
    page = doc[floor["page"] - 1]  # pages are 1-based in building.json
    pix = page.get_pixmap(dpi=cfg["plan"]["dpi"], colorspace=pymupdf.csGRAY)
    pix.gamma_with(INK_GAMMA)
    out = bdir / floor["image"]
    out.parent.mkdir(parents=True, exist_ok=True)
    pix.save(out)
    print(f"{cfg['id']} floor {floor['id']}: page {floor['page']} -> {out.relative_to(bdir)} ({pix.width}x{pix.height})")
