# EER survey collector

A browser app for collecting labeled WiFi fingerprints in EER. You pick your spot on the floor plan
and type the room number. The ESP32 DAQ module (plugged in over USB) then takes N scans, and each
scan is saved with that label.

Works offline, needs no build step, and keeps the data in the browser until you export it.

## Quick start

1. **Floor plans** (one time). The PNGs aren't committed (see *Floor plans* below). Render them from the UT PDF:
   ```bash
   ./make_floors.sh "path/to/EER Floor Plan.pdf"     # needs poppler: apt/brew install poppler
   ```
2. **Serve it** (Web Serial only works on `localhost`/https, in **desktop Chrome or Edge**):
   ```bash
   cd Experiments/Campus_Map/collector
   python3 -m http.server 8000
   ```
   Then open <http://localhost:8000>.
3. Click **Connect ESP32** and pick the board's port. To try things without hardware, click **Simulator**.

## Collecting

1. Pick the floor tab, then **click where the DAQ module is** (drag to pan, scroll or pinch to zoom).
2. Type the **room number** as printed on the plan, e.g. `2.610`. Corridors have numbers too (e.g. `2.817`).
3. Set **scans per point** (5 is a reasonable start), then press **Collect** (or Enter in the room box).
4. Move and repeat. Aim for **several points per room** (corners and center) rather than many scans at one spot.
   Room-level accuracy depends on covering the whole room.

- **Undo last point** removes the last batch. The ✕ in the room table deletes a whole room.
- Clicking a room row jumps to it on the map.
- Data is saved in the browser (IndexedDB) after every scan, so a reload or crash won't lose it.
  It is **per browser, per laptop**, so **export JSON at the end of every session**.
  **Import JSON** merges files from several laptops (duplicates are skipped).

## Data format

**JSON export** (`schema: bevotag.survey.v1`): one record per scan:
```json
{ "id": "…", "batch": "…", "session": "…", "t": "2026-09-25T15:02:11.512Z",
  "building": "EER", "floor": "2", "room": "2.610",
  "x_ft": 139.1, "y_ft": 338.6, "x_px": 1087, "y_px": 2645,
  "note": "", "operator": "lish",
  "device": { "mac": "a0:b1:…", "fw": "0.1.0", "chip": "ESP32-C6", "sim": false },
  "scan": { "id": 17, "seq": 42, "ms": 123456, "dur_ms": 2140,
            "aps": [ { "bssid": "70:10:5c:aa:bb:01", "ssid": "utexas", "rssi": -58, "ch": 6 } ] } }
```
**CSV export** is long format, one row per (scan, BSSID), ready for pandas:
`df.pivot_table(index="sample_id", columns="bssid", values="rssi")` gives the fingerprint matrix.

**Coordinates:** `x_ft`/`y_ft` are measured from the top-left of that floor's PDF sheet
(1/32" = 1'-0", rendered at 250 dpi → 0.128 ft/px). Sheets are **not yet aligned to each other or
to lat/long**. That's a later step for the 3D map (control points per floor). Room labels are the
ground truth for now.

Records from the simulator have `device.sim: true`. Filter them out before training.

## Device protocol

See [PROTOCOL.md](PROTOCOL.md): newline-delimited JSON at 115200 baud, `{"cmd":"scan"}` → `{"type":"scan","aps":[…]}`.
It includes a minimal Arduino sketch the DAQ team can start from.

## Floor plans

`floors/*.png` are rendered from UT's EER floor-plan PDF (Basement + floors 1–8) and are
git-ignored because this repo is public. Check whether UT is OK with publishing them before committing them.

## Files

| File | What |
|---|---|
| `index.html`, `style.css`, `app.js` | the app (plain JS, no dependencies) |
| `PROTOCOL.md` | serial contract with the DAQ module |
| `make_floors.sh` | PDF → `floors/EER_<B,1..8>.png` |
