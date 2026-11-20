"""Build the preliminary EER access-point location list and check it against survey scans.

Input 1: the probe sheet exported as CSV (Google Sheet "waps-eer"). Columns:
    A  AP name from UT ITS, e.g. AP-EER2N1D04-EER-2-601 (building EER, floor 2, room 2.601)
    B  base MAC address
    D  "x, y" plan-sheet position in ft, read off the collector dashboard
    E  "x, y ft" building-frame position, read off the collector dashboard
    F/G  notes
Input 2 (optional): collector survey CSVs. Every BSSID heard in them is matched to a listed AP by
its first five MAC octets, because one AP broadcasts several SSIDs on BSSIDs that differ only in
the last octet.

Usage:
    py -3 build_ap_location_list.py waps-eer-probed.csv [survey.csv ...] [--out ap_locations_eer.csv]
"""
import argparse
import collections
import csv
import json
import re
import sys

NAME_RE = re.compile(r"-(EER|ECJ)-(\w+)-(\w+)$")


def parse_xy(cell):
    nums = re.findall(r"-?\d+(?:\.\d+)?", cell or "")
    return (float(nums[0]), float(nums[1])) if len(nums) >= 2 else None


def load_sheet(path):
    aps = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.reader(f):
            row += [""] * (7 - len(row))
            name, mac = row[0].strip(), row[1].strip().lower()
            if not name or not mac:
                continue
            m = NAME_RE.search(name)
            floor = room = ""
            if m:
                floor = "B" if m.group(2) == "0" else m.group(2)
                room = f"{m.group(2)}.{m.group(3)}"
            plan, frame = parse_xy(row[3]), parse_xy(row[4])
            aps.append({
                "ap": name, "mac": mac, "building": "EER", "floor": floor, "room": room,
                "plan_x_ft": plan[0] if plan else "", "plan_y_ft": plan[1] if plan else "",
                "frame_x_ft": frame[0] if frame else "", "frame_y_ft": frame[1] if frame else "",
                "note": " ".join(c.strip() for c in row[5:] if c.strip()),
            })
    return aps


def heard_bssids(paths):
    """Return {bssid: (ssid, max rssi)} over all scan replies in the survey CSVs."""
    csv.field_size_limit(1 << 30)
    out = {}
    for p in paths:
        with open(p, newline="", encoding="utf-8", errors="replace") as f:
            for r in csv.DictReader(f):
                if r.get("type") != "scan" or r.get("dir") != "in":
                    continue
                try:
                    msg = json.loads(r["line"])
                except (json.JSONDecodeError, KeyError):
                    continue
                for a in msg.get("aps", []):
                    b = a["bssid"].lower()
                    best = out.get(b, (a.get("ssid", ""), -999))[1]
                    out[b] = (a.get("ssid", ""), max(best, a["rssi"]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("surveys", nargs="*")
    ap.add_argument("--out", default="ap_locations_eer.csv")
    a = ap.parse_args()

    aps = load_sheet(a.sheet)
    located = [x for x in aps if x["plan_x_ft"] != ""]
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(aps[0]))
        w.writeheader()
        w.writerows(aps)

    print(f"APs in list: {len(aps)}; located: {len(located)}; wrote {a.out}")
    per_floor = collections.Counter(x["floor"] for x in located)
    order = ["B"] + [str(i) for i in range(1, 9)]
    print("Located per floor:", ", ".join(f"{k}: {per_floor[k]}" for k in order if per_floor[k]))
    rooms = collections.Counter(x["room"] for x in located)
    print(f"Distinct rooms: {len(rooms)}; rooms with 2+ APs: {sum(1 for v in rooms.values() if v > 1)}")

    if a.surveys:
        by_prefix = {x["mac"][:14]: x for x in aps}
        heard = heard_bssids(a.surveys)
        campus = {b: v for b, v in heard.items() if v[0] in ("utexas", "eduroam", "utguest", "")}
        hit = {b: by_prefix[b[:14]] for b in heard if b[:14] in by_prefix}
        campus_hit = [b for b in campus if b in hit]
        phys = {x["ap"] for x in hit.values()}
        print(f"Survey files: {len(a.surveys)}; BSSIDs heard: {len(heard)}; "
              f"matched to a listed AP: {len(hit)}")
        print(f"Campus-SSID BSSIDs (utexas/eduroam/utguest/hidden): {len(campus)}; "
              f"matched: {len(campus_hit)}")
        print(f"Physical APs those BSSIDs belong to: {len(phys)}")
        fl = collections.Counter(x["floor"] for x in {x["ap"]: x for x in hit.values()}.values())
        print("  by floor:", ", ".join(f"{k}: {fl[k]}" for k in order if fl[k]))
        strongest = sorted(((v[1], b) for b, v in heard.items() if b in hit), reverse=True)[:8]
        print("Strongest matched BSSIDs:")
        for rssi, b in strongest:
            x = hit[b]
            print(f"  {rssi:>4} dBm  {b}  {x['ap']}  floor {x['floor']}  "
                  f"plan ({x['plan_x_ft']}, {x['plan_y_ft']})")


if __name__ == "__main__":
    sys.exit(main())
