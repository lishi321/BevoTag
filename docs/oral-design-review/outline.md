# Oral Design Review: Slide Outline

Status: **draft for team review**. No slides have been built yet.

Course requirements come from *Instructions for the Oral Design Review* (ECE 364D):

- 20 minutes maximum, then about 5 minutes of questions. Every team member presents a portion.
- Submit the PowerPoint file to Dr. Vikalo on or before the day of the talk; keep a backup copy on the web.
- Assume the audience has not read our earlier reports. Explain the problem and walk through the block diagram early.
- Cite sources at the bottom of any slide whose data or images need citation.
- Required sections: Introduction, Design Objectives, Status Update, Conclusion, Questions.

## Format

- PowerPoint, 22 slides. The talk is slides 2 to 20: 19 slides in 20 minutes, about 1 minute each. If rehearsal runs long, cut slide 4 (agenda) or slide 6 (standards) first.
- White background, PowerPoint's default text, no decorative graphics.
- Visuals are limited to charts made from our capture data, screenshots of our web apps, our own photos, and plain block diagrams.
- Every slide has speaker notes, written so that any team member can deliver them. Speakers will be assigned later.
- Slides that need a hardware photo get an empty box labeled **[ATTACH PHOTO: ...]** and a reminder in the speaker notes.

## Introduction

1. **Title.** BevoTag, team SP11, the five team members, Dr. Haris Vikalo (mentor), Mugdha Jadhao (TA), date.
2. **Opener.** A laptop is left in an empty EER lab at night. An AirTag can report it only when a passing iPhone hears it, and GPS errors between tall buildings exceed 9 m (Yoder, cited in the Project Definition).
3. **Problem statement.** One sentence, then the four targets: correct room in more than 90% of trials, median position error under 5 m, an update at least every 10 s while moving, and at least 24 h per charge.
4. **Agenda.** The topics of the talk, in BevoTag terms.

## Design Objectives

5. **Requirements and key specifications.** How BevoTag meets the user's need, with a short table taken from the Project Definition's performance specifications.
6. **Standards and constraints.** One line each on how the standard shapes the design:
   - IEEE 802.11: defines the training fields that CSI comes from.
   - FCC Part 15: leads us to a pre-certified radio module.
   - IEC 62133-2: certified battery cell plus a protection circuit.
   - UT acceptable use policy and the utexas-iot network: the tag acts only as an ordinary network client.
7. **New vs. off-the-shelf.**

   | We design | We buy or reuse |
   |---|---|
   | ESP32 firmware | ESP32 board |
   | Survey collector web app | IMU and GPS modules |
   | 3D building model and signal map | Omnidirectional antenna |
   | Position estimation and fusion | Battery |
   | Location server and user app | 300 EER and 103 ECJ campus access points |

8. **Concept alternatives.** The three concepts the team considered:
   - GPS watch or bike computer (9/20 brainstorm)
   - Urban positioning system (9/1 project proposal)
   - Campus item tag (BevoTag, 10/15 Project Definition)

   Criteria: survey effort, user need, size, weight, power, and cost. The slide ends with why BevoTag won.
9. **Technical alternatives and selection criteria.** One row per decision, each scored on room accuracy, new infrastructure needed, power, and cost:

   | Decision | Options |
   |---|---|
   | Positioning signal | GNSS, BLE crowdsourcing, BLE beacons, UWB, Wi-Fi RSSI, Wi-Fi CSI |
   | Fusion filter | Extended Kalman filter vs. particle filter |
   | Where to compute the position | On the tag vs. on the server |
   | Fingerprint matching | k-nearest neighbors vs. neural network |

## Status Update

10. **Block diagram.** The Project Definition's input/output diagram, redrawn as plain boxes and arrows: tag, location server, user app, survey data.
11. **Original plan vs. now.** Built from the Project Definition and each weekly report's "next week" commitments.

    | Item | Status |
    |---|---|
    | Logger hardware (ESP32, IMU, GPS) | Acquired, week 3 |
    | Logger web app | Done, week 3 |
    | CSI capture firmware | Done, 10/11 |
    | AP list and floor plans from UT IT | Received, week 4 |
    | Omnidirectional antenna | Ordered week 4; first capture 11/8 |
    | 3D building model | Done, 10/21 |
    | Multi-floor survey, 5,000 samples per location | Partial: EER level 2 and the PMA plaza only |
    | Fingerprint model | Baseline k-NN only |
    | IMU/GPS fusion | Not started; no IMU or GPS data yet |
    | Tag PCB and system design | Starting |

12. **Capture setup.**
    - Photo: the tripod setup (`photos/daq-module.png`, outside the repo).
    - The ESP32 sits on a tripod at a fixed height and heading, connected by USB to a laptop running the collector at 115200 baud.
    - The operator marks the point on the floor plan and starts the CSV log.
    - The firmware runs a 3-minute RSSI phase (about 85 scans), then a 5-minute CSI phase.
    - Points: the 2.813 south corridor and the 2.701 staircase corner on EER level 2, each facing north and east, plus two points on the plaza by PMA.

### Risk reduction deliverables

Each of slides 13 to 17 has the same four parts: **Goal / What we did / Result / Decision**.

13. **Risk reduction 1: omnidirectional antenna.**
    - Chart: change in each AP's RSSI between facing north and facing east at the same spot, onboard antenna (10/11) vs. omnidirectional antenna (11/8).
    - Result: the typical change falls from 3.0 dB to 1.5 dB, and the largest change from 10 dB to 5 dB.
    - Caveat for the chart: 10/11 has one scan per direction, so the chart compares single scans from both days.
    - **[ATTACH PHOTO: antenna close-up, onboard vs. omnidirectional]**
14. **Risk reduction 2: ESP32 firmware.**
    - What it does: RSSI scans and CSI capture, sent to the laptop as JSON lines over serial.
    - Chart: CSI frames per second for each capture (14 to 25 on 10/11, about 7 on 11/8) and the share that comes from known UT access points.
    - Plot: the CSI amplitude pattern of one AP at the corridor point vs. the staircase point.
    - **[ATTACH PHOTO: ESP32 board]**
15. **Risk reduction 3: web app, part 1 (survey collector).**
    - Screenshot: the floor-plan view.
    - Covers connecting to the ESP32, placing survey points, and raw CSV logging.
    - Result: every capture file in the dataset was recorded with this tool.
16. **Risk reduction 4: web app, part 2 (3D model and signal map).**
    - Screenshots: the 3D Signal Studio with the real captures imported.
    - Facts: EER 9 levels, ECJ 15, ASE 7; 3,403 wall and room polygons; IFC and OBJ export.
    - Limits: floor heights are unverified, and positioning accuracy has not been measured.
17. **Risk reduction 5: data collection.**
    - Picture: the survey points on the EER level 2 floor plan.
    - Chart: RSSI over 3 minutes for the 5 strongest APs; each varies by less than 1 dB.
    - Stat: 29 to 36 APs heard per scan indoors vs. 101 to 104 on the outdoor plaza.
18. **Residual risks and plan.**
    - Room-level accuracy has not been measured. Plan: survey EER level 2 facing 4 directions at 3 times of day, and test on points held out of the survey.
    - CSI capture rate, power, and IMU fusion on the tag are unproven against the 24 h battery target.
19. **Team contributions.** A table with one row per member, filled from the weekly reports. **[DRAFT: team to confirm]**

## Conclusion

20. **Summary and assessment.**
    - Purpose of the review and the main points covered.
    - Impact of time and resource limits: about 2 weeks waiting on UT IT for the AP list, 2 people needed for every capture session, and a survey that covers EER level 2 only.
    - Our current assessment of the project outcome.
21. **Questions.**
22. **References.**

## Data sources

| Source | Used on |
|---|---|
| `docs/project-definition/main.tex` | Slides 2, 3, 5, 6, 7, 10 |
| `docs/prior-art/main.tex` | Slide 9 |
| 9/1 proposal form, 9/20 brainstorm notes | Slide 8 |
| Weekly status reports, weeks 1 to 7 | Slides 11, 19, 20 |
| 10/11 and 11/8 EER capture CSVs | Slides 12 to 17 |
| UT IT access point lists (`waps-eer.csv`, `waps-ecj.csv`) | Slides 7, 14 |
| `Experiments/Campus_Map/collector` web app | Slides 15, 16, 17 |
