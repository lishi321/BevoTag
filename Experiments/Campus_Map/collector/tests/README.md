# Verification

From `Experiments/Campus_Map/collector`, with Node.js 20 or later:

```sh
node --test tests/*.test.mjs
```

No npm installation is needed. The 18 tests cover all 31 affine registrations, approximate/measured
heights, BSSID normalization, CSV quoting and corruption, discarded/simulated/unlabeled rows,
reimport deduplication, repeat averaging, bounded heatmap support, sparse/novel queries, cross-floor
voting, and independent demo queries. Collector tests execute the actual `app.js` in a VM with fake
DOM, device and file boundaries to verify failed-write recovery, stop cutoff, simulator metadata,
late replies, query exclusion and mutual exclusion with collection.

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
6. Physical-device follow-up: flash the compiled firmware, collect points to a real CSV, reconnect,
   verify repeated requests and an unlabelled localization scan, then evaluate held-out positions.

On 2026-10-21, automated tests passed and browser checks covered demo rendering, imported/discarded
rows, a recorded-query estimate, point synchronization, building switches, and narrow layout. Hardware
collection and real-world accuracy were not tested. Firmware compiled for `esp32dev` using PlatformIO
6.2.0 and Espressif32 8.0.0; no device was flashed.
