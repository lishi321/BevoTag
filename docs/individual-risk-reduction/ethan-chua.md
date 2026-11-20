# Individual Risk Reduction: Firmware That Locates a Router by Logging the Strongest Signal

| | |
|---|---|
| **Student** | Ethan Chua |
| **Team** | BevoTag (SP11) |
| **Technical TA** | Michael Zhao |
| **Faculty mentor** | Dr. Haris Vikalo |
| **Due** | Fri Nov 20, 2026, 5:00 pm |

> **Grading (0 to 10, Technical TA):** (1) follows the guidelines, (2) done before the deadline,
> and (3) achieves **useful, significant results**. Point 3 matters most, so show measured numbers
> and say what they mean for the design.

## 1. Risk addressed

The design depends on knowing where each Wi-Fi access point (AP) is. This activity tests whether the ESP32 tag can find a router's position on its own by logging the strongest signal strength as it moves.

TODO: say this in your own words.

## 2. What I built

Starting points already in the repo (check that they match what you did):

- `Experiments/DAQ_Module/ESP Firmware/src/main.cpp` on `main`. Sending `{"cmd":"strongest"}` returns the single strongest AP (MAC, RSSI and SSID).
- "Added Highest RSSI detector loop" (Oct 12) and `Experiments/Analysis/scripts/rank_rooms_by_rssi.py` (Nov 11), both on the `eer-survey-collector` branch only. The script steps through scans and ranks floors and rooms by the strongest APs heard. **It is not merged to `main` yet.**

TODO.

## 3. Method and test setup

TODO: where (building, floor, rooms), when, the board and antenna, how you walked or placed the board, and how many scans or trials.

## 4. Results

TODO: numbers. For example, the logged RSSI along the walk, the estimated router position vs. its actual position (error in feet or meters), and how often the strongest AP was the nearest one.

## 5. What the results mean for the design

TODO: which risk this reduced or confirmed, and what it changes in the design.

## 6. Limitations and next steps

TODO.

## 7. Demo steps

1. Flash the board and open a serial monitor at 115200 baud.
2. Send `{"cmd":"strongest"}` and walk toward an AP; show RSSI rising.
3. TODO: show the logged run and the estimated router position.

## 8. Files

TODO: list the paths, and merge the `eer-survey-collector` work into `main` if it is part of this.
