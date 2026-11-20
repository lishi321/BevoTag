# System Design Report Answers: Li Shi

**Your risk reduction demo:** Web app 3D model and signal map

Write under each **Answer:** line, then commit and push by **Sun Nov 22**. Edit only this file. "Don't know" is fine. The full context for each question is in [../team-questions.md](../team-questions.md).

## Risk reduction (Section 3.2)

**Q1.** Have you run or seen the full survey test? If so, what were the **room hit rate** and the **median position error**? Where are the raw capture files?

**Answer:**


**Q2.** Antenna test: what was the RSSI change across directions for the **PCB antenna** vs. the **omnidirectional antenna**? Is the test done, or still planned?

**Answer:**


**Q3.** Your demo, *Web app 3D model and signal map*:

- **What you built** (files or paths in the repo, tools, hardware):

- **How you tested it** (where, when, setup, number of trials):

- **Results** (numbers, tables, screenshots; put images in `../figures/`):

- **What didn't work or is still unfinished:**

- **What it means for the design** (which risk it reduced or confirmed):


**Q4.** Do you have **photos** of the test setups (tripod, boards, antennas, the survey in EER)? Put them in `../figures/` and list them here.

**Answer:**


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
