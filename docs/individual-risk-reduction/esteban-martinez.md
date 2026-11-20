# Individual Risk Reduction: Display Software for Parsing Data Collections

| | |
|---|---|
| **Student** | Esteban Martinez |
| **Team** | BevoTag (SP11) |
| **Technical TA** | Michael Zhao |
| **Faculty mentor** | Dr. Haris Vikalo |
| **Due** | Fri Nov 20, 2026, 5:00 pm |

> **Grading (0 to 10, Technical TA):** (1) follows the guidelines, (2) done before the deadline,
> and (3) achieves **useful, significant results**. Point 3 matters most, so show measured numbers
> and say what they mean for the design.

## 1. Risk addressed

Every survey produces raw CSV logs with JSON scan lines. The team needs a reliable way to parse them and see the data before it is used for fingerprinting.

TODO: say this in your own words.

## 2. What I built

Starting points already in the repo (keep your piece clearly separate from the 3D app):

- `Experiments/Analysis/AP_location_rough_estimate.py` reads collector CSVs with pandas.
- The collector README has a pandas recipe that turns a CSV into a fingerprint table.

TODO.

## 3. Method and test setup

TODO: which data sets you parsed and how you checked that the parsing is correct.

## 4. Results

TODO: plots and numbers, for example RSSI over x/y, RSSI distribution per AP, scans per point, and rows dropped as bad or duplicate.

## 5. What the results mean for the design

TODO.

## 6. Limitations and next steps

TODO.

## 7. Demo steps

TODO: the command to run on a sample CSV and what it shows.

## 8. Files

TODO.
