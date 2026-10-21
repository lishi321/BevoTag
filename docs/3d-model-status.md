# 3D DAQ model: completed work, limitations, and estimation

Updated **2026-10-21**. This note accompanies integration of `3d-model` into `main`.

**Current status:** the DAQ app has functional CAD-style room-and-wall meshes and Wi-Fi
fingerprint position estimation. It is an experimental survey and visualization tool.
The building geometry is not verified as-built CAD, and real-world positioning accuracy
has not been measured.

## What is done

| Building | Modeled levels | Implemented geometry |
| --- | --- | --- |
| EER | 9: B, 1–8 | Extruded walls and selectable room surfaces |
| ECJ | 15: SB, B, 1–11, 11M, R | Extruded walls and selectable room surfaces; R is a roof plan |
| ASE | 7: B, 1–6 | Extruded walls and selectable room surfaces; level 6 is the attic |

- All 31 plan levels share their building's registered XY coordinate frame in feet.
  The models contain 3,348 reconstructed wall/room polygons. Interiors are empty, as requested.
- Orbit, zoom, top/perspective views, active-floor isolation, and an optional source-plan
  overlay are available. Room selection, approximate area, focus, and interior survey-point
  placement are synchronized with the original 2D collector.
- OBJ export contains named wall and room meshes in building X/Y coordinates with Z up,
  in feet. It records elevation status and source caveats. Visual floor separation is excluded.
- Signal layers show survey points, strongest observed RSSI or a selected BSSID, and
  interpolated coverage. Demo signals are explicitly synthetic and separate from real surveys.
- The app imports labeled survey CSVs, excludes discarded/unlabeled/simulator data when
  identifiable, deduplicates repeat imports, and averages repeat measurements at survey points.
- Recorded scans and one-shot device scans can request a floor and horizontal position estimate.
  The query scan is excluded from its own training data.
- ESP32 firmware returns a complete scan per request. Request IDs, stale-response handling,
  collection/localization exclusion, and CSV write-retry behavior are implemented.
- Height-source research, per-level evidence status, and the distinction between unknown
  elevations and schematic model coordinates are visible in the app and export.

## What is approximate, unknown, or not accurate yet

| Item | Current interpretation and limitation |
| --- | --- |
| Floor elevations | **All 31 actual elevations are unknown.** No usable per-level dimensioned elevation schedule was verified. |
| Vertical spacing | Missing elevations use a **14 ft display step** between ordered plan levels. This includes mezzanines and basements and must not be read as their real spacing. |
| Wall height | **10 ft default display extrusion**, editable. It is not a measured clear height, ceiling height, or floor-to-floor height. |
| Vertical datum | Level 1 = 0 ft is a local model reference, not a surveyed altitude. |
| Visual separation | Defaults to **1×**. Larger values produce an exploded view and do not change underlying model/export coordinates. |
| XY registration | Checked against the source plans and cross-floor alignment. Reported registration residuals describe agreement with those drawings, not surveyed as-built accuracy or localization error. |
| Wall and room geometry | Automatically reconstructed from PDF strokes. Some short wall returns/openings are missing, adjacent spaces can be merged, and small drawing artifacts can remain. |
| Room labels and areas | OCR labels can be wrong or merged; areas depend on inferred boundaries. For example, ASE 1.102 shares a reconstructed region with circulation labels. Compare the plan overlay. |
| CAD format | Polygonal meshes with OBJ export. No parametric CAD/BIM editor, editable architectural constraints, STEP/IFC export, or GLB/OBJ/STEP/IFC import. |

The [height-source audit](floor-height-sources.md) records the evidence and missing documents.
EER's published architect section does not establish numerical level elevations. ASE's
additional official drawings require UT access. ECJ's official roof report describes an
approximately **175 ft overall height**, but does not establish the datum needed for per-floor
coordinates. That number is stored as context only; it is not assigned to the roof or divided
among levels. The audit identifies the original ECJ as-built structural set to request.

An entered `elevation_ft` overrides display spacing but remains unverified without a complete,
resolved citation and declared provenance. A source-based estimate stays labeled estimated;
it must not be promoted to documented merely because a source URL exists.

## What the position and signal estimates mean

**Position estimation currently predicts a discrete floor and horizontal X/Y on that floor.**
It does not estimate a continuous, measured 3D Z position or the device's height above the floor.
The 3D marker is placed on the selected model level, whose elevation may be schematic.

The fingerprint baseline compares up to 32 strong query BSSIDs with surveyed fingerprints,
using RMS RSSI differences and a missing-BSSID penalty of −100 dBm. It rejects insufficient
overlap, selects up to five weighted neighbors, votes for a floor, and averages coordinates
within the winning floor. The app requires at least three survey points before estimation.
The [collector README](../Experiments/Campus_Map/collector/README.md) describes thresholds
and import rules; `signal-model.mjs` is the implementation.

- The displayed neighbor spread describes dispersion of matching survey locations. It is
  **not measured error, a confidence radius, or a calibrated probability**. Floor-support
  scores are also descriptive matching metrics, not calibrated probabilities.
- Floor ambiguity and insufficient overlap can be reported. There is no established floor
  classification accuracy, room classification accuracy, or horizontal error in feet/meters.
- The containing model space is a geometric lookup after estimation. Walls do not constrain
  the estimate; an estimate can lie in an unresolved space or on the wrong side of a wall.
- Heatmaps interpolate nearby observations on the same floor within 60 ft and are clipped to
  reconstructed rooms. Blank areas lack supporting data or a resolved room boundary. This is
  not a wall-attenuation model, radio-propagation simulation, or measured AP-position map.
- Synthetic demo success verifies software behavior only. No held-out real-world survey has
  validated performance with the target device, antenna, orientations, or changing conditions.

## What is not done / next work

1. Obtain dimensioned sections, current as-built drawings, a BIM level schedule, or survey
   measurements. Resolve datum and finished-floor versus slab references, then enter sourced
   floor elevations and independently verified wall heights.
2. Review reconstructed walls, openings, room boundaries, and OCR labels against the source
   drawings and site conditions. Repair ambiguous spaces before using geometry as a constraint.
3. Flash and bench-test a physical DAQ board: repeated full scans, save/reopen real CSVs,
   disconnect/reconnect, and localization queries. Native USB and save-picker behavior still
   need hardware validation; no board was flashed during this work.
4. Collect representative real surveys and independent held-out queries. Measure floor
   accuracy and horizontal error distributions, including failure/ambiguity cases. Do not
   infer accuracy from synthetic results or from agreement between the 2D and 3D displays.
5. Wall-aware propagation/constraints, temporal tracking, IMU/CSI fusion, continuous vertical
   localization, and calibrated uncertainty are not implemented.
6. Imported/live model samples are page-memory only. CSV is the durable record; reloading clears
   the in-memory model. Older logs without device/source identity may contain undetectable
   simulator data and must not be assumed suitable for real training.
7. No cloud session or hosted deployment was created. The separate Python AP-estimation
   experiment was not changed; the new browser estimator does not validate its behavior.

## Verification and handoff

- **35/35 Node tests passed again before this integration**, including all 31 registrations,
  polygon triangulation and containment, source hashes, elevation provenance, OBJ geometry,
  CSV filtering/retry behavior, and synthetic fingerprint queries.
- Previously completed browser checks cover EER/ASE/ECJ rendering, room/point synchronization,
  CSV import and recorded queries, height controls/evidence, and desktop/mobile layouts.
  Updated OBJ provenance comments were verified in Node; the earlier browser download test
  predates those comments.
- Firmware previously compiled successfully for `esp32dev` with PlatformIO 6.2.0 and
  Espressif32 8.0.0. Compilation is not a physical-device test.
- These checks establish functional consistency, not physical building accuracy or measured
  localization performance. See the [handoff](3d-model-handoff.md) for run commands and the
  [test guide](../Experiments/Campus_Map/collector/tests/README.md) for verification details.
