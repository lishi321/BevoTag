# ASE geometry verification (2026-10-13)

Checked against independent sources. The PDF is vector CAD output (bldg 0983; pages 2–3 are titled North
Office Building A, same building number), so it can be measured directly.

| What | Source | Result |
|---|---|---|
| Scale | Column grid in the PDF | bays of **20.00 ft** on every floor (B–6), plus 21.00 / 23.00 ft bays: all sheets are at true 1/16" scale |
| Scale | Column sizes | 2.00 ft and 3.00 ft columns on every floor |
| Scale | OpenStreetMap footprint (way 38624864) | about 112–118 × 195 ft on the plan vs 117.5 × 198.1 ft in OSM (OSM trace is coarse, within 1–3%) |
| Rotation | OSM | sheet up points about **4.5–5° east of true north** |
| Floor registration | Structural columns matched to floor 2 | shifts (sheet ft): B (−6.55, −19.47), 1 (−0.50, −10.28), 3 (−4.51, −17.71), 4 (−6.49, −19.72), 5 (−6.49, −19.71), 6 (−1.86, −3.21); residual 0.004–0.05 ft over 9–38 columns for B–5 |
| Registration cross-check | outer wall faces | west face at x = 31.09–31.11 ft and south face at y = −216.67 ft on floors 1–6 after registration |
| App pipeline | 148 column pairs pushed through the app's `toFrame` | same building-frame position within 0.01–0.08 ft on average (B–5) |

Floor 6 is the attic (hipped roof with ~8 ft eaves). Its columns match to about **0.33 ft** and its west
wall face sits 0.3 ft off the other floors, so treat positions there as good to about 0.3 ft.

Origin: south-west outer corner of the exterior walls (west face of the west wing, south face of the
south wing), x right and y up on the sheet. Latitude/longitude isn't wired into the app yet.
