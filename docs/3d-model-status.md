# 3D DAQ model: completed work, limitations, and estimation

Updated **2026-10-21**, on branch **`3d-model`**. This source-review pass has not yet been merged to `main`.

**Current status:** the DAQ app has CAD-style room-and-wall geometry, inferred continuous EER/ECJ
exteriors, removable inferred roofs, assembled/exploded views, IFC4 and OBJ export,
and Wi-Fi fingerprint position estimation. The geometry is reconstructed from plans; it is
not a native architectural authoring model or verified as-built CAD. Real positioning accuracy
has not been measured.

## What is done

| Building | Modeled levels | Wall polygons | Space polygons | Elevation evidence |
| --- | --- | ---: | ---: | --- |
| EER | 9: B, 1–8 | 1,109 | 804 | All 9 unknown |
| ECJ | 15: SB, B, 1–11, 11M, R | 638 | 569 | 11 documented, 1 estimated, 3 unknown |
| ASE | 7: B, 1–6 | 105 | 178 | All 7 unknown |

The current assets contain **3,403 wall/space polygons across 31 plan levels**, with empty
interiors. A space polygon may represent a room, circulation, or several connected spaces;
these counts are not a certified room inventory. Wall counts describe connected reconstructed
polygons, not individual architectural wall elements. All levels share their building's
registered XY frame in feet. ECJ R is a composite roof plan; ASE level 6 is an attic plan.
The original wall/room arrays are preserved. Separate coarse exterior profiles add **22 storey
enclosures: 9 EER and 13 ECJ**. ASE has no continuous exterior profile yet.

- Orbit, zoom, top/perspective views, active-floor isolation, and a source-plan overlay are
  available. Room selection, approximate area, focus, and interior survey-point placement
  synchronize with the original 2D collector.
- **Whole building** assembles at 1×; **Exploded** uses 3× visual separation. **Continuous exterior**
  switches the inferred enclosure layer on/off. Separation moves floor bases without stretching
  exterior bands or plan walls.
- **Roofs** independently shows/removes inferred roof, terrace and skylight caps. It starts off for
  floor inspection; Whole building turns it on and Exploded turns it off. Reenabled exploded caps
  follow their own floors without stretching. Top view, room focus and estimate focus hide them.
- **IFC4 export** converts feet to metres and retains a project/building/storey hierarchy.
  Walls use analytic extruded polygon profiles, including holes. Spaces are named footprint
  boundary curves, with no invented room volume. Roof display thickness is explicitly assumed. Evidence and height status
  accompany the model. Only documented storeys receive a semantic IFC `Elevation` value;
  other storeys retain explicitly unverified placements.
- **OBJ export** contains named wall and room meshes in building X/Y, Z up, in **feet**, with
  evidence comments. Both exports exclude exploded-view separation, signals, and plan textures.
- With Continuous exterior enabled, default exports include separate inferred shell objects.
  IFC identifies them as `IfcBuildingElementProxy`, distinct from reconstructed `IfcWall` solids.
  Exterior exports use reviewed level 11 context walls and omit 11M/R wall solids; IFC retains all
  space footprint reference curves, while OBJ also omits those reference surfaces. Toggle the exterior
  off, or pass `exterior: false`, to restore all original geometry in the export.
- UI exports follow the independent Roofs toggle. The API's `roofs` option defaults to `exterior`
  when omitted. Roof solids are separately named IFC proxies/OBJ objects with inferred geometry and
  assumed thickness recorded; use `exterior: false, roofs: false` for only original geometry.
- Signal layers show survey points, strongest observed RSSI or a selected BSSID, and interpolated
  coverage. Demo signals are explicitly synthetic and separate from real surveys.
- CSV import filters discarded/unlabeled/simulator samples when identifiable, deduplicates
  repeat imports, and averages repeated observations. Recorded or one-shot device scans can
  request a floor and horizontal position estimate without entering their own training data.
- ESP32 firmware returns a complete scan per request. Request IDs, stale-response handling,
  collection/localization exclusion, and CSV write-retry behavior are implemented.

## Improvements from this source-review pass

**Continuous exterior:** source-plan perimeters now define coarse storey enclosures with major
holes and setbacks, using an assumed **0.5 ft inward shell**. Enclosures span to the next exterior
level instead of stopping at the 10 ft plan-wall display height. Door/window gaps are closed for
this display; their actual openings, materials and assemblies are not inferred. EER's levels remain
unverified, and the final EER band still uses a schematic top. Roof coverings, parapets, detailed
facade projections and terraces remain incomplete. These profiles are not an as-built envelope
or an RF obstruction model.

ECJ level 11 follows the inner penthouse perimeter with a historical top of **+159 ft**, from record
EL 711 minus Level 1 EL 552. This applies only to that enclosure; it does not resolve the R sheet's
multiple surfaces. Whole-exterior mode suppresses internal 11M and composite R as extra storeys and
uses clipped context walls on level 11. Disabling the exterior or isolating those source levels
restores the original geometry. Source hashes, profile assumptions and level roles are recorded in
the EER/ECJ `exterior-review.json` files, applied reproducibly by `exterior_review.py`.

**Removable roofs:** explicit roof/terrace profiles now cap the model with separate solids, using
an assumed **0.5 ft thickness below the surface**. ECJ's lower roof is +142 ft and penthouse roof
+159 ft, supported by the historical level/roof evidence; the composite R sheet stays unresolved.
EER roof elevations remain assumed. Its lower angled atrium skylight is a flat approximation at
the schematic level 3 top, not a measured roof height or slope. The separate upper shading canopy
remains unmodeled; it must not become a solid roof across the high central opening.

**ECJ elevations:** 2013 record elevations reproduced in Sarlo's 2018 dissertation now support
11 historical elevations, normalized by subtracting Level 1 EL 552 ft. Basement is −16 ft;
Level 2 is +16 ft; Levels 3–5 and 7–11 follow the cited drawing values. Level 6 is **estimated
at +72 ft**, because both sheets repeat the basement elevation tag while their adjacent
dimension chains imply EL 624 ft. SB, 11M, and the multi-surface roof plan remain unknown.
“Documented” means supported by that historical source, not field-verified or current as-built.
See the complete [elevation table and source interpretation](floor-height-sources.md).

**ECJ plan alignment:** the extractor now applies the PDF page's display rotation to raw
drawing primitives before registration. This repairs level 4's 270-degree source-coordinate
mismatch without changing the building's registered frame.

**EER atrium review:** source-plan linework and labels, supported by AISC and UT descriptions,
now drive explicit, source-hash-bound corrections. Level 3 skylight/truss projections no longer
become floor patches or walls; level 6's false central atrium floor is removed; and the actual
west bridge is restored from page 7's floor boundaries. Level 8's roof-member projections are
excluded from the room/wall scope. Adjacent spaces and bridge boundaries are preserved. The
level 8 exclusion means unmodeled roof structure, not a claim that the whole region is empty air.
The review is reproducible in `buildings/EER/geometry-review.json`; it is not a full audit of
every atrium opening, bridge, or roof surface.

The [CAD source review](cad-source-review.md) records corroborating dimensions and renovation
notices. The examined ECJ plans predate registered 2026 work on Levels 7–8 and parts of 9–11.
EER has a registered library-to-office project, and ASE has a classroom-partition project.
Those notices supply no replacement room layouts; their partition changes have not been invented.

## What is approximate, unknown, or not accurate yet

| Item | Current interpretation and limitation |
| --- | --- |
| Floor elevations | **19 unknown**, **1 estimated**, **11 documented historical values**. EER and ASE still have no verified numerical level schedule. ECJ's unresolved roof surfaces need separate identification. |
| Unknown-level placement | Schematic interpolation between entered levels, or a **14 ft default display step** beyond an anchor. This does not establish basement, mezzanine, or roof spacing. |
| Plan-wall height | **10 ft default display extrusion**, editable; not a measured clear height, ceiling height, or storey height. |
| Exterior enclosure | Coarse plan-traced perimeter with a **0.5 ft assumed inward shell** and closed door/window gaps. Bands span exterior levels; only the ECJ penthouse has a separately sourced top at +159 ft. No measured thickness, glazing, material or completed roof assembly is claimed. |
| Roofs | Removable inferred roof/terrace/skylight solids; **0.5 ft assumed thickness extending downward**. ECJ +142/+159 ft surfaces use historical evidence. All EER roof heights, the flat skylight approximation, slopes, build-ups and parapets remain unverified. |
| Vertical datum | Local Level 1 = 0 ft. ECJ is normalized from record EL 552 ft; original survey datum and finished-floor versus slab reference remain unspecified. EER/ASE zero is only a display reference. |
| Visual separation | Defaults to **1×**; the Exploded preset uses **3×**. Floor bases move, but band and wall heights do not stretch. Model/export coordinates stay unchanged. |
| XY registration | Agreement with source plans and cross-floor alignment, not surveyed as-built accuracy or localization error. |
| Walls, openings and spaces | PDF-stroke reconstruction plus targeted reviewed corrections. Short returns/openings may be missing; adjacent spaces may merge; drawing artifacts may remain. Doors, glazing and materials are not fully modeled. |
| Labels and areas | OCR labels and inferred areas may be wrong. ASE 1.102, for example, shares a reconstructed region with circulation labels. The added EER bridge is labeled from plan review. |
| CAD scope | IFC wall solids, space footprints and separate inferred enclosure proxies, plus OBJ meshes. No native parametric architectural editing, constraints, STEP export, or GLB/OBJ/STEP/IFC import. IFC delivery does not make the model as-built. |

An entered `elevation_ft` overrides display spacing but remains unverified without a complete,
resolved citation and declared provenance. A justified source-based estimate stays estimated.
ECJ's approximate 175 ft overall-height context is not assigned to the roof or divided among levels.

## What the position and signal estimates mean

**Position estimation predicts a discrete floor and horizontal X/Y on that floor.** It does
not estimate continuous measured Z or the device's height above the floor. The 3D marker uses
the selected model level, whose elevation may be schematic.

The fingerprint baseline compares up to 32 strong query BSSIDs with surveyed fingerprints,
using RMS RSSI differences and a missing-BSSID penalty of −100 dBm. It rejects insufficient
overlap, selects up to five weighted neighbors, votes for a floor, and averages coordinates
within the winning floor. At least three survey points are required. The
[collector README](../Experiments/Campus_Map/collector/README.md) documents thresholds and import rules.

- Neighbor spread describes matching survey-location dispersion. It is **not measured error,
  a confidence radius, or a calibrated probability**. Floor-support scores are descriptive too.
- There is no measured floor/room classification accuracy or horizontal error distribution.
- The containing model space is looked up after estimation. Walls do not constrain estimates,
  which can fall in unresolved spaces or on the wrong side of a wall.
- Heatmaps interpolate same-floor observations within 60 ft and clip to reconstructed spaces.
  Blank areas lack supporting data or a resolved boundary. This is not wall-attenuation modeling,
  radio-propagation simulation, or measured AP-position mapping.
- Synthetic demo success verifies behavior only. No held-out real survey validates performance
  across devices, antennas, orientations, or changing conditions.

## Remaining work

1. Obtain current dimensioned sections, as-built plans/BIM, or measurements. Resolve EER/ASE
   levels, ECJ level 6's conflicting tag, SB/11M/roof surfaces, datum, and slab/finished-floor
   references. Verify wall heights independently.
2. Review remaining wall returns, openings, room boundaries, OCR labels, atrium bridges and
   renovation changes against drawings and field conditions before adding geometric constraints.
   Validate IFC interoperability in the intended CAD/BIM application; importer support can differ.
3. Flash and bench-test a physical DAQ board: full scans, real CSV save/reopen, reconnect, and
   localization queries. Native USB and browser save-picker behavior still need hardware testing.
4. Collect representative surveys and independent held-out queries. Measure floor accuracy,
   horizontal error, and failure/ambiguity cases. Better geometry alone is not an accuracy result.
5. Wall-aware propagation/constraints, temporal tracking, IMU/CSI fusion, continuous vertical
   localization, and calibrated uncertainty are not implemented.
6. Imported/live model samples are page-memory only. CSV is the durable record. Older logs
   without source identity may contain undetectable simulator data.
7. No cloud session or hosted deployment was created. The separate Python AP-estimation
   experiment was not changed by the browser-model work.

## Verification and handoff

The removable-roof revision passed **68/68 Node tests and 19/19 Python tests**. An actual ECJ level 11
partial rebuild included roof arrays; an earlier EER level 6 run restored the bridge. Review replay
is idempotent, and the original room, wall and enclosure geometry remains intact.
Checks cover source hashes, rotation, elevation provenance, profiles, exports, collection/estimation
and actual Three.js world-space geometry. Assembled bands meet, exploded bands retain their height,
and source geometry remains available when switching views.

IfcOpenShell 0.9.0.post1 validated all three roof-inclusive IFC4 exports with **zero schema or solid
failures**. All **1,906 solids** tessellated: 1,852 selected context walls, 27 enclosure proxies and
27 roof proxies (22 EER, 5 ECJ). All **31 storeys and 1,551 space references** remain. Volumes matched
footprint area × the applicable extrusion after metre conversion; maximum relative error was
**2.71 × 10⁻¹⁰**. All roof surfaces matched their elevation anchors within **7.11 × 10⁻¹⁵ m**.
Unicode and escaped text round-tripped. This verifies file consistency, not physical
dimensions; no manual Revit/FreeCAD import was performed.

Current browser checks verified EER/ECJ Whole building with roofs on, Exploded with roofs off,
manual reenabling and Top view removing caps. Previous exterior checks verified source restoration,
isolated 11M/R access, and ASE's disabled unavailable exterior control. The previous **390 × 844** viewport had
no horizontal overflow, with zero browser warnings or errors. Earlier checks covered corrected ECJ
level 4 (50 spaces, 78 walls, +44 ft documented), the level 6 conflict, fixed documented elevations,
EER's bridge-to-plan alignment, a synthetic estimate and IFC download.

Firmware previously compiled for `esp32dev` with PlatformIO 6.2.0 and Espressif32 8.0.0; no board
was flashed. These checks establish functional consistency, not physical accuracy. See the
[handoff](3d-model-handoff.md) and [test guide](../Experiments/Campus_Map/collector/tests/README.md).
