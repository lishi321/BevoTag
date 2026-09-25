"""Render the EER floor-plan PDF (9 pages: Basement, 1-8) into floors/EER_<floor>.png.

The PNGs are committed, so you only need this if the PDF changes.
    pip install pymupdf
    python make_floors.py [path/to/plan.pdf]      # default: plans/EER_floor_plan.pdf

DPI must match PLAN_DPI in app.js (x/y in feet depend on it).
"""
import sys
from pathlib import Path

import pymupdf

DPI = 250
FLOORS = ["B", "1", "2", "3", "4", "5", "6", "7", "8"]  # PDF page order

here = Path(__file__).resolve().parent
pdf = Path(sys.argv[1]) if len(sys.argv) > 1 else here / "plans" / "EER_floor_plan.pdf"
doc = pymupdf.open(pdf)
if doc.page_count != len(FLOORS):
    sys.exit(f"expected {len(FLOORS)} pages, got {doc.page_count}")

out = here / "floors"
out.mkdir(exist_ok=True)
for page, floor in zip(doc, FLOORS):
    pix = page.get_pixmap(dpi=DPI, colorspace=pymupdf.csGRAY)
    path = out / f"EER_{floor}.png"
    pix.save(path)
    print(f"{path.name}: {pix.width}x{pix.height}")
