"""Step through the RSSI scans in a BevoTag data collection CSV and rank floors / rooms per scan.

Each collection CSV has one row per serial line from the DAQ, with the JSON payload in the
`line` column and the host's UTC ISO timestamp in `host_time`. RSSI scans look like
  {"type": "scan", "aps": [{"bssid", "ssid", "rssi", "ch"}, ...]}

Each AP broadcasts several SSIDs, each on a BSSID that differs from the AP's base MAC only in
the last hex digit, so BSSIDs are matched to APs on the first 11 hex digits.

AP names look like "AP-{Cable}-{Building}-{Floor}-{Room}", e.g. "AP-ECJ3A6H02-ECJ-3-100" is in
"ECJ 3.100". APs with no room in their name (e.g. "NO-ACO-AP-EER-800784") are listed by name.

Per scan:
  * Floor ranking: the --vote-k strongest physical APs each cast one vote for their floor.
    Floors are ranked by votes, ties broken by their strongest RSSI.
  * Room ranking: each room is scored by the strongest AP heard in it, strongest first.

Keys (interactive viewer):
    <- / ->  or  a / d      previous / next scan
    up / down or  w / s      jump 10 scans
    Home / End              first / last scan
    g                       go to scan number
    q / Esc                 quit

Usage:
    python scripts/rank_rooms_by_rssi.py data/facingeastcorner.csv
    python scripts/rank_rooms_by_rssi.py data/facingeastcorner.csv --start 25 --vote-k 3
    python scripts/rank_rooms_by_rssi.py data/facingeastcorner.csv --dump > out.txt
"""

import argparse
import csv
import glob
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_AP_LISTS = os.path.join(SCRIPT_DIR, "..", "data", "waps-*.csv")

# ...-{Building}-{Floor}-{Room}[-{Suffix}]   e.g. -ECJ-3-100, -EER-0-504A, -ECJ-2-356-H
ROOM_RE = re.compile(r"-(?P<bldg>[A-Z]{2,4})-(?P<floor>\d+)-(?P<room>\d+[A-Z]*)(?:-[A-Z]+)?$")
# ...-{Building}-{Room} with no floor separator   e.g. -ECJ-B111
ROOM_NOFLOOR_RE = re.compile(r"-(?P<bldg>[A-Z]{2,4})-(?P<room>[A-Z]\d+[A-Z]*)$")
# any building code in the name, for floor-less APs like NO-ACO-AP-EER-800784
BLDG_RE = re.compile(r"-([A-Z]{2,4})(?=-)")

WIDTH = 78
BAR = "―"

try:
    from zoneinfo import ZoneInfo
    CENTRAL = ZoneInfo("America/Chicago")
except Exception:  # no tz database (e.g. Windows without the tzdata package)
    CENTRAL = timezone(timedelta(hours=-6), "CST")


# ---------------------------------------------------------------- AP list

def mac_key(mac):
    """Normalize a MAC and drop its last hex digit (the per-SSID part)."""
    return mac.strip().lower().replace("-", ":")[:-1]


def location_from_ap_name(name):
    """Return (room, floor) parsed from an AP name; either may be None."""
    m = ROOM_RE.search(name)
    if m:
        return f"{m['bldg']} {m['floor']}.{m['room']}", f"{m['bldg']} {m['floor']}"
    m = ROOM_NOFLOOR_RE.search(name)
    if m:  # e.g. ECJ B111 -> floor "ECJ B"
        return f"{m['bldg']} {m['room']}", f"{m['bldg']} {m['room'][0]}"
    return None, None


def load_ap_lists(paths):
    """Return {mac_key: {"name", "room", "floor"}} from 'name,base_mac' CSVs."""
    aps = {}
    for path in paths:
        with open(path, newline="") as f:
            for row in csv.reader(f):
                if len(row) < 2 or not row[0].strip() or ":" not in row[1]:
                    continue  # blank line or header
                name, mac = row[0].strip(), row[1].strip()
                key = mac_key(mac)
                if key in aps and aps[key]["name"] != name:
                    print(f"warning: {mac} ({name}) collides with {aps[key]['name']}", file=sys.stderr)
                room, floor = location_from_ap_name(name)
                aps[key] = {"name": name, "room": room, "floor": floor}
    return aps


# ---------------------------------------------------------------- scans

def load_scans(path):
    """Return a list of scans: {"time": datetime|None, "label": str, "aps": [...]}, in file order."""
    scans = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("dir") != "in":
                continue
            try:
                payload = json.loads(row.get("line") or "")
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict) or payload.get("type") != "scan":
                continue
            aps = [ap for ap in payload.get("aps", []) if "bssid" in ap and "rssi" in ap]
            label = " ".join(x for x in (row.get("building"), row.get("room") or row.get("floor")) if x)
            scans.append({"time": parse_time(row.get("host_time")), "label": label, "aps": aps})
    return scans


def parse_time(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def fmt_time(t):
    if t is None:
        return "(no timestamp)"
    local = t.astimezone(CENTRAL)
    return f"{local:%Y-%m-%d  %H:%M:%S}.{local.microsecond // 1000:03d} {local.tzname()}"


def analyze(scan, aps, vote_k):
    """Annotate a scan's readings and compute its floor and room rankings."""
    rows = []
    for ap in scan["aps"]:
        info = aps.get(mac_key(ap["bssid"]))
        rows.append({
            "bssid": ap["bssid"].lower(),
            "ssid": ap.get("ssid", ""),
            "rssi": ap["rssi"],
            "ch": ap.get("ch"),
            "key": mac_key(ap["bssid"]),
            "info": info,
            "room": (info["room"] or info["name"]) if info else "?",
        })
    rows.sort(key=lambda r: r["rssi"], reverse=True)

    # one entry per physical AP: its strongest BSSID
    physical = {}
    for r in rows:
        if r["info"] and r["key"] not in physical:
            physical[r["key"]] = r
    physical = sorted(physical.values(), key=lambda r: r["rssi"], reverse=True)

    # floors: top-k physical APs vote
    votes = defaultdict(int)
    best_floor = {}
    for r in physical:
        floor = r["info"]["floor"] or floor_less_label(r["info"]["name"])
        best_floor[floor] = max(best_floor.get(floor, -999), r["rssi"])
    for r in physical[:vote_k]:
        votes[r["info"]["floor"] or floor_less_label(r["info"]["name"])] += 1
    floors = sorted(best_floor, key=lambda fl: (votes[fl], best_floor[fl]), reverse=True)
    floors = [(fl, votes[fl], best_floor[fl]) for fl in floors]

    # rooms: strongest AP heard in each room
    rooms = {}
    for r in physical:
        room = r["info"]["room"] or r["info"]["name"]  # floor-less APs stand alone
        if room not in rooms:
            rooms[room] = r
    rooms = [(r["info"]["room"] or "(no room)", r["rssi"], r["info"]["name"]) for r in rooms.values()]

    return rows, floors, rooms, min(vote_k, len(physical))


def floor_less_label(name):
    bldgs = BLDG_RE.findall(name + "-")  # last code wins: NO-ACO-AP-EER-800784 -> EER
    return f"{bldgs[-1]} ?" if bldgs else "?"


# ---------------------------------------------------------------- rendering

def rule(title=""):
    if not title:
        return BAR * WIDTH
    title = f" {title} "
    left = (WIDTH - len(title)) // 2
    return BAR * left + title + BAR * (WIDTH - left - len(title))


def render(scans, i, aps, vote_k, top, path):
    scan = scans[i]
    rows, floors, rooms, voters = analyze(scan, aps, vote_k)
    out = [
        rule("Bevotag Data Capture RSSI Analysis"),
        f"  File:     {os.path.basename(path)}",
        f"  Scan:     {i + 1} / {len(scans)}",
        f"  Time:     {fmt_time(scan['time'])}",
    ]
    if scan["label"]:
        out.append(f"  Labeled:  {scan['label']}")
    out += [
        rule(),
        f"  {'ROOM':<14}{'MAC':<19}{'RSSI':>6}  {'SSID':<20}{'Channel':>7}",
        f"  {'':<14}{'Address':<19}{'(dBm)':>6}  {'':<20}{'Number':>7}",
    ]

    bands = [("2.4 GHz Wifi", lambda ch: ch is None or ch <= 14), ("5 GHz Wifi", lambda ch: ch is not None and ch > 14)]
    for band, in_band in bands:
        band_rows = [r for r in rows if in_band(r["ch"])]
        if not band_rows and band != "2.4 GHz Wifi":
            continue
        out.append(rule(band))
        if not band_rows:
            out.append("  (no APs in this scan)")
        for r in band_rows:
            room = r["room"] if len(r["room"]) <= 13 else r["room"][:12] + "…"
            ssid = r["ssid"] if len(r["ssid"]) <= 19 else r["ssid"][:18] + "…"
            ch = "" if r["ch"] is None else r["ch"]
            out.append(f"  {room:<14}{r['bssid']:<19}{r['rssi']:>6}  {ssid:<20}{ch:>7}")

    out.append(rule(f"Floor Rankings (top {voters} APs vote)"))
    if not floors:
        out.append("  (no known APs heard)")
    for n, (fl, v, best) in enumerate(floors, 1):
        out.append(f"  {n:>2}. {fl:<12} {v} vote{'s' if v != 1 else ' '}   strongest {best:>4} dBm")

    out.append(rule("Room Rankings (strongest AP in room)"))
    if not rooms:
        out.append("  (no known APs heard)")
    shown = rooms[:top] if top else rooms
    for n, (room, rssi, name) in enumerate(shown, 1):
        out.append(f"  {n:>2}. {room:<14} {rssi:>4} dBm   {name}")
    if top and len(rooms) > top:
        out.append(f"      ... {len(rooms) - top} more")

    unknown = sum(1 for r in rows if not r["info"])
    if unknown:
        out.append(f"  ({unknown} BSSID{'s' if unknown != 1 else ''} not in the AP list, room shown as ?)")
    out.append(rule())
    return "\n".join(out)


# ---------------------------------------------------------------- keyboard

def read_key():
    """Return one of: left right up down home end goto quit, or None for an unbound key."""
    if os.name == "nt":
        import msvcrt
        ch = msvcrt.getwch()
        if ch in ("\x00", "\xe0"):
            return {"K": "left", "M": "right", "H": "up", "P": "down", "G": "home", "O": "end"}.get(msvcrt.getwch())
    else:
        import termios
        import tty
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            tty.setraw(fd)
            ch = sys.stdin.read(1)
            if ch == "\x1b":
                seq = sys.stdin.read(2) if select_ready(fd) else ""
                if seq.startswith("[") and seq[1:] in ("1", "4", "5", "6") and select_ready(fd):
                    sys.stdin.read(1)  # trailing "~"
                return {"[D": "left", "[C": "right", "[A": "up", "[B": "down", "[H": "home",
                        "[F": "end", "[1": "home", "[4": "end", "": "quit"}.get(seq)
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)
    return {"a": "left", "d": "right", "w": "up", "s": "down", "g": "goto",
            "q": "quit", "\x1b": "quit", "\x03": "quit"}.get(ch.lower())


def select_ready(fd):
    import select
    return bool(select.select([fd], [], [], 0.05)[0])


def interactive(scans, aps, args, path):
    i = max(0, min(args.start - 1, len(scans) - 1))
    while True:
        sys.stdout.write("\x1b[2J\x1b[H")
        print(render(scans, i, aps, args.vote_k, args.top, path))
        print("  <-/-> step   up/down +-10   Home/End   g goto   q quit")
        key = read_key()
        if key == "quit":
            return
        if key == "goto":
            try:
                i = int(input("  Go to scan #: ")) - 1
            except (ValueError, EOFError):
                pass
        else:
            i += {"left": -1, "right": 1, "up": -10, "down": 10, "home": -len(scans), "end": len(scans)}.get(key, 0)
        i = max(0, min(i, len(scans) - 1))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("csv", help="collection CSV file (a glob is fine if it matches one file)")
    p.add_argument("--ap-list", nargs="+", default=None,
                   help=f"AP name,base_mac CSV(s) (default: {os.path.normpath(DEFAULT_AP_LISTS)})")
    p.add_argument("--vote-k", type=int, default=5, help="how many of the strongest APs vote on the floor (default: 5)")
    p.add_argument("--top", type=int, default=10, help="rooms to show in the room ranking, 0 for all (default: 10)")
    p.add_argument("--start", type=int, default=1, help="scan number to start at (default: 1)")
    p.add_argument("--dump", action="store_true",
                   help="print every scan one after another instead of the interactive viewer")
    args = p.parse_args()

    matches = sorted(glob.glob(args.csv)) or [args.csv]
    if len(matches) > 1:
        p.error(f"{args.csv} matches {len(matches)} files; pass one")
    path = matches[0]
    ap_paths = [m for pat in (args.ap_list or [DEFAULT_AP_LISTS]) for m in sorted(glob.glob(pat))]
    if not ap_paths:
        p.error("no AP list files found; pass --ap-list")
    aps = load_ap_lists(ap_paths)

    scans = load_scans(path)
    if not scans:
        sys.exit(f"no RSSI scans found in {path}")

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if os.name == "nt":
        os.system("")  # turn on ANSI escape handling in the Windows console

    if args.dump or not (sys.stdin.isatty() and sys.stdout.isatty()):
        for i in range(len(scans)):
            print(render(scans, i, aps, args.vote_k, args.top, path))
            print()
    else:
        try:
            interactive(scans, aps, args, path)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
