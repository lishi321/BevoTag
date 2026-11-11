"""Compute the numbers behind every chart in the Oral Design Review deck.

Usage:  py -3 chart_data.py <data-from-drive folder> <output json>

Inputs are the raw collector CSVs and UT IT's access point lists from the team Drive.
Every figure on the slides comes from the JSON this script writes.
"""
import csv
import json
import os
import statistics as st
import sys
from collections import defaultdict
from datetime import datetime

csv.field_size_limit(10**9)
ROOT, OUT = sys.argv[1], sys.argv[2]
D1011 = os.path.join(ROOT, "data", "10_11 EER Test Capture")
D1108 = os.path.join(ROOT, "data", "11_8 Test Capture (Isotropic Antenna)")


def ts(s):
    return datetime.fromisoformat(s.replace("Z", ""))


def rows(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        for r in csv.DictReader(fh):
            if r.get("dir") != "in" or not r.get("host_time"):
                continue
            try:
                j = json.loads(r["line"])
            except (json.JSONDecodeError, TypeError):
                continue
            if isinstance(j, dict):
                yield r, j


def radio(bssid):
    """One physical radio broadcasts eduroam/utguest/utexas-iot on BSSIDs that differ only in the last hex digit."""
    return bssid.upper()[:-1]


# UT IT access point lists: base radio MAC -> AP name such as AP-EER0S1D01-EER-0-806.
ap_names = {}
for fn in ("waps-eer.csv", "waps-ecj.csv"):
    with open(os.path.join(ROOT, "AP Information", fn), encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if "," in line:
                name, mac = line.rsplit(",", 1)
                ap_names[radio(mac.strip())] = name.strip()
ut_ouis = {m[:8] for m in ap_names}


def ap_room(name):
    """'AP-EER0S1D01-EER-0-806' -> ('EER', '0.806'). Returns None for names without a room."""
    parts = name.split("-")
    if len(parts) >= 4 and parts[-3] in ("EER", "ECJ"):
        return parts[-3], f"{parts[-2]}.{parts[-1]}"
    return None


def scans(path):
    """List of (seconds from first scan, {radio: rssi}) for every RSSI scan in a capture."""
    out, t0 = [], None
    for r, j in rows(path):
        if j.get("type") == "scan" and "aps" in j:
            t = ts(r["host_time"])
            t0 = t0 or t
            per = {}
            for a in j["aps"]:
                k = radio(a["bssid"])
                per[k] = max(per.get(k, -200), a["rssi"])
            out.append(((t - t0).total_seconds(), per))
    return out


def compare(a, b):
    common = set(a) & set(b)
    d = [abs(a[k] - b[k]) for k in common]
    return {"median": st.median(d), "max": max(d), "one_direction_only": len(set(a) ^ set(b)), "common": len(common)}


result = {}

# 1. Antenna: RSSI change between facing north and facing east at the 2.813 south corridor point.
#    10/11 (onboard antenna) has one scan per direction, so 11/8 is compared one scan against one scan too,
#    pairing scan i facing north with scan i facing east and taking the median over all pairs.
on_n = scans(os.path.join(D1011, "bevotag_202610112050-d4bg_facingnorth.csv"))
on_e = scans(os.path.join(D1011, "bevotag_202610112212-6zf7_facing_east.csv"))
onboard = compare(on_n[0][1], on_e[0][1])
om_n = scans(os.path.join(D1108, "facingnorthcorner.csv"))
om_e = scans(os.path.join(D1108, "facingeastcorner.csv"))
pairs = [compare(a[1], b[1]) for a, b in zip(om_n, om_e)]
omni = {k: st.median(p[k] for p in pairs) for k in ("median", "max", "one_direction_only", "common")}
omni["pairs"] = len(pairs)
result["antenna"] = {"onboard_1011": onboard, "omni_1108": omni}

# 2. RSSI stability over the 3-minute RSSI phase (11/8, 2.813 corridor, facing north), strongest 5 radios.
mean_rssi = defaultdict(list)
for _, per in om_n:
    for k, v in per.items():
        mean_rssi[k].append(v)
top5 = sorted((k for k in mean_rssi if len(mean_rssi[k]) >= 0.9 * len(om_n)), key=lambda k: -st.mean(mean_rssi[k]))[:5]
series = []
for k in top5:
    room = ap_room(ap_names[k]) if k in ap_names else None
    label = f"AP in {room[1]}" if room else f"Radio {k}x"
    pts = [[round(t, 1), per.get(k)] for t, per in om_n]
    vals = [v for _, v in pts if v is not None]
    series.append({"label": label, "points": pts, "std": round(st.pstdev(vals), 2), "mean": round(st.mean(vals), 1)})
result["stability"] = {"scans": len(om_n), "duration_s": round(om_n[-1][0], 1), "series": series}

# 3. Access points heard per scan, indoor vs. outdoor plaza.
heard = {}
for label, path in [
    ("EER 2.813 corridor, 11/8", os.path.join(D1108, "facingnorthcorner.csv")),
    ("EER 2.701 staircase, 11/8", os.path.join(D1108, "facingnorthstaircasecorner.csv")),
    ("EER 2.813 corridor, 10/11", os.path.join(D1011, "bevotag_202610112212-6zf7_facing_east.csv")),
    ("PMA plaza NW corner, 10/11", os.path.join(D1011, "NWcornerofPMAsquare.csv")),
    ("PMA plaza SW corner, 10/11", os.path.join(D1011, "SWcornerofPMAsquare.csv")),
]:
    s = [s for s in rows(path) if s[1].get("type") == "scan" and "aps" in s[1]]
    heard[label] = round(st.mean(len(j["aps"]) for _, j in s), 1)
result["aps_per_scan"] = heard

# 4. CSI frames per second and who sent them.
def csi_capture(path):
    t0 = t1 = None
    counts = {"campus_ap": 0, "randomized": 0, "other": 0}
    for r, j in rows(path):
        if j.get("type") == "session" or j.get("type") == "scan":
            pass
        if j.get("type") != "csi":
            continue
        t = ts(r["host_time"])
        t0 = t0 or t
        t1 = t
        mac = j["mac"].upper()
        if mac[1] in "26AE":  # locally administered bit set: randomized phone/laptop MAC
            counts["randomized"] += 1
        elif mac[:8] in ut_ouis:
            counts["campus_ap"] += 1
        else:
            counts["other"] += 1
    dur = (t1 - t0).total_seconds()
    return {k: round(v / dur, 2) for k, v in counts.items()} | {"seconds": round(dur), "frames": sum(counts.values())}

result["csi"] = {
    label: csi_capture(path)
    for label, path in [
        ("2.813 N, 10/11", os.path.join(D1011, "bevotag_202610112050-d4bg_facingnorth.csv")),
        ("2.813 E, 10/11", os.path.join(D1011, "bevotag_202610112212-6zf7_facing_east.csv")),
        ("2.701 N, 10/11", os.path.join(D1011, "bevotag_202610112212-6zf7_facing north.csv")),
        ("Plaza NW, 10/11", os.path.join(D1011, "NWcornerofPMAsquare.csv")),
        ("Plaza SW, 10/11", os.path.join(D1011, "SWcornerofPMAsquare.csv")),
        ("2.813 N, 11/8", os.path.join(D1108, "facingnorthcorner.csv")),
        ("2.813 E, 11/8", os.path.join(D1108, "facingeastcorner.csv")),
        ("2.701 N, 11/8", os.path.join(D1108, "facingnorthstaircasecorner.csv")),
        ("2.701 E, 11/8", os.path.join(D1108, "facingeaststaircasecorner.csv")),
    ]
}

# 5. CSI amplitude per subcarrier for one campus AP heard at both 11/8 spots (facing north).
def csi_amplitude(path):
    amps = defaultdict(list)
    for _, j in rows(path):
        if j.get("type") == "csi" and j.get("len") == 128 and len(j.get("data", [])) == 128:
            d = j["data"]
            amps[j["mac"].upper()].append([(d[2 * i] ** 2 + d[2 * i + 1] ** 2) ** 0.5 for i in range(64)])
    return amps

amp_c = csi_amplitude(os.path.join(D1108, "facingnorthcorner.csv"))
amp_s = csi_amplitude(os.path.join(D1108, "facingnorthstaircasecorner.csv"))
shared = sorted((m for m in amp_c if m in amp_s and radio(m) in ap_names), key=lambda m: -min(len(amp_c[m]), len(amp_s[m])))
mac = shared[0]
mean_c = [st.mean(f[i] for f in amp_c[mac]) for i in range(64)]
mean_s = [st.mean(f[i] for f in amp_s[mac]) for i in range(64)]
active = [i for i in range(64) if mean_c[i] > 0.5 and mean_s[i] > 0.5]
room = ap_room(ap_names[radio(mac)])
result["csi_amplitude"] = {
    "mac": mac, "ap_room": room[1] if room else None,
    "frames": {"corridor": len(amp_c[mac]), "staircase": len(amp_s[mac])},
    "subcarriers": active,
    "corridor": [round(mean_c[i], 2) for i in active],
    "staircase": [round(mean_s[i], 2) for i in active],
}

# 6. Strongest 10 UT access points at the 2.813 corridor point (11/8, facing north), by installed floor.
ranked = sorted((k for k in mean_rssi if k in ap_names and ap_room(ap_names[k])), key=lambda k: -st.mean(mean_rssi[k]))[:10]
result["floors"] = [
    {"room": ap_room(ap_names[k])[1], "floor": ap_room(ap_names[k])[1].split(".")[0], "rssi": round(st.mean(mean_rssi[k]), 1)}
    for k in ranked
]

with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(result, fh, indent=1)
print(json.dumps({k: v for k, v in result.items() if k not in ("stability", "csi_amplitude")}, indent=1))
print("stability", [(s["label"], s["mean"], s["std"]) for s in series], result["stability"]["scans"], result["stability"]["duration_s"])
print("csi_amplitude", result["csi_amplitude"]["mac"], result["csi_amplitude"]["ap_room"], result["csi_amplitude"]["frames"], len(active))
