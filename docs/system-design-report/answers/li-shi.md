# System Design Report Answers: Li Shi

**Your risk reduction demo:** Web app 3D model and signal map

Write under each **Answer:** line, then commit and push by **Sun Nov 22**. Edit only this file. "Don't know" is fine. The full context for each question is in [../team-questions.md](../team-questions.md).

## Risk reduction (Section 3.2)

**Q1.** Have you run or seen the full survey test? If so, what were the **room hit rate** and the **median position error**? Where are the raw capture files?

**Answer:** I was not involved in the survey test and don't have the numbers or the capture files.


**Q2.** Antenna test: what was the RSSI change across directions for the **PCB antenna** vs. the **omnidirectional antenna**? Is the test done, or still planned?

**Answer:** I was not involved in the antenna test and don't know the results.


**Q3.** Your demo, *Web app 3D model and signal map*:

- **What you built:**
  - The **3D building** tab of Signal Studio (`Experiments/Campus_Map/collector/`: `studio.mjs`,
    `model-view.mjs`, `signal-model.mjs`, `architecture*.mjs`, `ap-simulation.mjs`). It is a
    browser app built on Three.js with no build step; `start-webapp.bat` / `.sh` start it.
  - **3D models of three buildings** reconstructed from the campus floor-plan PDFs: EER (9 levels),
    ECJ (15) and ASE (7), for 31 plan levels and 3,403 wall and space polygons. The models have
    continuous exterior walls for EER and ECJ, removable roofs, assembled and exploded views,
    and the EER atrium stairs and bridge.
  - **Signal map:** survey points, a heatmap of the strongest RSSI or of one chosen BSSID
    (interpolated within 60 ft on the same floor and clipped to rooms), and CSV import that
    filters simulator rows and removes duplicates.
  - **Position estimate:** a k-nearest-neighbor fingerprint match (up to 32 BSSIDs, up to 5
    weighted neighbors, −100 dBm penalty for a missing BSSID, at least 3 survey points). It votes
    for the floor, then averages X/Y on that floor and shows a marker in 3D.
  - **AP-per-room simulation:** one assumed AP at the center of every room, with log-distance path
    loss, −5 dB per wall and −15 dB per floor. It produces a full synthetic survey for testing the
    pipeline before real data exists.
  - **IFC4 and OBJ export** of the models, so they can be opened in CAD/BIM tools.
- **How I tested it:**
  - Automated tests: **80/80 Node tests and 19/19 Python tests pass** (run Nov 19, 2026). They
    cover the geometry, exports, CSV import, the position estimator and the simulation.
  - **IFC validation with IfcOpenShell 0.9.0:** all 1,906 solids tessellated with zero schema or
    solid errors. Volumes matched area × height within a relative error of 2.7 × 10⁻¹⁰.
  - Browser checks in EER and ECJ (whole building, exploded, roofs on/off, top view), including a
    phone-width (390 px) layout with no console errors.
  - ECJ floor heights checked against 2013 record drawings (11 of 15 levels documented).
- **Results:**
  - The full pipeline works end to end on synthetic data: survey CSV → heatmap → position estimate
    → 3D marker.
  - The demo and the simulation produce a floor and an X/Y estimate on the correct floor.
  - Screenshots are in `docs/oral-design-review/assets/screenshots/`.
- **What didn't work or is still unfinished:**
  - **Real positioning accuracy has not been measured.** No real survey CSVs are in the repo, so
    there is no room hit rate or error distance from real data yet.
  - Floor heights: 19 of 31 levels are unknown (all of EER and ASE), so vertical placement is
    schematic.
  - The simulation's path-loss values are uncalibrated assumptions.
  - Walls don't constrain the estimate, so it can land on the wrong side of a wall.
  - The firmware compiles, but the full browser → ESP32 loop has not been tested on a physical
    board.
- **What it means for the design:**
  - It reduces the **user interface** risk: there is a working 3D map that shows signals and an
    estimate on the right floor of a real campus building.
  - It reduces the **data pipeline** risk: the survey CSV format, import, fingerprint matching and
    display are built and tested, so real data can be dropped in.
  - It confirmed that the **main remaining risk is accuracy on real data**, which needs a real
    survey plus held-out test points.


**Q4.** Do you have **photos** of the test setups (tripod, boards, antennas, the survey in EER)? Put them in `../figures/` and list them here.

**Answer:** No photos of the test setups. App screenshots that can serve as report figures are already in
`docs/oral-design-review/assets/screenshots/` (`app-3d-default.png`, `app-3d-exploded.png`,
`app-3d-data.png`, `app-3d-floor2-top.png`, `app-2d-floor2.png`, `collector-2d-capture.png`).


## Feedback and design decisions (Sections 2.0 and 3.1)

**Q5.** What did Dr. Vikalo and Mugdha say at the **oral design review**? Did we agree to change anything?

**Answer:**


**Q6.** Has the **Prior Art Report** been graded? If so, what were the comments?

**Answer:**


**Q7.** Which of these are final, and which are still open? Mark each one final or open, and give the choice if you know it.

- Microcontroller (which ESP32 variant?):
- IMU part:
- Battery type and capacity:
- CSI + RSSI, or RSSI only:
- Fusion method (Kalman filter, particle filter, or other):
- Where the location server runs (laptop, cloud, or campus VM):


**Q8.** Do we keep the Project Definition specs (>90% room hit rate, <5 m median error, ≤10 s updates, ≥24 h battery, ≤$50 per tag)? Should any of them change?

**Answer:**


**Q9.** What are the main **subsystems** for the block diagram? The current guess is tag hardware → tag firmware → survey/fingerprint database → location server and fusion → user app. Is anything missing or wrong?

**Answer:**


## EE 464 plan (Section 4.0 and Appendixes B–E)

**Q10.** What are the EE 464 dates: first week, demo day, Open House, and final report?

**Answer:**


**Q11.** What do **you** want to own next semester (hardware, firmware, server/fusion, app/UI, testing, or documentation)? Should we keep this semester's split?

**Answer:**


**Q12.** BOM: which parts have we already bought, and which still need to be ordered? Rough prices are fine. Are we planning a custom PCB or an enclosure?

**Answer:**


**Q13.** What are the main tasks for spring? A bullet list is fine.

**Answer:**


## Writing logistics

**Q14.** Should one person write the first draft with everyone reviewing after, or should each person write their own sections? If you prefer to split, which section do you want?

**Answer:**


**Q15.** Any ideas for the subtitle? ("System Design Report for BevoTag: ___")

**Answer:**
