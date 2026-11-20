# Individual Risk Reduction: List of Wi-Fi Access Points in EER and ECJ

| | |
|---|---|
| **Student** | Abhirit Das |
| **Team** | BevoTag (SP11) |
| **Technical TA** | Michael Zhao |
| **Faculty mentor** | Dr. Haris Vikalo |
| **Due** | Fri Nov 20, 2026, 5:00 pm |

> **Grading (0 to 10, Technical TA):** (1) follows the guidelines, (2) done before the deadline,
> and (3) achieves **useful, significant results**. Point 3 matters most, so show measured numbers
> and say what they mean for the design.

## 1. Risk addressed

Fingerprinting and any AP-based position estimate need to know which physical APs exist in each building. One AP broadcasts several SSIDs and bands, each on its own BSSID, so a raw scan overcounts APs.

TODO: say this in your own words.

## 2. What I built

Useful starting points:

- Survey scans from the Signal Studio collector (CSV) contain every BSSID, SSID and channel heard.
- `rank_rooms_by_rssi.py` (Ethan, `eer-survey-collector` branch) groups BSSIDs into physical APs by their first 11 hex digits, and campus AP names such as `AP-ECJ3A6H02-ECJ-3-100` include the building, floor and room.

TODO.

## 3. Method and test setup

TODO: which scans you used (where and when they were taken) and how you grouped BSSIDs into APs.

## 4. Results

TODO: a table of AP, building, floor, room (if named), SSIDs, BSSIDs and channel(s). Give the totals: APs per floor and BSSIDs per AP.

## 5. What the results mean for the design

TODO: for example, how many APs a tag can hear per floor, and whether that is enough for fingerprinting.

## 6. Limitations and next steps

TODO.

## 7. Demo steps

TODO.

## 8. Files

TODO.
