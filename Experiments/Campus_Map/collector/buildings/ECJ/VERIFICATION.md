# ECJ geometry verification (2026-10-13)

Checked against independent sources. The PDF is vector CAD output (bldg 0227), so it can be measured
directly. Page 6 (floor 4) is stored rotated 270°; everything below is in the sheet as displayed.

| What | Source | Result |
|---|---|---|
| Scale | Column grid in the PDF | interior bays of **22.00 × 26.00 ft** on both the 1/32" sheets (SB, B, 1) and the 1/16" sheets (2 and up): the printed scales are true |
| Scale | Column sizes | 2.24 / 2.99 ft on the 1/32" sheets vs 2.25 / 3.00 ft on the 1/16" sheets: the same columns at both scales |
| Scale | Tower exterior, outer wall faces | **136.76 × 104.87 ft** on every floor 3–10 (within 0.02 ft; floor 5, renovated 2026, is 0.08 ft wider) |
| Scale | OpenStreetMap footprint (way 38625301) | floor 2 (tower + west wing) 235.6 × 137.2 ft vs 235.8 × 134.0 ft in OSM (OSM trace is coarse) |
| Rotation | OSM | sheet up points about **5° east of true north** |
| Floor registration | Structural columns, tower outer wall faces | shifts onto floor 4 (sheet ft) below |
| App pipeline | 106 column pairs pushed through the app's `toFrame` | tower floors agree within 0.003–0.05 ft on average |

| Floor | Shift (ft) | How | Agreement |
|---|---|---|---|
| SB | (−177.32, 77.58) | columns; SB↔B 25 columns at 0.009 ft | ~0.1 ft interior, ~0.3 ft at perimeter columns |
| B | (−183.03, 84.65) | columns via SB | same |
| 1 | (−181.25, 79.34) | columns | same; ground-floor walls are set back ~1 ft (lobby) so faces weren't used |
| 2 | (−34.22, 0.25) | wall faces (top, sides) | 0.03 ft |
| 3 | (0.59, −2.64) | columns + faces | 0.003 ft |
| 5 | (0.05, −1.11) | wall faces | ~0.1 ft |
| 6 | (−1.99, −3.08) | columns + faces | 0.02 ft |
| 7 | (−1.99, −1.99) | wall faces | 0.01 ft |
| 8 | (0.01, −1.07) | columns + faces | 0.002 ft |
| 9 | (−1.99, −3.08) | columns + faces | 0.004 ft |
| 10 | (0.30, −2.07) | wall faces | 0.07 ft |
| 11 | (−6.77, −1.07) | wall faces | ~0.2 ft |
| 11M | (−0.03, −2.00) | image match to floor 11 (three starting points agree) | ~0.1 ft |
| R | (0.29, −2.07) | wall faces (same sheet placement as floor 10) | ~0.3 ft |

The SB, B and 1 sheets are tied to the tower by 4–6 interior columns. Their outermost columns differ in
shape and position from the tower's, which shows up as ~0.3 ft at the perimeter; interior positions are
good to about 0.1 ft.

Origin: south-west outer corner of the tower's exterior walls, x right and y up on the sheet.
Latitude/longitude isn't wired into the app yet.
