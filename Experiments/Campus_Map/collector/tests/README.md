# Verification

From `Experiments/Campus_Map/collector`, with Node.js 20 or later:

```sh
node --test tests/*.test.mjs
```

No npm installation is needed. The tests cover all 31 affine registrations, elevation provenance,
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

Exterior tests cover source-bound coarse profiles, 22 EER/ECJ storey enclosures, explicit top evidence,
internal/reference level roles, and export behavior with the exterior enabled or disabled. IFC retains
all space reference curves and keeps inferred enclosures separate from reconstructed walls.
`model-view-exterior.test.mjs` runs the actual renderer layout method with real Three.js meshes,
without requiring WebGL. It measures world-space bounds to catch gaps between 1× storeys, stretched
enclosures at 3×, changed plan-wall height, and incorrect ECJ level 11 context or 11M/R visibility.
Roof regressions verify downward 0.5 ft thickness, ECJ surfaces at +142/+159 ft, independent roof
visibility, preserved mesh/source data, unchanged roof offsets in exploded views, and EER's continued
assumed elevation status after display controls change.

Offline extractor/review tests require `pymupdf`, `numpy`, `opencv-python` and `shapely`:

```sh
python -m unittest discover -s tests -p 'test_*.py'
```

The Python tests cover rotated PDF primitives, source-hash/page binding, safe review replay,
void subtraction, preserved bridge geometry, validity of the reviewed EER asset, and exterior
profile application without changing the original room/wall arrays.

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
8. In EER and ECJ, use **Whole building**, then **Exploded**. Confirm exterior bands meet at 1× and
   separate at 3× without growing taller; plan walls retain their own display height. Inspect EER's
   central openings and ECJ's recessed level 11 penthouse. Toggle **Continuous exterior** off and
   back on, then isolate 11M and R: original source geometry must remain inspectable. ASE should
   clearly report that exterior profiles are unavailable.
9. Export with **Continuous exterior** on and off. Confirm inferred objects are separately labeled,
   source assumptions are retained, IFC keeps all space reference curves, and the off export restores
   every original wall/room. Compare the selected view's assembled coordinates, not its exploded offsets.
10. Confirm **Roofs** starts off, Whole building turns it on, and Exploded turns it off. Reenable it
    at 3× and verify caps follow their owning levels without growing thicker. Top view, Focus room
    and Show estimated floor must remove caps. Toggle roofs independently of exterior/plan walls,
    export each combination, and check roof objects/assumptions and unexpanded coordinates.
11. Physical-device follow-up: flash the compiled firmware, collect points to a real CSV, reconnect,
   verify repeated requests and an unlabelled localization scan, then evaluate held-out positions.

On 2026-10-21, automated tests passed and browser checks covered demo rendering, imported/discarded
rows, a recorded-query estimate, point synchronization, building switches, and narrow layout. Hardware
collection and real-world accuracy were not tested. Firmware compiled for `esp32dev` using PlatformIO
6.2.0 and Espressif32 8.0.0; no device was flashed.
The removable-roof revision passed **68/68 Node tests and 19/19 Python tests**. An actual ECJ level 11
partial generator rebuild included roof arrays. Repeat review application is idempotent, and original
room, wall and enclosure geometry is preserved. The earlier EER level 6 diagnostic applied source-bound
exclusions and restored the bridge. Earlier browser checks confirmed ECJ level 4's 50 spaces,
78 wall solids and +44 ft documented elevation; the Level 6 conflict; fixed documented values when the
unknown step changes; EER bridge-to-plan point alignment; demo estimation; the IFC download action; and
a 390 px layout with no horizontal overflow or application console errors. Building and architecture
JSON requests revalidate their cache so clients see the current source evidence and corrections.

The exterior browser pass verified EER/ECJ Whole building and Exploded presets, source restoration
with exterior off, isolated 11M/R geometry, and ASE's disabled unavailable exterior control. The
390 × 844 layout had no horizontal overflow, with zero browser warnings or errors.
The current roof browser pass verified EER/ECJ Whole building with roofs on, Exploded with roofs off,
manual reenabling and Top view removing caps; screenshots record those states. In ECJ level 11,
the roof blocked a double-click from placing a survey point in the covered room; removing it restored
room selection and point placement. ASE's roof control remains disabled with a clear unavailable note.
No browser warnings or errors were reported. The mobile results
above belong to the preceding exterior pass.

Roof-inclusive IFC validation used IfcOpenShell 0.9.0.post1, installed only in task
scratch. All three files parsed as IFC4 with **zero schema/EXPRESS-rule or solid failures**:

| Building | Storeys | Context walls | Enclosure proxies | Roof proxies | All solids | Space references |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| EER | 9 | 1,109 | 14 | 22 | 1,145 | 804 |
| ECJ | 15 | 638 | 13 | 5 | 656 | 569 |
| ASE | 7 | 105 | 0 | 0 | 105 | 178 |
| Total | 31 | 1,852 | 27 | 27 | 1,906 | 1,551 |

All **1,906 solids** tessellated. Their volumes matched polygon area × the applicable wall/enclosure/roof
height after metre conversion, with maximum relative error **2.71 × 10⁻¹⁰**. The 22 exterior storeys
produce 27 enclosure proxies because some profiles have disconnected components. All 27 roof surface
elevations matched their anchors within **7.11 × 10⁻¹⁵ m**. All spaces retain
footprint representations. Unicode, apostrophes, backslashes and newlines round-tripped.
This checks exchange-file consistency, not survey accuracy or every CAD application's importer.
No manual Revit/FreeCAD import or physical positioning test was performed.
