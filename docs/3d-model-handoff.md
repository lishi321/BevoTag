# BevoTag 3D DAQ workspace — handoff

Updated **2026-10-21**. The user wants a 3D DAQ webapp with signal-strength visualization and
position estimation, using **CAD-like room and wall geometry with empty interiors**. They asked
to work on branch **`3d-model`**, without a `codex/` prefix, and will transfer to ChatGPT Work
when shutting down this computer. This pass improves the earlier model with more source evidence,
targeted geometry corrections, and IFC export. It has not yet been merged to `main`.

Read [current status and limitations](3d-model-status.md), the
[height-source audit](floor-height-sources.md), and the [CAD source review](cad-source-review.md)
before extending the model. It is reconstructed geometry, not verified as-built CAD or a native
parametric architectural authoring model. Positioning accuracy remains unmeasured.

## Repository and transfer

- Checkout: `C:\Users\lishi\Code\BevoTag`. Current development branch: `3d-model`; eventual
  integration target: `main`. Inspect `git status` and `git log -1` for the transferred checkpoint.
  Do not assume this source-review pass is already on `main`.
- Original feature base: `1dddf550a24fbe1fb16952fea1b584c871a80970`. Earlier feature integration
  does not establish that the current changes are committed or pushed.
- Preserve unrelated untracked `.claude/` content and exclude it from feature commits.
- No cloud task, hosted deployment, or ChatGPT Work session was created. The earlier CLI cloud
  environment picker returned no configured environments. A cloud worker needs repository access
  and the latest pushed checkpoint; local scratch files are not transferred automatically.

## Implemented

The app in `Experiments/Campus_Map/collector/` is buildless HTML/JS served over local HTTP.

- `index.html`, `studio.css`, `studio.mjs`: 3D/2D toggle, building/floor controls, CSV import,
  signal layers, height/source evidence, demo and recorded/device position queries, IFC/OBJ downloads.
- `model-view.mjs`: local Three.js renderer, wall solids and selectable room surfaces, reference
  overlay, orbit/zoom, top/perspective/fit, floor isolation, RSSI heatmaps/markers, estimate and
  matched-neighbor display, and picking synchronized with the original 2D collector. Rebuilds
  dispose GPU resources; stale image loads cannot replace the current building.
- `build_architecture.py`, `buildings/*/architecture.json`: vector-PDF reconstruction with paired
  wall faces, inferred openings, enclosed-space polygons/holes, OCR labels and source hashes.
  Virtual door closures define regions and are never physical walls. PDF display rotation is now
  applied before clipping/projection, repairing ECJ level 4's 270-degree page mismatch.
- `architecture_review.py`, `buildings/EER/geometry-review.json`: reproducible masks and one
  reviewed added space tied to the exact source PDF hash and pages. EER level 3 skylight/truss
  projections, level 6's false atrium floor, and level 8 roof-member projections are removed from
  room/wall geometry. The page 7 west bridge is restored from actual inner wall faces/endpoints,
  clipped against reconstructed walls, and labeled `plan-review`. Other floors are preserved.
  Review hashes, citations, reasons and correction statistics are retained in the asset.
- `architecture.mjs`, `architecture-geometry.mjs`: geometry validation, containment, mesh generation
  and **OBJ export in feet**, using building X/Y and Z up, with named objects and evidence comments.
- `architecture-ifc.mjs`: **IFC4 export in metres**, with project/building/storey hierarchy, analytic
  wall extrusions with profile holes, and footprint-only `IfcSpace` boundary curves. No room volume,
  slab thickness, ceiling/opening height or material is inferred. Evidence/status accompany geometry;
  only documented levels receive semantic IFC `Elevation`. Unknown and estimated storey placements
  remain explicitly unverified. Both exports omit visual separation, signals and reference textures.
- `vertical-model.mjs` and building metadata: **11 documented historical ECJ levels, 1 ECJ estimate,
  and 19 unknown levels** overall. ECJ normalizes record levels by subtracting Level 1 EL 552 ft.
  Level 6 is +72 ft **estimated**, because its printed elevation tag contradicts the dimension chain.
  ECJ SB/11M/R and every EER/ASE level remain unknown. Unknown display placement interpolates
  between entered levels or uses the default 14 ft step from an anchor. Wall extrusion defaults
  to an assumed 10 ft; visual separation defaults to 1× and never changes model coordinates.
- `signal-model.mjs`: affine transforms, CSV parser/filtering, repeated-point averaging, bounded
  RSSI interpolation, weighted-neighbor fingerprint estimation, and deterministic synthetic demos.
  Queries never enter their own training set. Estimates predict floor plus horizontal X/Y, not
  continuous measured Z; room containment does not constrain the estimate.
- `vendor/`: local Three.js 0.180.0 and OrbitControls with MIT license. No CDN or npm build required.
- `app.js`: one-shot `probe()`, collection/localization exclusion, signed-32-bit serial request IDs,
  stale-reply rejection, AP normalization, simulator session identity, and retry-safe CSV stopping.
  Failed writes preserve rows; stopping seals admission so late scans remain raw/unlabeled.
- `Experiments/DAQ_Module/ESP Firmware/src/main.cpp`: firmware 0.2.0 returns a full scan per request;
  `strongest` is a one-shot diagnostic. `platformio.ini` pins Espressif32 8.0.0. Inactive CSI experiment
  comments remain untouched.

Current checked-in asset inventory:

| Building | Levels | Wall polygons | Space polygons |
| --- | ---: | ---: | ---: |
| EER | 9 | 1,109 | 804 |
| ECJ | 15 | 638 | 569 |
| ASE | 7 | 105 | 178 |
| Total | 31 | 1,852 | 1,551 |

The **3,403 polygons** are reconstructed connected regions, not certified architectural object
counts. ECJ level 4 now has 78 wall and 50 space polygons. No furniture/interior detail was added.

## Evidence that must remain explicit

- ECJ elevations are historical record-drawing evidence reproduced in Sarlo (2018), Appendix C,
  PDF pages 189–191. Original survey datum and finished-floor versus structural-slab interpretation
  remain unspecified. Do not silently promote level 6's estimate to documented.
- EER's AISC/UT sources corroborate atrium/skylight context; they do not establish floor heights.
  The bridge outline and exclusion masks come from reviewed local plan linework, not proportional
  guesses from the published 150 by 70 ft skylight. Level 8's excluded band contains unmodeled
  roof structure, rather than being certified empty air.
- Registered renovation projects may supersede partitions: ECJ Levels 7–8 and parts of 9–11,
  an EER library-to-office area, and an ASE classroom split. Replacement layouts were not recovered.
  Notices and scheduled dates do not prove installed geometry or construction completion.
- The approximate 175 ft ECJ overall-height context does not define the model roof elevation.
  Its roof sheet contains surfaces that need separate identification, not one sourced flat plane.

## Verification checkpoint

This pass passed **47 Node tests and 9 Python tests**, covering registrations, polygon containment/
triangulation, source hashes, rotation, source-bound EER exclusions/bridge preservation, elevation
provenance, export geometry/units/hierarchy, and collection/import/estimation behavior. An actual
EER level 6 generator diagnostic run successfully applied the review and added the bridge.

IfcOpenShell 0.9.0.post1 parsed all three IFC4 exports with zero EXPRESS/schema errors and tessellated
all **1,852 wall solids**. Each wall volume matched its polygon area times the assumed 10 ft height
after metre conversion. Unicode, apostrophe, backslash and newline text round-tripped. Verification
was repeated after geometry-review property sets were corrected. No manual Revit/FreeCAD import was
performed; intended downstream application support and physical accuracy remain separate checks.

Browser checks verified ECJ level 4's 50 spaces/78 walls/+44 ft documented elevation, level 6's
conflict note, and unknown-step controls without changing documented levels. With a 6 ft display
step, unknown SB/11M/R became −22/+148/+154 ft, explicitly schematic. EER's west bridge marker
aligned with the original 2D plan, a demo estimated EER level 6, and the IFC button downloaded
without console errors. A 390 px layout had no horizontal overflow.

Earlier firmware compilation succeeded for `esp32dev` with PlatformIO 6.2.0, Espressif32 8.0.0 and
Arduino-ESP32 3.3.12 (RAM 45,704 bytes; flash 925,052 bytes). No board was flashed. Compilation and
synthetic/browser checks do not establish real-device behavior or measured positioning accuracy.

## Run and regenerate

From the repository root:

```sh
cd Experiments/Campus_Map/collector
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000` in desktop Chrome/Edge for Web Serial. **Explore demo** needs no hardware.
3D requires WebGL 2; the existing 2D collector, imports and estimate results remain available if it fails.

```sh
# Collector directory, Node 20+, no npm installation
node --test tests/*.test.mjs

# Python geometry tests; use the extraction dependencies listed in the collector README
python -m unittest discover -s tests -p "test_*.py"

# Optional offline regeneration; use scratch paths outside committed runtime assets
python build_architecture.py --ocr --ocr-cache /path/to/label-cache --preview-dir /path/to/previews

# Firmware directory, with PlatformIO installed
python -m platformio run -e esp32dev
```

Inspect previews before accepting regeneration. Full runs replace runtime assets; `--floor` runs
produce diagnostic output only. Review masks are applied automatically when `geometry-review.json`
exists. A source-hash mismatch must be re-reviewed; do not bypass it. Preserve OCR labels by using
`--ocr`, and clear the OCR cache when source PDF or registration changes.

Local tools live below
`C:\Users\lishi\.codex\visualizations\2026\10\21\01a15cb6-2cec-7071-bfaf-dd0ee57b44f7`.
Python geometry dependencies use `cad-python`; PlatformIO uses `pio-python` and `pio-core`.
These are computer-specific scratch paths. Install the needed tools anew in cloud work; do not
commit environment folders, diagnostic images, or firmware `.pio/` output.

## Remaining work

1. Obtain current dimensioned drawings/BIM or measurements. Resolve EER/ASE elevations, ECJ level 6's
   tag conflict, SB/11M/roof surfaces, and slab/finished-floor/datum references. Verify wall heights.
2. Audit remaining room boundaries, openings, labels, bridge/atrium geometry and renovation changes.
   ASE 1.102 still shares a region with circulation labels. No native parametric editor, architectural
   constraints, STEP export or GLB/OBJ/STEP/IFC import is implemented.
3. Bench-test physical DAQ hardware: flash the chosen board, repeat full scans, collect/save/reopen
   actual CSVs, reconnect and localize. Native browser file-picker/USB behavior remains untested on hardware.
4. Measure positioning accuracy with independent held-out surveys. Neighbor spread and floor support
   are descriptive, not calibrated uncertainty. No wall constraints/propagation, continuous Z,
   temporal tracking or IMU/CSI fusion is implemented.
5. Preserve the data lifecycle: model samples are page-memory only; CSV is durable. Simulator markers
   exclude whole sessions, but old identity-free logs cannot reliably be classified. Use fresh sessions.
6. The separate Python AP-estimation script was not changed. Firmware command handling still uses
   existing bench-sketch string matching; full JSON command validation is a separate task.

## Suggested continuation prompt

> Continue BevoTag from the latest pushed `3d-model` checkpoint unless it has subsequently been merged.
> Inspect Git state and read `docs/3d-model-status.md`, `docs/3d-model-handoff.md`, the collector README,
> `docs/floor-height-sources.md`, and `docs/cad-source-review.md`. Preserve ECJ elevation provenance and
> the source-bound EER review masks/bridge. Run current Node and Python tests, inspect geometry against
> source plans, and validate IFC in the target tool before claiming interoperability. Work on the remaining
> refinements requested. Preserve 2D collection and synthetic/real data separation, and distinguish
> reconstructed geometry, unknown dimensions and unmeasured positioning accuracy. Do not deploy a website.
