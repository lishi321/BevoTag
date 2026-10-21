# BevoTag 3D DAQ workspace — handoff

Updated 2026-10-21. The user requested a 3D DAQ webapp with signal-strength visualization and position
estimation, on branch **`3d-model`**, explicitly without a `codex/` prefix. They chose to continue local
development and will switch to ChatGPT Work when shutting down the computer.
They clarified that the model must be **CAD-like at room and wall level, with empty interiors**.
That geometry is now implemented; the original textured-plan-only view has been replaced.

## Repository and transfer

- Local checkout: `C:\Users\lishi\Code\BevoTag`, branch `3d-model`.
- Base: `origin/main` at `1dddf550a24fbe1fb16952fea1b584c871a80970`.
- Work is local; no cloud task or deployment was created and the branch has not been pushed. Inspect
  `git status` and `git log -1` for the final local checkpoint. A cloud session needs the branch pushed
  or the changed files transferred before it can continue. This document alone does not carry the code.
- Existing untracked `.claude/` content is unrelated and must be preserved/excluded from this feature.
- The earlier Codex CLI cloud-environment picker returned no configured environments. ChatGPT Work
  was not started. Continue in this repository; hosting a new Site is outside the requested scope.

## Implemented

The app in `Experiments/Campus_Map/collector/` remains buildless HTML/JS and works from a local HTTP server.

- `index.html`, `studio.css`, `studio.mjs`: 3D/2D workspace toggle, building/floor controls, CSV import,
  source/BSSID selection, layers, height evidence, demo and recorded/device query estimation.
- `model-view.mjs`: local Three.js renderer, extruded walls and selectable room surfaces for all
  31 registered floors across EER/ASE/ECJ, optional reference-plan overlay,
  orbit/zoom, top/perspective/fit, active-floor isolation, RSSI heatmaps and markers, estimate marker,
  matched-neighbor links/spread, and double-click picking synchronized to the original 2D collector.
  GPU resources are disposed on rebuild; stale image loads cannot overwrite a newer building.
- `build_architecture.py`, `buildings/*/architecture.json`: offline reconstruction from the existing
  vector PDFs, with paired wall faces, inferred openings, enclosed-space polygons/holes, local OCR
  room labels and source PDF hashes. There are 3,348 valid wall/room polygons across all 31 floors.
  Virtual door closures define regions but are not physical wall meshes. Some boundaries/labels
  remain ambiguous. No furniture/interior assets were added.
- `architecture.mjs`, `architecture-geometry.mjs`: model validation, room containment, mesh generation
  and OBJ export. Export is building X/Y, Z-up, feet. Unknown floor coordinates and wall heights
  remain schematic; elevation status and research sources are included in comments. Visual separation
  is excluded. This is polygonal mesh geometry, not a parametric CAD/BIM editor.
- `vertical-model.mjs`, building `vertical` metadata and [floor-height source audit](floor-height-sources.md):
  all 31 elevations remain unknown after public-source research. UI separates actual elevation status
  from schematic model Z, links evidence, and defaults to 1× visual separation. Explicit floor values
  need a resolved citation and declared status to be documented or estimated; uncited values remain
  unverified. ECJ's approximate 175 ft overall-height context is never used as a floor elevation.
- Building model UI: walls/rooms/reference toggles; room selection/highlight/area; focus room; place
  an interior DAQ point; adjustable schematic wall height (10 ft default); OBJ download. Position results now
  report the containing model space separately from the nearest survey label. Heatmaps are clipped
  to resolved spaces; synthetic samples are placed inside rooms.
- `signal-model.mjs`: affine transforms/inverse, CSV parser/import filters, repeated-point averaging,
  bounded inverse-distance RSSI interpolation, weighted-neighbor fingerprint estimator and deterministic
  demo generation. Query scans never enter the training set.
- `vendor/`: Three.js 0.180.0 runtime and OrbitControls from official npm, with MIT license. Vendor edits
  are OrbitControls' relative import and one normalized indent. No CDN, framework or npm build is required.
- `app.js`: one-shot `probe()`, collection/localization mutual exclusion, serial request IDs fitting
  ESP32 signed 32-bit integers, rejection of stale replies/errors, stricter AP normalization, simulator
  identity metadata at log start, and safe CSV stop/retry behavior. Failed final writes preserve rows
  and keep logging open. Stop seals admission before flushing; late scan replies are raw/unlabeled.
- `Experiments/DAQ_Module/ESP Firmware/src/main.cpp`: firmware 0.2.0 restores one complete `scan` reply
  per request instead of an endless strongest-AP loop; SSID controls are escaped. The optional `strongest`
  command remains a one-shot diagnostic. Existing inactive CSI experiment comments remain untouched.
- Firmware `platformio.ini` pins the successfully compiled Espressif32 platform to 8.0.0.
- Usage, algorithm limits, import rules, license provenance and test instructions are documented in
  the collector README, PROTOCOL, vendor README and tests README.

## Validation completed

- `node --test tests/*.test.mjs`: **35/35 passed**. Tests exercise all 31 registration round-trips,
  demo queries on every floor, sparse/novel fingerprints, floor voting without cross-floor coordinate
  averaging, CSV quoting/corruption, session-scoped discards, simulator exclusions, deduplication,
  averaging, heatmap support, disk-write failures, recording cutoff, and query/collection separation.
  New geometry tests cover source hashes, floor/page coverage, containment/holes, triangulation area
  across every polygon, wall volume, OBJ axes and model heights, and room-based synthetic samples.
  Elevation tests cover datum validity, evidence resolution, missing/invalid values, source estimates,
  all 31 unknown real levels, and independence of documented elevations from display spacing.
  OBJ tests verify uncertainty and source comments; ECJ's overall-height context cannot set floor Z.
  A separate Shapely audit confirmed all 3,348 serialized polygons are valid after precision repair.
- Browser: all three buildings render; synthetic signals and estimates work; a controlled CSV fixture
  accepted 3 points and excluded its discarded fourth point; a pasted matching query produced the
  expected EER floor and finite coordinates. Double-click picking in 3D matched the 2D marker and
  location fields. Narrow layouts were inspected and the building selector was fixed to remain readable.
  CAD checks: all three buildings render; EER room 2.610 and ASE room 1.108 place matching 2D/3D DAQ
  points; reference overlay aligns; wall-height changes/full-building view work; EER OBJ download
  completed (15.7 MB at 12 ft wall height). Synthetic estimates report a containing model space.
  Height revision: verified all three source lists/notes, unknown statuses, 1× default, changed display
  step, separation-independent table coordinates, and narrow layout with no console errors. Fixed stale
  building metadata by requesting cache revalidation. Updated OBJ comments were checked in Node;
  the earlier downloaded EER file predates this revision.
- ESP32 firmware **compiled successfully** for `esp32dev`, with PlatformIO 6.2.0, Espressif32 8.0.0 and
  Arduino-ESP32 3.3.12. Final build: RAM 45,704 bytes (13.9%), flash 925,052 bytes (70.6%). No flashing.
- Tool dependencies were installed in the task scratch directory, not added as project dependencies.
  Build output under the firmware's ignored `.pio/` is local only.

## Run and verify

From repository root:

```sh
cd Experiments/Campus_Map/collector
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000` in desktop Chrome/Edge for Web Serial. Click **Explore demo** for a
hardware-free walkthrough. 3D needs WebGL 2; if initialization fails the app offers the existing 2D
collector, imports and estimate results.

```sh
# In the collector directory; Node 20+; no npm installation
node --test tests/*.test.mjs

# In Experiments/DAQ_Module/ESP Firmware, with PlatformIO installed
python -m platformio run -e esp32dev
```

Local PlatformIO was installed under
`C:\Users\lishi\.codex\visualizations\2026\10\21\01a15cb6-2cec-7071-bfaf-dd0ee57b44f7\pio-python`.
Set `PYTHONPATH` to that folder and `PLATFORMIO_CORE_DIR` to the sibling `pio-core` folder to reuse it.
Those paths are specific to this computer; cloud work should install its own build tools.

## Remaining real-world validation and limits

1. **Physical DAQ bench test:** no board was flashed or connected. Flash with the user's chosen device,
   verify repeated full scans, collect/save/reopen actual CSVs, exercise disconnect/reconnect, and query
   a new position with Device streams scans unchecked. The browser file-writer failure paths were tested
   through a VM harness; native browser save-picker and USB behavior still need a real-device check.
2. **Measured accuracy:** run held-out surveys with the target board/antenna, estimate floor/position,
   and report floor accuracy and horizontal error. Synthetic floor matching is only a functional test.
   There are no calibrated confidence intervals, wall constraints, temporal filtering or IMU/CSI fusion.
3. **Geometry review:** the model contains actual wall solids and room surfaces reconstructed from
   PDFs, not verified as-built geometry. Some short returns/openings are missing; some adjacent rooms
   are merged; OCR labels may be wrong. For example, ASE 1.102 currently shares a reconstructed region
   with circulation labels. Review against Plan reference before adding wall constraints or attenuation.
   Small drawing artifacts may remain. Display placeholders are 10 ft walls and 14 ft between ordered
   levels, including mezzanines; these are not verified dimensions. See `docs/floor-height-sources.md`
   for the evidence and exact ECJ as-built drawing identifier. Obtain dimensioned sections or a BIM
   level schedule, then record `elevation_ft` with `elevation_source` and a consistent datum. No parametric editing or
   GLB/OBJ/STEP/IFC import. Heatmaps interpolate nearby measurements; no wall propagation or position
   snapping is implemented. The room display and OBJ export do not imply measured positioning accuracy.
4. **Data lifecycle:** imports/live samples are page-memory only; CSV is the record. Import only labeled
   real surveys. Any simulator marker excludes that entire session, conservatively; old logs missing
   identity metadata cannot be classified reliably. Use a fresh page/session for real data.
5. The existing separate Python AP-estimation script was not modified; its own filtering behavior is
   unrelated to the new browser importer. The firmware still uses the existing bench-sketch command
   string matching; a fully validated JSON command parser would be a separate hardening task.

## Suggested continuation prompt

> Continue BevoTag on branch `3d-model` (no prefix). Read `docs/3d-model-handoff.md` and the collector
> README first. The 3D signal workspace, CSV import, fingerprint estimates and protocol-compatible
> firmware plus CAD-style room/wall meshes are implemented and locally tested. Verify the transferred
> checkpoint, read `docs/floor-height-sources.md`, rerun the 35 Node
> tests and firmware build, then work on the remaining validation or refinements I request. Preserve
> the 2D collection workflow and synthetic/real data separation. Keep approximate geometry and
> unvalidated positioning accuracy explicit. Do not deploy a hosted website.
