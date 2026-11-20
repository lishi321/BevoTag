# System Design Report: Questions for the Team

The System Design Report is due **Fri Dec 4, 5:00 pm**. Please answer these questions on Discord by
**Sun Nov 22**, and quote the question number in your reply (for example, "Q3: ..."). "Don't know"
is a fine answer.

## Risk reduction (Section 3.2, the most heavily weighted part)

1. Has anyone run the full survey test yet? If so, what were the **room hit rate** and the
   **median position error**? Where are the raw capture files?
2. Antenna test: what was the RSSI change across directions for the **PCB antenna** vs. the
   **omnidirectional antenna**? Is the test done, or still planned?
3. For **your own** individual demo, give:
   - what you built
   - how you tested it
   - the result or numbers
   - anything that didn't work
4. Does anyone have **photos** of the test setups (tripod, boards, antennas, the survey in EER)?

## Feedback and design decisions (Sections 2.0 and 3.1)

5. What did Dr. Vikalo and Mugdha say at the **oral design review**? Did we agree to change
   anything?
6. Has the **Prior Art Report** been graded? If so, please share the comments.
7. Which of these are final, and which are still open?
   - Microcontroller (which ESP32 variant?)
   - IMU part
   - Battery type and capacity
   - CSI + RSSI, or RSSI only
   - Fusion method (Kalman filter, particle filter, or something else)
   - Where the location server runs (laptop, cloud, or campus VM)
8. Do we keep the Project Definition specs (>90% room hit rate, <5 m median error, ≤10 s updates,
   ≥24 h battery, ≤$50 per tag)? Should any of them change?
9. What are the main **subsystems** for the block diagram? The current guess is tag hardware →
   tag firmware → survey/fingerprint database → location server and fusion → user app. Is anything
   missing or wrong?

## EE 464 plan (Section 4.0 and the WBS, LRC, Gantt, and BOM appendixes)

10. What are the EE 464 dates: first week, demo day, Open House, and final report?
11. What do **you** want to own next semester (hardware, firmware, server/fusion, app/UI, testing,
    or documentation)? Should we keep this semester's split?
12. BOM: which parts have we already bought, and which still need to be ordered? Rough prices are
    fine. Are we planning a custom PCB or an enclosure?
13. What are the main tasks for spring? A bullet list is fine; it will be turned into the WBS and
    the Gantt chart.

## Writing logistics

14. Should one person write the first draft with everyone reviewing after, or should each person
    write their own sections? If you prefer to split, which section do you want?
15. Any ideas for the subtitle? ("System Design Report for BevoTag: ___")
