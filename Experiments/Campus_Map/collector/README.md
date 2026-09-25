# BevoTag survey collector

A browser app for collecting labeled WiFi fingerprints inside campus buildings (EER for now). You pick
the building and floor, click your spot on the floor plan and type the room number. The ESP32 DAQ module (plugged in over USB) then takes N scans, and each
scan is saved with that label.

Works offline, needs no build step, and keeps the data in the browser until you export it.

## Quick start

1. **Serve it** (Web Serial only works on `localhost`/https, in **desktop Chrome or Edge**):
   ```bash
   cd Experiments/Campus_Map/collector
   python3 -m http.server 8000
   ```
   Then open <http://localhost:8000>.
2. Click **Connect ESP32** and pick the board's port. To try things without hardware, click **Simulator**.

## Collecting

1. Pick the building and floor tab, then **click where the DAQ module is** (drag to pan, scroll or pinch to zoom).
2. Type the **room number** as printed on the plan, e.g. `2.610`. Corridors have numbers too (e.g. `2.817`).
3. Set **scans per point** (5 is a reasonable start), then press **Collect** (or Enter in the room box).
4. Move and repeat. Aim for **several points per room** (corners and center) rather than many scans at one spot.
   Room-level accuracy depends on covering the whole room.

- **Undo last point** removes the last batch. The ✕ in the room table deletes a whole room.
- Clicking a room row jumps to it on the map.
- Data is saved in the browser (IndexedDB) after every scan, so a reload or crash won't lose it.
  It is **per browser, per laptop**, so **export JSON at the end of every session**.
  **Import JSON** merges files from several laptops (duplicates are skipped).

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

**JSON export** (`schema: bevotag.survey.v2`): the file carries a copy of each used `building.json`
(`buildings`) plus one record per scan:
```json
{ "id": "…", "batch": "…", "session": "…", "t": "2026-09-25T15:02:11.512Z",
  "building": "EER", "floor": "5", "room": "5.100",
  "x_px": 1087, "y_px": 2645, "x_ft": 139.1, "y_ft": 338.6, "fx_ft": 100.5, "fy_ft": 10.3,
  "note": "", "operator": "lish",
  "device": { "mac": "a0:b1:…", "fw": "0.1.0", "chip": "ESP32-C6", "sim": false },
  "scan": { "id": 17, "seq": 42, "ms": 123456, "dur_ms": 2140,
            "aps": [ { "bssid": "70:10:5c:aa:bb:01", "ssid": "utexas", "rssi": -58, "ch": 6 } ] } }
```
**CSV export** is long format, one row per (scan, BSSID), ready for pandas:
`df.pivot_table(index="sample_id", columns="bssid", values="rssi")` gives the fingerprint matrix.

v1 files (no `buildings`, no `fx_ft`/`fy_ft`) still import.

**Coordinates.** Three levels, each derived from the one before:

| Fields | Frame | Status |
|---|---|---|
| `x_px`, `y_px` | pixel on that floor's image, origin top-left, y down | raw click, always stored |
| `x_ft`, `y_ft` | same, in feet (`px × ft_per_in / dpi`) | always valid |
| `fx_ft`, `fy_ft` | building frame: shared by all floors, y up | `null` for unregistered floors |

The building frame is computed at export time from the current `building.json`, so registering
a floor later also fixes data that's already been collected. Next step (not built yet): a per-building
`georef` (origin lat/long + rotation) to turn the building frame into lat/long.

EER specifics:

- **Scale is real.** The PDF is vector CAD output. At the stated scale, the tower (floors 4–8) measures
  265–267 ft wide; the EER footprint in OpenStreetMap is 265.8 ft. So distances within a floor are good to ~0.5%.
- **Floors 4–8 are registered.** Their outlines sit at the same place on each sheet. The frame origin is
  the lower-left corner of the tower's outer walls, x right and y up on the sheet. (OSM shows the building about 5° off
  true north; the sheet's exact rotation hasn't been measured.)
- **B, 1, 2 and 3 aren't registered yet.** They're placed differently on their sheets and need lining
  up with the tower (e.g. on the stair/elevator cores). Room labels are the ground truth for now.

Records from the simulator have `device.sim: true`. Filter them out before training.

## Device protocol

See [PROTOCOL.md](PROTOCOL.md): newline-delimited JSON at 115200 baud, `{"cmd":"scan"}` → `{"type":"scan","aps":[…]}`.
It includes a minimal Arduino sketch the DAQ team can start from.

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
