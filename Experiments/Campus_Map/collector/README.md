# BevoTag survey collector

A browser app for collecting labeled data inside campus buildings (EER, ASE, ECJ). You click your spot on
the floor plan and type the room number. The app tells the ESP32 DAQ module, plugged in over USB, to take N
WiFi scans at that spot.

**Every line the device sends is saved raw to a CSV file on your laptop.** That includes WiFi scans, IMU
readings, CSI and debug prints. The app doesn't check the format, so the firmware can send new kinds of
data without app changes.

Plain HTML/JS: no build step, works offline.

## Quick start

1. Serve the folder. Web Serial needs **desktop Chrome or Edge** on `localhost` or https:
   ```bash
   cd Experiments/Campus_Map/collector
   python3 -m http.server 8000
   ```
   Open <http://localhost:8000>.
2. Click **Connect ESP32** and pick the board's port. To try it without hardware, click **Simulator**
   (fake WiFi scans plus fake IMU lines at 10 Hz).
3. Click **Start CSV log…** and choose where to save the file. Collect stays disabled until a log is running.

## Collecting

1. Pick the building and floor, then **click where the DAQ module is**. Drag to pan; scroll or pinch to zoom.
2. Type the **room number** as printed on the plan, e.g. `2.610`. Corridors have numbers too, e.g. `2.817`.
3. Set **scans per point** (5 is a good start) and press **Collect**, or Enter in the room box.
4. Move and repeat. Take **several points per room** (corners and center) rather than many scans at one spot.

- **Discard last point** flags the last point as bad. The CSV is append-only, so this adds a row; see below.
- **Stop CSV log** closes the file. Use one log per session.
- The room table and map dots only show the current page session. The CSV file is the record.

## CSV format

One row per serial line, in both directions, committed to the file every 2 s. A crash loses at most
the last 2 s. Browsers without direct file writing (Firefox, Safari) keep the log in memory and download
it when you press Stop.

| Column | Meaning |
|---|---|
| `host_time` | laptop time (ISO, UTC) |
| `session` | id of the page session |
| `building`, `floor`, `room` | location label |
| `x_px`, `y_px`, `x_ft`, `y_ft`, `fx_ft`, `fy_ft` | position, see [Coordinates](#coordinates) |
| `operator`, `note` | from the Location card |
| `collecting` | `1` during Collect. Only these rows have a trustworthy location: at other times it's just whatever was last selected |
| `batch` | id of the point being collected |
| `dir` | `in` device → laptop · `out` laptop → device · `app` note from the app |
| `type` | the JSON `"type"` (or `"cmd"`) field, empty for non-JSON lines. A convenience only; nothing is filtered on it |
| `line` | the raw line, exactly as received |

**Discarded points:** rows with `type` = `discard` name a `batch`. Drop every row with that batch.
**Simulator logs** contain a `hello` row with `"chip":"SIMULATOR"`. Don't train on them.

### Loading in pandas

Files from several laptops and sessions simply concatenate.

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

# IMU, or any other JSON type: one column per field the firmware sends
imu_rows = df[df.type == "imu"]
imu = imu_rows[["host_time", "room", "collecting", "batch"]].join(
    pd.json_normalize(imu_rows.line.map(json.loads).tolist()).set_index(imu_rows.index))
```

Non-JSON lines are in `line` as is. Parse them however the firmware formats them.

## Coordinates

| Fields | Frame |
|---|---|
| `x_px`, `y_px` | the click: pixel on that floor's image, origin top-left, y down |
| `x_ft`, `y_ft` | the same point in feet (`px × ft_per_in / dpi`, using the floor's `ft_per_in` if it has one) |
| `fx_ft`, `fy_ft` | building frame in feet, shared by all floors, y up. Empty if the floor isn't registered |

`fx_ft`/`fy_ft` are computed when the row is written. If a floor's registration changes later, recompute
them from `x_px`, `y_px` and the floor's new `to_frame`.

**EER:** all floors (B–8) are registered. The origin is the lower-left corner of the tower's outer walls,
x right and y up on the sheet; sheet up is about 5° east of true north. Distances are good to about an
inch plus click precision. See [buildings/EER/VERIFICATION.md](buildings/EER/VERIFICATION.md) for how
this was checked. Not built yet: converting the building frame to latitude/longitude.

**ASE:** all floors (B–6) are registered. The origin is the south-west outer corner of the exterior
walls; sheet up is about 4.5–5° east of true north. Floors B–5 agree to a few hundredths of a foot; the
floor 6 attic to about 0.3 ft. See [buildings/ASE/VERIFICATION.md](buildings/ASE/VERIFICATION.md).

**ECJ:** all floors (SB–11, 11M, roof) are registered. The origin is the south-west outer corner of the
tower's exterior walls; sheet up is about 5° east of true north. Tower floors agree to a few hundredths
of a foot; SB, B and 1 (drawn at 1/32", so they set their own `ft_per_in`) and 11M to about 0.1–0.3 ft.
See [buildings/ECJ/VERIFICATION.md](buildings/ECJ/VERIFICATION.md).

## Device protocol

[PROTOCOL.md](PROTOCOL.md) has the serial contract and a starter Arduino sketch. In short: newline-delimited
JSON at 115200 baud, `{"cmd":"scan"}` → `{"type":"scan","aps":[…]}`. Only `hello`, `scan` and `err` need that
exact format, because Collect and the last-scan table use them. Everything else is just logged.

## Buildings

Each building is a folder of data, and adding one needs no code changes. The floor PNGs are committed,
so the app works right after cloning.

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
| `floors[].ft_per_in` | optional: this sheet's drawing scale when it differs from `plan.ft_per_in` |
| `floors[].to_frame` | affine `[a, b, c, d, e, f]` from image px to the building frame in ft: `X = a·x + b·y + c`, `Y = d·x + e·y + f`. `null` = not registered yet |
| `frame` | human description of the building frame (origin, axes) |
| `default_floor`, `osm_way` | optional: floor shown first, OpenStreetMap footprint id |

## Files

| File | What |
|---|---|
| `index.html`, `style.css`, `app.js` | the app |
| `PROTOCOL.md` | serial contract with the DAQ module |
| `buildings/` | one folder per building: config, floor-plan PDF, rendered PNGs |
| `buildings/*/VERIFICATION.md` | how each building's plan geometry was checked |
| `make_floors.py` | renders a building's PDF into floor PNGs |
