#!/usr/bin/env bash
# Render the UT EER floor-plan PDF (9 pages: Basement, 1-8) into floors/EER_<floor>.png
# Usage: ./make_floors.sh "path/to/EER Floor Plan.pdf"
# Needs poppler-utils (pdftoppm): apt install poppler-utils | brew install poppler
# DPI must match PLAN_DPI in app.js (x/y in feet depend on it).
set -euo pipefail
PDF="${1:?usage: $0 path/to/EER_Floor_Plan.pdf}"
DPI=250
cd "$(dirname "$0")"
mkdir -p floors
pdftoppm -r "$DPI" -gray -png "$PDF" floors/tmp
i=0
for f in B 1 2 3 4 5 6 7 8; do
  i=$((i + 1))
  mv "floors/tmp-$i.png" "floors/EER_$f.png"
done
ls -la floors
