# BevoTag survey collector

A browser app for collecting labeled WiFi fingerprints inside campus buildings (EER for now). You pick
the building and floor, click your spot on the floor plan and type the room number. The ESP32 DAQ module (plugged in over USB) then takes N scans, and each
scan is saved with that label.

**Everything the device sends is logged raw to a CSV file on your laptop**: WiFi scans, IMU readings, CSI,
debug prints, anything. Lines aren't checked against a format, so the firmware can send new kinds of data
without any app changes.

Works offline and needs no build step.

## Quick start

1. **Serve it** (Web Serial only works on `localhost`/https, in **desktop Chrome or Edge**):
   ```bash
   cd Experiments/Campus_Map/collector
   python3 -m http.server 8000
   ```
   Then open <http://localhost:8000>.
2. Click **Connect ESP32** and pick the board's port. To try things without hardware, click **Simulator**
   (it also sends fake IMU lines at 10 Hz).
3. Click **Start CSV log…** and choose where to save the file. Collect stays disabled until a log is running.

## Collecting

1. Pick the building and floor tab, then **click where the DAQ module is** (drag to pan, scroll or pinch to zoom).
2. Type the **room number** as printed on the plan, e.g. `2.610`. Corridors have numbers too (e.g. `2.817`).
3. Set **scans per point** (5 is a reasonable start), then press **Collect** (or Enter in the room box).
4. Move and repeat. Aim for **several points per room** (corners and center) rather than many scans at one spot.
   Room-level accuracy depends on covering the whole room.

- **Discard last point** marks the last batch as bad (see *Data format*). Rows are never deleted from the CSV.
- Clicking a room row jumps to it on the map. The room table and map dots only show this page session; the CSV is the record.
- **Stop CSV log** closes the file. Start a new log for each session; each file starts with its own header.

## Buildings

Each building is a folder of data. Adding one needs no code changes:

```
buildings/
  index.json              ["EER", ...]  which buildings the app offers
  EER/
    building.json         floors, scale, coordinate frame
    plan.pdf              source floor plans, one page per floor
    floors/B.png, 1.png…  rendered by make_floors.py
```

To add a building `XYZ`:
1. Put its floor-plan PDF at `buildings/XYZ/plan.pdf` and check the drawing scale printed on it.
2. Copy `EER/building.json` to `XYZ/building.json`. Set `id`, `name`, `plan.ft_per_in`
   (feet per drawing inch: 32 for 1/32" = 1'-0", 16 for 1/16"…), and one entry per floor with its
   PDF `page` and `image` path. Set each floor's `to_frame` to `null` until it's registered.
3. `pip install pymupdf && python make_floors.py XYZ` renders the PNGs.
4. Add `"XYZ"` to `buildings/index.json`.
5. Optional: set each floor's `fit` box (`[x0, y0, x1, y1]` in image px) so "fit" skips the sheet margins.

`building.json` fields:

| Field | Meaning |
|---|---|
| `plan.dpi`, `plan.ft_per_in` | render resolution and drawing scale; sheet feet per px = `ft_per_in / dpi` |
| `floors[].page` | 1-based PDF page for that floor |
| `floors[].to_frame` | affine `[a, b, c, d, e, f]` from image px to the building frame in ft: `X = a·x + b·y + c`, `Y = d·x + e·y + f`. `null` = not registered yet |
| `frame` | human description of the building frame (origin, axes) |
| `default_floor`, `osm_way` | optional: floor shown first, OpenStreetMap footprint id |

## Data format

One CSV file per logging session. **One row per serial line**, in either direction, written as it arrives:

| Column | Meaning |
|---|---|
| `host_time` | laptop time (ISO, UTC) when the line arrived or was sent |
| `session` | id of this page session |
| `building`, `floor`, `room`, `x_px`, `y_px`, `x_ft`, `y_ft`, `fx_ft`, `fy_ft` | location at that moment (see *Coordinates*) |
| `operator`, `note` | from the Location card |
| `collecting` | `1` while Collect is running: the location is the clicked point for that batch. `0` otherwise: the location is just whatever was last selected, so don't treat it as a label |
| `batch` | id of the point being collected (empty when `collecting` = 0) |
| `dir` | `in` device → laptop, `out` laptop → device, `app` a note from the app (discard) |
| `type` | the `"type"` (or `"cmd"`) field if the line is JSON, else empty. Only a convenience, nothing is filtered on it |
| `line` | the raw line, exactly as received |

Rows are committed to the file every 2 s, so a crash loses at most the last 2 s.
Without the File System Access API (Firefox, Safari: only the simulator works there anyway) the
log is kept in memory and downloaded when you press Stop.

**Discards.** The file is append-only. **Discard last point** writes a row with `type` = `discard` and
that point's `batch`; drop every row with that batch.

**Loading in pandas** (several files from several laptops just concatenate):
```python
import glob, json
import pandas as pd

df = pd.concat([pd.read_csv(f, dtype={"floor": str, "room": str}) for f in glob.glob("bevotag_*.csv")],
               ignore_index=True)
bad = set(df.loc[df.type == "discard", "batch"])
lab = df[(df.collecting == 1) & (df.dir == "in") & ~df.batch.isin(bad)]

# WiFi fingerprints: one row per scan, one column per BSSID
scans = lab[lab.type == "scan"]
aps = [dict(sample=i, floor=r.floor, room=r.room, **a)
       for i, r in scans.iterrows() for a in json.loads(r.line)["aps"]]
fp = pd.DataFrame(aps).pivot_table(index=["sample", "floor", "room"], columns="bssid", values="rssi")

# IMU (or any other JSON type): one column per field the firmware sends
imu_rows = df[df.type == "imu"]
imu = imu_rows[["host_time", "room", "collecting", "batch"]].join(
    pd.json_normalize(imu_rows.line.map(json.loads).tolist()).set_index(imu_rows.index))
```
Lines that aren't JSON (plain-text debug output, a CSV-style IMU format…) are in `line` as is;
parse them however the firmware formats them.

**Coordinates.** Three levels, each derived from the one before:

| Fields | Frame | Status |
|---|---|---|
| `x_px`, `y_px` | pixel on that floor's image, origin top-left, y down | raw click, always stored |
| `x_ft`, `y_ft` | same, in feet (`px × ft_per_in / dpi`) | always valid |
| `fx_ft`, `fy_ft` | building frame: shared by all floors, y up | empty for unregistered floors |

The building frame is computed when the row is written. If a floor's registration changes later,
recompute it from `x_px`, `y_px` and the new `to_frame` in `building.json`. Next step (not built yet): a per-building
`georef` (origin lat/long + rotation) to turn the building frame into lat/long.

**EER frame:** origin at the lower-left corner of the tower's outer walls, x right and y up on the
sheet. All floors (B–8) are registered.

### EER geometry verification (2026-09-25)

Checked against independent sources. The PDF is vector CAD output, so it can be measured directly.

| What | Source | Result |
|---|---|---|
| Scale | Column grid in the PDF | 11 bays of **21.00 ft** (±0.01) and an 18.00 ft bay: the sheets are at true 1/32" scale (±0.05%) |
| Scale | Satellite imagery (Esri World Imagery), floor 4 outline fitted with free scale | 1.005 (0.5% off), outline RMS 0.6 ft |
| Scale | OpenStreetMap footprint (way 516282867) | overall width 265.8 ft vs 266–268 ft on the plan; edge fit 1.02 (OSM trace is coarse) |
| Scale | TxGIO statewide footprints (2017 imagery) | edge fit ~1.05; the coarsest source, least weight |
| Rotation | imagery / OSM / TxGIO | 4.96° / 4.83° / ~5.0°: sheet up points about **5° east of true north** |
| Floor registration | Structural columns matched floor to floor | floors 4–8 identical placement; B, 1, 2, 3 shifted by (−21.64, −19.32), (−20.31, −103.91), (−7.88, −65.90), (−7.87, −65.90) ft; residual ~0.01 ft |
| Registration cross-check | floor outlines; loop closure (B→1→2→4 vs B→4) | agree within 0.4 ft (outline) and 0.04 ft (loop) |
| App pipeline | the same column clicked on floors B, 1, 2, 3, 5, 7 vs floor 4, through the app's own click handling | same building-frame position within **0.09 ft** (36 columns) |
| Absolute position | frame origin placed via OSM vs via imagery | 7.7 ft apart: lat/long is good to roughly ±10 ft |

Takeaways: distances within and across floors are reliable to about an inch plus click precision.
Latitude/longitude isn't wired into the app yet; from the fits above, the frame origin is near
30.28805 N, 97.73577 W with sheet-up ≈ 5° east of north (±10 ft, ±0.2°).

Logs made with the simulator have a `hello` row with `"chip":"SIMULATOR"`. Don't train on them.

## Device protocol

See [PROTOCOL.md](PROTOCOL.md): newline-delimited JSON at 115200 baud, `{"cmd":"scan"}` → `{"type":"scan","aps":[…]}`.
It includes a minimal Arduino sketch the DAQ team can start from. The app only needs `hello` and `scan`
to be in that format (for Collect and the last-scan table). Anything else the firmware prints is logged as is.

## Floor plans

`buildings/EER/plan.pdf` is UT's EER floor-plan set (Basement + floors 1–8, one page each).
The PNGs are rendered from it and committed, so the app works right after cloning.
If a PDF changes, re-render with `python make_floors.py <ID>`.

## Files

| File | What |
|---|---|
| `index.html`, `style.css`, `app.js` | the app (plain JS, no dependencies) |
| `PROTOCOL.md` | serial contract with the DAQ module |
| `buildings/` | one folder per building (see *Buildings*) |
| `make_floors.py` | `building.json` + PDF → floor PNGs |
