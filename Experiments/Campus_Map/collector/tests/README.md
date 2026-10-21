# Verification

From `Experiments/Campus_Map/collector`, with Node.js 20 or later:

```sh
node --test tests/*.test.mjs
```

No npm installation is needed. The 47 tests cover all 31 affine registrations, elevation provenance,
datum handling, BSSID normalization, CSV quoting and corruption, discarded/simulated/unlabeled rows,
reimport deduplication, repeat averaging, bounded heatmap support, sparse/novel queries, cross-floor
voting, and independent demo queries. Collector tests execute the actual `app.js` in a VM with fake
DOM, device and file boundaries to verify failed-write recovery, stop cutoff, simulator metadata,
late replies, query exclusion and mutual exclusion with collection.

Architecture tests check PDF source hashes and floor/page correspondence, every room's interior
point and DAQ round-trip, room picking with holes/concavities, malformed models, room-based synthetic
samples, triangulated area for all 3,403 room/wall polygons, solid volume, and OBJ axes/units/heights.
Export must omit visual floor separation. An additional Shapely validity audit passed for all polygons.
Vertical tests preserve ECJ's 11 historical documented elevations, Level 6 estimate and three unknown
levels, while EER/ASE remain unknown. Overall-height context cannot become a floor elevation, uncited
values cannot become documented, and explicit elevations stay fixed when display spacing changes.
Geometry regressions cover ECJ level 4's recovered extent and source-plan room locations, EER's
reviewed atrium/roof exclusions, and the restored west bridge. IFC tests verify metric analytic solids,
holes, footprint-only spaces, hierarchy, stable GUIDs, Unicode escaping and retained review evidence.
OBJ tests check evidence comments and the geometry for each provenance status.

Offline extractor/review tests require `pymupdf`, `numpy`, `opencv-python` and `shapely`:

```sh
python -m unittest discover -s tests -p 'test_*.py'
```

The nine Python tests cover rotated PDF primitives, source-hash/page binding, safe review replay,
void subtraction, preserved bridge geometry, and validity of the reviewed EER asset.

Serve the app and perform these browser checks after renderer/UI changes:

1. Explore demo in EER, ASE and ECJ. Confirm 9/7/15 floors load, orbit/zoom, floor selection, heatmap,
   individual BSSID, sample points, isolation, height spacing, and camera resets.
2. Estimate demo signal, focus its floor, and verify marker/neighbor lines/spread. Switch building or
   source and verify the previous estimate clears.
3. Import controlled original-format CSV fixtures with at least 3 valid points and a discarded batch.
   Check the accepted count, paste a matching scan, and verify the estimate. Reimport and check no growth.
4. Double-click a floor in 3D, switch to 2D, and check that the point and location fields agree.
5. Check a narrow phone viewport and desktop. Floor tabs must scroll while the building selector stays
   readable. Check the browser console for application errors.
6. Select and focus rooms, place an interior DAQ point and compare it with the 2D source plan. Toggle
   wall/room/reference layers, adjust heights, and export IFC and OBJ. Check holes remain open and model
   coordinates are unchanged by visual separation. Check building switching clears stale geometry.
7. Expand Heights & 3D export. Verify unknown elevation labels, source links, 1× default separation,
   and model Z before separation. Changing the unknown-level step must preserve Unknown status and
   documented ECJ values. Check Level 6's source conflict and the geometry review sources/corrections.
8. Physical-device follow-up: flash the compiled firmware, collect points to a real CSV, reconnect,
   verify repeated requests and an unlabelled localization scan, then evaluate held-out positions.

On 2026-10-21, automated tests passed and browser checks covered demo rendering, imported/discarded
rows, a recorded-query estimate, point synchronization, building switches, and narrow layout. Hardware
collection and real-world accuracy were not tested. Firmware compiled for `esp32dev` using PlatformIO
6.2.0 and Espressif32 8.0.0; no device was flashed.
This source-review revision passed all 47 Node and nine Python tests. A partial EER level 6 generation
applied its source-bound exclusions and restored bridge. Browser checks confirmed ECJ level 4's 50 spaces,
78 wall solids and +44 ft documented elevation; the Level 6 conflict; fixed documented values when the
unknown step changes; EER bridge-to-plan point alignment; demo estimation; the IFC download action; and
a 390 px layout with no horizontal overflow or application console errors. Building and architecture
JSON requests revalidate their cache so clients see the current source evidence and corrections.

Independent IFC validation used IfcOpenShell 0.9.0.post1, installed only in task scratch. All three
exports parsed as IFC4 with zero schema/EXPRESS-rule errors. Every one of the 1,852 wall solids
tessellated; each volume matched its source polygon area × 10 ft, converted to metres. All 1,551
spaces retained footprint representations. Unicode, apostrophes, backslashes and newlines round-tripped.
This checks exchange-file consistency, not survey accuracy or every CAD application's importer.
No manual Revit/FreeCAD import or physical positioning test was performed.
