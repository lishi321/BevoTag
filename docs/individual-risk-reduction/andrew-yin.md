# Individual Risk Reduction: Preliminary List of Wi-Fi Access Point Locations

| | |
|---|---|
| **Student** | Andrew Yin |
| **Team** | BevoTag (SP11) |
| **Technical TA** | Michael Zhao |
| **Faculty mentor** | Dr. Haris Vikalo |
| **Due** | Fri Nov 20, 2026, 5:00 pm |

> **Grading (0 to 10, Technical TA):** (1) follows the guidelines, (2) done before the deadline,
> and (3) achieves **useful, significant results**. Point 3 matters most, so show measured numbers
> and say what they mean for the design.

## 1. Risk addressed

Knowing where each AP is lets the system check fingerprint estimates and simulate coverage. Abhirit's list answers "which APs exist"; this activity answers "where they are."

TODO: say this in your own words.

## 2. What I built

Useful starting points:

- `Experiments/Analysis/AP_location_rough_estimate.py` computes an RSSI-weighted centroid for each AP from collector CSVs.
- Campus AP names often include the room (for example, `AP-ECJ3A6H02-ECJ-3-100` is in ECJ 3.100), which gives a ground truth to check estimates against.
- Signal Studio's "AP in every room" simulation takes a list of AP positions, so your list can replace its assumed positions.

TODO.

## 3. Method and test setup

TODO: which scans, how positions were estimated, and how you checked them (AP names, APs visible on the ceiling).

## 4. Results

TODO: a table of AP, building, floor, estimated x/y and actual location, plus the error in feet or meters.

## 5. What the results mean for the design

TODO.

## 6. Limitations and next steps

TODO.

## 7. Demo steps

TODO.

## 8. Files

TODO.
