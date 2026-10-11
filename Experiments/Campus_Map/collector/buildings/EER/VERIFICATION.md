# EER geometry verification (2026-09-25)

Checked against independent sources. The PDF is vector CAD output, so it can be measured directly.

| What | Source | Result |
|---|---|---|
| Scale | Column grid in the PDF | 11 bays of **21.00 ft** (±0.01) and an 18.00 ft bay: the sheets are at true 1/32" scale (±0.05%) |
| Scale | Satellite imagery (Esri World Imagery), floor 4 outline fitted with free scale | 1.005 (0.5% off), outline RMS 0.6 ft |
| Scale | OpenStreetMap footprint (way 516282867) | overall width 265.8 ft vs 266–268 ft on the plan; edge fit 1.02 (OSM trace is coarse) |
| Scale | TxGIO statewide footprints (2017 imagery) | edge fit ~1.05; the coarsest source, least weight |
| Rotation | imagery / OSM / TxGIO | 4.96° / 4.83° / ~5.0°: sheet up points about **5° east of true north** |
| Floor registration | Structural columns matched floor to floor | floors 4–8 identical placement; B, 1, 2, 3 shifted by (−21.64, −19.32), (−20.31, −103.91), (−7.88, −65.90), (−7.87, −65.90) ft; residual ~0.01 ft |
| Registration cross-check | floor outlines; loop closure (B→1→2→4 vs B→4) | agree within 0.4 ft (outline) and 0.04 ft (loop) |
| App pipeline | the same column clicked on floors B, 1, 2, 3, 5, 7 vs floor 4, through the app's own click handling | same building-frame position within **0.09 ft** (36 columns) |
| Absolute position | frame origin placed via OSM vs via imagery | 7.7 ft apart: lat/long is good to roughly ±10 ft |

Takeaways: distances within and across floors are reliable to about an inch plus click precision.
Latitude/longitude isn't wired into the app yet; from the fits above, the frame origin is near
30.28805 N, 97.73577 W with sheet-up ≈ 5° east of north (±10 ft, ±0.2°).
