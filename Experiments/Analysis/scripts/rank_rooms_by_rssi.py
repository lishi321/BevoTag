"""Rank rooms by the RSSI of the AP(s) located in them, from a BevoTag data collection CSV.

Each collection CSV has one row per serial line from the DAQ, with the JSON payload in the
`line` column. Two payload kinds carry RSSI:
  * {"type": "scan", "aps": [{"bssid", "ssid", "rssi", "ch"}, ...]}   (RSSI phase)
  * {"type": "csi",  "mac": ..., "rssi": ...}                         (CSI phase, per packet)

Each AP broadcasts several SSIDs, each on a BSSID that differs from the AP's base MAC only in
the last hex digit, so BSSIDs are matched to APs on the first 11 hex digits.

AP names look like "AP-{Cable}-{Building}-{Floor}-{Room}", e.g. "AP-ECJ3A6H02-ECJ-3-100" is in
"ECJ 3.100". APs with no room in their name (e.g. "NO-ACO-AP-EER-800784") are listed by name.

Usage:
    python scripts/rank_rooms_by_rssi.py data/facingeastcorner.csv data/facingnorthcorner.csv
    python scripts/rank_rooms_by_rssi.py data/*.csv --source both --stat median --top 10
    python scripts/rank_rooms_by_rssi.py data/facing*.csv --combine
"""

import argparse
import csv
import glob
import json
import os
import re
import statistics
import sys
from collections import defaultdict

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_AP_LISTS = os.path.join(SCRIPT_DIR, "..", "data", "waps-*.csv")

# ...-{Building}-{Floor}-{Room}[-{Suffix}]   e.g. -ECJ-3-100, -EER-0-504A, -ECJ-2-356-H
ROOM_RE = re.compile(r"-(?P<bldg>[A-Z]{2,4})-(?P<floor>\d+)-(?P<room>\d+[A-Z]*)(?:-[A-Z]+)?$")
# ...-{Building}-{Room} with no floor separator   e.g. -ECJ-B111
ROOM_NOFLOOR_RE = re.compile(r"-(?P<bldg>[A-Z]{2,4})-(?P<room>[A-Z]\d+[A-Z]*)$")

STATS = {
    "mean": statistics.fmean,
    "median": statistics.median,
    "max": max,
}


def mac_key(mac):
    """Normalize a MAC and drop its last hex digit (the per-SSID part)."""
    return mac.strip().lower().replace("-", ":")[:-1]


def room_from_ap_name(name):
    m = ROOM_RE.search(name)
    if m:
        return f"{m['bldg']} {m['floor']}.{m['room']}"
    m = ROOM_NOFLOOR_RE.search(name)
    if m:
        return f"{m['bldg']} {m['room']}"
    return None


def load_ap_lists(paths):
    """Return {mac_key: (ap_name, room)} from 'name,base_mac' CSVs."""
    aps = {}
    for path in paths:
        with open(path, newline="") as f:
            for row in csv.reader(f):
                if len(row) < 2 or not row[0].strip() or ":" not in row[1]:
                    continue  # blank line or header
                name, mac = row[0].strip(), row[1].strip()
                key = mac_key(mac)
                if key in aps and aps[key][0] != name:
                    print(f"warning: {mac} ({name}) collides with {aps[key][0]}", file=sys.stderr)
                aps[key] = (name, room_from_ap_name(name))
    return aps


def iter_rssi(path, source):
    """Yield (bssid, rssi) for every RSSI reading in a collection CSV."""
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("dir") != "in":
                continue
            try:
                payload = json.loads(row.get("line") or "")
            except json.JSONDecodeError:
                continue
            kind = payload.get("type")
            if kind == "scan" and source in ("scan", "both"):
                for ap in payload.get("aps", []):
                    if "bssid" in ap and "rssi" in ap:
                        yield ap["bssid"], ap["rssi"]
            elif kind == "csi" and source in ("csi", "both"):
                if "mac" in payload and "rssi" in payload:
                    yield payload["mac"], payload["rssi"]


def rank_rooms(paths, aps, source, stat):
    """Return (ranking, unmatched_bssid_count).

    ranking: list of dicts sorted strongest first, one per room, using the room's strongest AP.
    """
    readings = defaultdict(list)  # ap mac_key -> [rssi, ...] across all of that AP's SSIDs
    unmatched = set()
    for path in paths:
        for bssid, rssi in iter_rssi(path, source):
            key = mac_key(bssid)
            if key in aps:
                readings[key].append(rssi)
            else:
                unmatched.add(bssid.lower())

    best_per_room = {}
    for key, values in readings.items():
        name, room = aps[key]
        entry = {
            "room": room or f"(no room) {name}",
            "ap": name,
            "rssi": STATS[stat](values),
            "max": max(values),
            "n": len(values),
        }
        cur = best_per_room.get(entry["room"])
        if cur is None or entry["rssi"] > cur["rssi"]:
            best_per_room[entry["room"]] = entry

    ranking = sorted(best_per_room.values(), key=lambda e: e["rssi"], reverse=True)
    return ranking, len(unmatched)


def print_ranking(title, ranking, unmatched, stat, top):
    print(f"\n== {title} ==")
    if not ranking:
        print("  (no known APs seen)")
    shown = ranking[:top] if top else ranking
    width = max((len(e["room"]) for e in shown), default=4)
    print(f"  {'#':>3}  {'Room':<{width}}  {stat + ' dBm':>10}  {'max':>4}  {'n':>5}  AP")
    for i, e in enumerate(shown, 1):
        print(f"  {i:>3}  {e['room']:<{width}}  {e['rssi']:>10.1f}  {e['max']:>4}  {e['n']:>5}  {e['ap']}")
    if top and len(ranking) > top:
        print(f"  ... {len(ranking) - top} more")
    if unmatched:
        print(f"  ({unmatched} BSSIDs not in AP list were ignored)")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("csvs", nargs="+", help="collection CSV file(s); globs are expanded")
    p.add_argument("--ap-list", nargs="+", default=None,
                   help=f"AP name,base_mac CSV(s) (default: {os.path.normpath(DEFAULT_AP_LISTS)})")
    p.add_argument("--source", choices=["scan", "csi", "both"], default="scan",
                   help="which RSSI readings to use (default: scan)")
    p.add_argument("--stat", choices=list(STATS), default="mean",
                   help="how to aggregate an AP's readings (default: mean)")
    p.add_argument("--combine", action="store_true",
                   help="merge all input files into one ranking instead of one per file")
    p.add_argument("--top", type=int, default=0, help="only show the top N rooms")
    args = p.parse_args()

    csv_paths = [m for pat in args.csvs for m in (sorted(glob.glob(pat)) or [pat])]
    ap_paths = [m for pat in (args.ap_list or [DEFAULT_AP_LISTS]) for m in sorted(glob.glob(pat))]
    if not ap_paths:
        p.error("no AP list files found; pass --ap-list")
    aps = load_ap_lists(ap_paths)

    groups = [("combined: " + ", ".join(map(os.path.basename, csv_paths)), csv_paths)] if args.combine \
        else [(os.path.basename(path), [path]) for path in csv_paths]
    for title, paths in groups:
        ranking, unmatched = rank_rooms(paths, aps, args.source, args.stat)
        print_ranking(title, ranking, unmatched, args.stat, args.top)


if __name__ == "__main__":
    main()
