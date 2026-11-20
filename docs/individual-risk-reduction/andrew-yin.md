# Individual Risk Reduction: Preliminary List of Wi-Fi Access Point Locations

| | |
|---|---|
| **Student** | Andrew Yin |
| **Team** | BevoTag (SP11) |
| **Technical TA** | Michael Zhao |
| **Faculty mentor** | Dr. Haris Vikalo |
| **Due** | Fri Nov 20, 2026, 5:00 pm |

## 1. Risk addressed

BevoTag locates a tag from the Wi-Fi access points (APs) it hears, so the system needs to know where those APs are. Without AP positions, the team cannot check a fingerprint estimate against the building or replace the simulator's assumed "one AP in every room" layout with real positions. Abhirit's list answers which APs exist in EER; my activity answers where each one is.

## 2. What I built

I built a preliminary location list of 299 EER APs on floors B through 7, recorded in the team's `waps-eer` sheet. I also wrote `Experiments/Analysis/build_ap_location_list.py`, which converts that sheet into a clean table (AP, MAC, floor, room, plan x/y, building-frame x/y, notes). The script also reads collector survey logs and matches every BSSID heard to a physical AP on the list.

## 3. Method and test setup

I started from the UT ITS AP list, which gives each AP's name, base MAC address and the room in its name (for example, `AP-EER2N1D04-EER-2-601` is in EER 2.601). For each AP I stood directly under it with the ESP32 DAQ board on the tripod and started collecting in the Signal Studio dashboard. I confirmed which AP I was under by checking that the strongest BSSID matched that AP's MAC, then wrote down the coordinates the dashboard showed for my position. To cross-check the list, I ran it against the 10 survey logs from EER Level 2 (Oct 11 and Nov 8, 2026, three survey positions), matching BSSIDs to APs by their first five MAC octets, because one AP broadcasts several SSIDs whose BSSIDs differ only in the last octet.

## 4. Results

I located 299 of the 301 APs on the EER list, covering 167 rooms across 8 floors; 57 rooms have two or more APs. In the survey logs, 69 of the 200 BSSIDs heard belong to 23 listed APs; the other BSSIDs are hotspots and other non-campus networks. From the Level 2 survey positions, the tag heard listed APs on five floors (B: 5, 1: 6, 2: 3, 3: 3, 7: 2), and the strongest was AP EER-2-501 (D19) at −62 dBm. In rooms 1.516 and 1.504, only one of the listed APs (1.516: D03; 1.504: D29) was audible from the floor.

| Floor | B | 1 | 2 | 3 | 4 | 5 | 6 | 7 | Total |
|---|---|---|---|---|---|---|---|---|---|
| APs located | 57 | 76 | 25 | 22 | 24 | 25 | 24 | 24 | **299** |
| Heard from Level 2 survey | 5 | 6 | 3 | 3 | 0 | 0 | 0 | 2 | **19** + 4 unnamed |

**Level 2 AP locations** (all 299 rows are in `ap_locations_eer.csv`):

| AP | MAC | Room | Plan x, y (ft) | Building frame x, y (ft) |
|---|---|---|---|---|
| EER2N1D01 | e4:a4:1c:9a:90:a0 | 2.632 | 114.2, 221.5 | 146.0, 234.2 |
| EER2N1D02 | e4:a4:1c:9a:54:c0 | 2.632 | 104.6, 200.3 | 146.3, 245.1 |
| EER2N1D03 | e4:a4:1c:98:ed:00 | 2.631 | 92.0, 234.1 | 72.9, 198.5 |
| EER2N1D04 | e4:a4:1c:9d:9f:60 | 2.601 | 123.0, 250.6 | 89.1, 193.4 |
| EER2N1D05 | e4:a4:1c:9a:1d:00 | 2.601 | 176.8, 191.2 | 53.7, 184.4 |
| EER2N1D06 | e4:a4:1c:9a:6f:00 | 2.601 | 63.6, 271.9 | 117.1, 193.6 |
| EER2N1D07 | e4:a4:1c:98:e9:c0 | 2.601 | 174.2, 202.3 | 89.5, 232.5 |
| EER2N1D08 | e4:a4:1c:98:da:00 | 2.601 | 167.8, 307.1 | 93.7, 143.3 |
| EER2N1D09 | e4:a4:1c:9e:f1:a0 | 2.601 | 113.9, 306.2 | 123.8, 269.7 |
| EER2N1D11 | 08:7b:87:0d:ee:a0 | 2.686 | 152.6, 268.4 | 61.4, 160.8 |
| EER2N1D12 | e4:a4:1c:9e:d4:00 | 2.686 | 58.6, 245.2 | 88.4, 238.9 |
| EER2N1D16 | 08:7b:87:0d:eb:60 | 2.501 | 66.8, 188.4 | 126.3, 215.7 |
| EER2N1D17 | 08:7b:87:0d:a7:e0 | 2.518 | 117.5, 206.6 | 56.0, 209.2 |
| EER2N1D18 | 08:7b:87:0d:ea:00 | 2.501 | 135.4, 185.5 | 97.6, 197.1 |
| EER2N1D19 | 08:7b:87:0d:eb:40 | 2.501 | 63.7, 230.7 | 73.0, 172.7 |
| EER2N1D20 | e4:a4:1c:a4:7b:00 | 2.502 | 175.0, 292.2 | 132.4, 167.9 |
| EER2N1D21 | e4:a4:1c:9e:d5:c0 | 2.504 | 203.9, 236.2 | 75.1, 179.8 |
| EER2N1D22 | 08:7b:87:0d:ad:a0 | 2.502 | 127.0, 240.9 | 24.7, 162.5 |
| EER2N1D23 | e4:a4:1c:a4:7a:00 | 2.518 | 80.4, 254.5 | 90.4, 145.3 |
| EER2N1D24 | e4:a4:1c:a4:79:40 | 2.603 | 62.3, 238.0 | 26.3, 246.2 |
| EER2N1D25 | e4:a4:1c:a4:7b:40 | 2.603 | 212.8, 252.2 | 128.8, 255.6 |
| EER2N1D26 | e4:a4:1c:a4:78:e0 | 2.603 | 128.8, 233.9 | 82.4, 250.4 |
| EER2N1D27 | 08:7b:87:0d:ee:e0 | 2.603 | 60.6, 312.4 | 62.1, 181.4 |
| EER2N1D28 | 70:bc:48:50:e9:40 | 2.603 | 140.9, 292.1 | 72.6, 257.7 |
| EER2S1D01 | e4:a4:1c:9a:ab:c0 | 2.807 | 187.6, 192.6 | 99.9, 147.4 |

## 5. What the results mean for the design

The tag hears APs from five floors while standing on Level 2, so floor estimation cannot assume that the strongest APs are on the tag's own floor; the location server needs each AP's floor, which this list provides. Matching by the first five MAC octets turns 69 BSSIDs into 23 physical APs, so the fingerprint database can store one entry per AP instead of three per AP. The list can replace the simulator's assumed one-AP-per-room positions in Signal Studio and gives the team a reference for checking fingerprint estimates on every floor of EER.

## 6. Limitations and next steps

The list covers EER only; ECJ (103 APs on the ITS list) is next. Two listed APs have no position, the 34 `NO-ACO-AP` entries have no room or floor in their names, and some APs in rooms 1.516 and 1.504 were not audible from the floor, so they may be disabled or mounted above the ceiling.

## 7. Demo steps

1. In `Experiments/Analysis/`, run `py -3 build_ap_location_list.py ap_locations/waps-eer-probed.csv <survey CSVs> --out ap_locations/ap_locations_eer.csv`.
2. Show the printed counts: 299 APs located on 8 floors, and 69 heard BSSIDs matched to 23 APs.
3. Open `ap_locations_eer.csv` and look up an AP the board hears, for example EER-2-501 (D19).
4. Start Signal Studio (`Experiments/Campus_Map/start-webapp.bat`), open EER Level 2, and click that AP's plan coordinates to show where it sits.

## 8. Files

- `Experiments/Analysis/build_ap_location_list.py`: builds the list and matches survey BSSIDs to APs.
- `Experiments/Analysis/ap_locations/waps-eer-probed.csv`: export of the `waps-eer` probe sheet.
- `Experiments/Analysis/ap_locations/ap_locations_eer.csv`: the cleaned location list (299 APs).
- Survey logs: `data-from-drive/data/` (Oct 11 and Nov 8 EER Level 2 captures). The repo's `.gitignore` excludes `*.csv`, so the CSV files are shared on the team Drive instead of committed.
