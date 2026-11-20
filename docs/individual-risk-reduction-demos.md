# Individual Risk Reduction: what the repo has for each demo

Checked 2026-11-16 against `main`. Due **Fri Nov 20, 2026, 5:00 pm**.

**Note:** no survey CSV files are committed. `AP_location_rough_estimate.py` expects four files in
`data/` that are not in the repo. Whoever has the Oct 11 EER Level 2 captures should add them.

| # | Topic | Owner | Status | What exists |
| --- | --- | --- | --- | --- |
| 1 | Firmware: locate a router by strongest signal | Ethan Chua | Partly ready | Firmware has a `strongest` command. Nothing turns it into a router position yet. |
| 2 | List of WAPs in EER, ECJ | Abhirit Das | Not started | Nothing in the repo. |
| 3 | Display software for parsing data | Esteban Martinez | Partly ready | A parsing script exists, and the collector can import and plot CSVs. No test data in the repo. |
| 4 | Preliminary list of WAP locations | Andrew Yin | Partly ready | `AP_location_rough_estimate.py` estimates AP x/y, but there is no data to run it on. |
| 5 | Web app 3D model and signal map | Li Shi | Ready | 3D model of 3 buildings, signal heatmap, position estimate, IFC/OBJ export, tests. |

## 1. Firmware: locate a router by strongest signal (Ethan Chua)

**Already in the repo:**

- `Experiments/DAQ_Module/ESP Firmware/src/main.cpp` (PlatformIO, `esp32dev`).
  - Sending `{"cmd":"strongest"}` makes it return the single strongest AP: MAC, RSSI and SSID.
  - Sending `{"cmd":"scan","id":N}` returns a full fingerprint.
- An older routine for 50 scans followed by CSI sniffing is commented out.

**Demo:** flash the board, open a serial monitor at 115200 baud, send `{"cmd":"strongest"}`, then
walk toward an AP and show the RSSI rising.

**Still needed:** log strongest-AP readings over time or position, and turn them into a router
location, for example the spot where RSSI peaks. The collector does not use the `strongest` command
yet.

## 2. List of WAPs in EER, ECJ (Abhirit Das)

**Already in the repo:** nothing.

**Still needed:** all of it.

- Scan at points on each floor (the collector already does this) and pull out the unique BSSIDs and
  SSIDs.
- Group BSSIDs that share a MAC prefix into physical APs, since one AP broadcasts several SSIDs and bands.
- Output: a table of AP, building, floor, SSIDs and channel(s). Estimating where each AP sits is
  #4 (Andrew), so this list answers "which APs exist," and #4 answers "where they are."

## 3. Display software for parsing data collections (Esteban Martinez)

**Already in the repo:**

- `Experiments/Analysis/AP_location_rough_estimate.py`: reads collector CSVs (pandas) and prints an
  estimated x/y for each AP.
- The Signal Studio import (**My surveys → Import CSV files**) parses the raw CSV, plots samples and
  draws a per-BSSID heatmap.
- The collector README has a pandas recipe that turns the CSV into a fingerprint table.

**Demo:** run the script on survey CSVs and show the table, or import the same files into the app.

**Still needed:**

- Commit data files to run it on.
- Make the script a standalone tool: take files as arguments, plot RSSI over x/y, and plot RSSI
  distribution per AP.
- Make sure it is clearly separate from #4 and #5, which already have their own import screens.

## 4. Preliminary list of WAP locations (Andrew Yin)

**Already in the repo:** `Experiments/Analysis/AP_location_rough_estimate.py` computes an
RSSI-weighted centroid for each AP from collector CSVs and prints an estimated x/y.

**Demo:** run the script on survey data and show the estimated positions on the floor plan, next to
the AP locations that can be seen on the ceiling.

**Still needed:**

- Commit survey CSVs to run it on (see the note at the top).
- Use #2's AP list, so that the BSSIDs of one physical AP give one location.
- Check a few estimates against APs that can be seen, and report the error in meters.
- Output: a table of AP, building, floor, estimated x/y and how it was checked.

**Note:** the survey collector app (`Experiments/Campus_Map/collector/`) is not anyone's individual
demo, but #2, #3 and #4 all depend on the data it collects. The System Design Report covers it in
Section 3.1 as part of the survey subsystem.

## 5. Web app 3D model and signal map (Li Shi)

**Already in the repo:** in the same app, the **3D building** tab (`studio.mjs`, `model-view.mjs`,
`signal-model.mjs`, `architecture*.mjs`).

- 3D models of EER (9 levels), ECJ (15) and ASE (7).
- Removable roofs, assembled and exploded views.
- RSSI heatmap per BSSID or strongest signal.
- Fingerprint position estimate with a teal marker.
- IFC4/OBJ export.
- Status and limits are written up in `docs/3d-model-status.md`.

**Demo:** click **Explore demo**, which shows synthetic coverage plus a sample estimate. Checked today:
it renders EER Level 2 with no errors.

**Still needed for results:**

- Show real survey data instead of the synthetic demo.
- Measure positioning accuracy. The status doc says "Real positioning accuracy has not been
  measured."
- Shared risk: no measured floor heights for 19 levels.

## Is there enough for each?

- **#5:** enough to demo now. It needs a real data run to show "significant results."
- **#1, #3 and #4:** there is a starting point. Each needs a day or two of new work plus data.
- **#2:** nothing yet. Deliver it as a script plus a table, and build it on #3's parser.
- **Overlap:** #2 and #4 use the same scans, and #3 and #5 both read the same CSVs. Each person
  should own a clearly separate piece so the TA can grade the individual work:
  - #2: which APs exist (BSSIDs grouped into physical APs)
  - #3: the offline analysis tool
  - #4: where each AP is
  - #5: the 3D view and accuracy
