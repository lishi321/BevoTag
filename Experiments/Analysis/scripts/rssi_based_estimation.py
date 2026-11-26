"""Step through the RSSI scans in a BevoTag data collection CSV and rank floors / rooms per scan.

Each collection CSV has one row per serial line from the DAQ, with the JSON payload in the
`line` column and the host's UTC ISO timestamp in `host_time`. RSSI scans look like
  {"type": "scan", "aps": [{"bssid", "ssid", "rssi", "ch"}, ...]}

Each AP broadcasts several SSIDs, each on a BSSID that differs from the AP's base MAC only in
the last hex digit, so BSSIDs are matched to APs on the first 11 hex digits.

AP names look like "AP-{Cable}-{Building}-{Floor}-{Room}", e.g. "AP-ECJ3A6H02-ECJ-3-100" is in
"ECJ 3.100". APs with no room in their name (e.g. "NO-ACO-AP-EER-800784") are listed by name.
AP lists may carry a "Sheet (x,y) in ft" column with the AP's position on the floor sheet.

Per scan:
  * AP tables: 2.4 GHz and 5 GHz side by side, one row per physical router per band (its
    strongest BSSID), strongest first. The per-network last MAC digit is shown as "x", and the
    SSID column shows one network plus a count of the others the router serves ("utexas +3").
  * Floor ranking: the --vote-k strongest physical APs each cast one vote for their floor.
    Floors are ranked by votes, ties broken by their strongest RSSI.
  * Room ranking: each room is scored by the strongest AP heard in it, strongest first.
  * Particle estimate: candidate points are scattered over the floor and kept if their nearest
    positioned AP is the strongest one heard, their 2nd nearest is the 2nd strongest, and so on
    for the --num-participants strongest positioned APs. If no point satisfies the whole order,
    the points matching the longest leading part of it are kept (the output says how much).
    Only APs with a position take part, and every positioned AP (heard or not) counts as a
    possible "nearest AP".

Diagram (one per scan, replaced when the scan changes):
    blue dots = heard 5 GHz APs, red dots = heard 2.4 GHz APs (a router heard on both bands shows
    as a blue dot in a red ring), grey rings = positioned APs not heard, "n: rssi" labels = the
    participating APs' rank, green dots = particles, green + = particle centroid,
    black x = true scan location. x grows to the right, y grows downward (sheet coordinates).
    APs with no position in the AP list are not drawn.

Keys (interactive viewer; they also work while the diagram window has focus):
    <- / ->  or  a / d      previous / next scan
    up / down or  w / s      jump 10 scans
    Home / End              first / last scan
    g                       go to scan number (typed in the terminal)
    q / Esc                 quit

Usage:
    python scripts/rssi_based_estimation.py data/1-516.csv
    python scripts/rssi_based_estimation.py data/1-516.csv --num-participants 4 --no-use-24ghz
    python scripts/rssi_based_estimation.py data/1-516.csv --start 25 --vote-k 3
    python scripts/rssi_based_estimation.py data/1-516.csv --dump --plot-dir plots/1-516 > out.txt
"""

import argparse
import csv
import glob
import json
import os
import re
import sys
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from itertools import zip_longest

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_AP_LISTS = os.path.join(SCRIPT_DIR, "..", "ap_lists", "waps-*.csv")
POS_HEADER = "Sheet (x,y) in ft"   # AP-list column holding an AP's "x, y" on the floor sheet
PARTICLE_MARGIN_FT = 15            # particles are scattered over the APs' bounding box + this

# ...-{Building}-{Floor}-{Room}[-{Suffix}]   e.g. -ECJ-3-100, -EER-0-504A, -ECJ-2-356-H
ROOM_RE = re.compile(r"-(?P<bldg>[A-Z]{2,4})-(?P<floor>\d+)-(?P<room>\d+[A-Z]*)(?:-[A-Z]+)?$")
# ...-{Building}-{Room} with no floor separator   e.g. -ECJ-B111
ROOM_NOFLOOR_RE = re.compile(r"-(?P<bldg>[A-Z]{2,4})-(?P<room>[A-Z]\d+[A-Z]*)$")
# any building code in the name, for floor-less APs like NO-ACO-AP-EER-800784
BLDG_RE = re.compile(r"-([A-Z]{2,4})(?=-)")

COL_WIDTH = 58      # one band's AP table: room 13 + MAC 18 + RSSI 5 + gap 2 + SSID 16 + Ch 4
COL_SEP = " │ "     # between the 2.4 GHz and 5 GHz columns
WIDTH = 2 + COL_WIDTH + len(COL_SEP) + COL_WIDTH
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


def parse_xy(s):
    """Parse an "x, y" cell (units or parentheses are fine) into a float pair, or None."""
    nums = re.findall(r"-?\d+(?:\.\d+)?", s or "")
    return (float(nums[0]), float(nums[1])) if len(nums) >= 2 else None


def load_ap_lists(paths):
    """Return {mac_key: {"name", "room", "floor", "pos"}} from 'name,base_mac[,...]' CSVs.

    "pos" is the (x, y) from the POS_HEADER column if the file has one and the cell is filled,
    else None.
    """
    aps = {}
    for path in paths:
        pos_col = None
        with open(path, newline="") as f:
            for row in csv.reader(f):
                cells = [c.strip() for c in row]
                if pos_col is None and POS_HEADER in cells:
                    pos_col = cells.index(POS_HEADER)
                    continue
                if len(cells) < 2 or not cells[0] or ":" not in cells[1]:
                    continue  # blank line or header
                name, mac = cells[0], cells[1]
                key = mac_key(mac)
                if key in aps and aps[key]["name"] != name:
                    print(f"warning: {mac} ({name}) collides with {aps[key]['name']}", file=sys.stderr)
                room, floor = location_from_ap_name(name)
                pos = parse_xy(cells[pos_col]) if pos_col is not None and len(cells) > pos_col else None
                aps[key] = {"name": name, "room": room, "floor": floor, "pos": pos}
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
            scans.append({"time": parse_time(row.get("host_time")), "label": label, "aps": aps,
                          "x_ft": parse_float(row.get("x_ft")), "y_ft": parse_float(row.get("y_ft"))})
    return scans


def parse_float(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


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


def is_5ghz(ch):
    return ch is not None and ch > 14


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


def estimate_particles(rows, aps, n, use_24, samples, seed):
    """Scatter candidate points and keep those whose AP distance order matches the RSSI order.

    rows: analyze()'s rows (strongest first). The n strongest positioned physical APs (5 GHz
    readings only unless use_24) are the participants. A point's score is the length of the
    leading run where its k-th nearest positioned AP (out of every positioned AP, heard or not)
    is the k-th strongest participant. The best-scoring points are the particles.
    Returns None if no AP has a position, else a dict.
    """
    import numpy as np

    keys = [k for k, info in aps.items() if info.get("pos")]
    if not keys:
        return None
    P = np.array([aps[k]["pos"] for k in keys])
    index = {k: j for j, k in enumerate(keys)}
    lo, hi = P.min(axis=0) - PARTICLE_MARGIN_FT, P.max(axis=0) + PARTICLE_MARGIN_FT

    ranked = {}  # key -> strongest RSSI in the allowed bands, in descending RSSI order
    for r in rows:
        if r["key"] in index and r["key"] not in ranked and (use_24 or is_5ghz(r["ch"])):
            ranked[r["key"]] = r["rssi"]
    ranked = list(ranked.items())[:n]
    est = {"ranked": ranked, "wanted": n, "matched": 0, "particles": np.empty((0, 2)),
           "centroid": None, "bounds": (lo, hi)}
    if not ranked:
        return est

    pts = np.random.default_rng(seed).uniform(lo, hi, size=(samples, 2))
    dist = np.linalg.norm(pts[:, None, :] - P[None, :, :], axis=2)
    nearest = np.argsort(dist, axis=1)[:, :len(ranked)]
    target = np.array([index[k] for k, _ in ranked])
    score = np.cumprod(nearest == target, axis=1).sum(axis=1)
    best = int(score.max())
    if best:
        est["particles"] = pts[score == best]
        est["centroid"] = est["particles"].mean(axis=0)
    est["matched"] = best
    return est


# ---------------------------------------------------------------- rendering

def rule(title="", width=None):
    width = width or WIDTH
    if not title:
        return BAR * width
    title = f" {title} "
    left = (width - len(title)) // 2
    return BAR * left + title + BAR * (width - left - len(title))


def render(scans, i, aps, args, path):
    """Return (text, rows, est) for scan i."""
    scan = scans[i]
    rows, floors, rooms, voters = analyze(scan, aps, args.vote_k)
    est = estimate_particles(rows, aps, args.num_participants, args.use_24ghz,
                             args.particle_samples, seed=i)
    out = [
        rule("Bevotag Data Capture RSSI Analysis"),
        f"  File:     {os.path.basename(path)}",
        f"  Scan:     {i + 1} / {len(scans)}",
        f"  Time:     {fmt_time(scan['time'])}",
    ]
    if scan["label"]:
        out.append(f"  Labeled:  {scan['label']}")
    if scan["x_ft"] is not None and scan["y_ft"] is not None:
        out.append(f"  Location: x = {scan['x_ft']:.2f} ft, y = {scan['y_ft']:.2f} ft")
    else:
        out.append("  Location: (not recorded)")
    # 2.4 GHz and 5 GHz APs in two side-by-side columns
    header = [
        f"{'ROOM':<13}{'MAC':<18}{'RSSI':>5}  {'SSID':<16}{'Ch':>4}",
        f"{'':<13}{'Address':<18}{'(dBm)':>5}  {'':<16}{'':>4}",
    ]
    bands = [("2.4 GHz Wifi", lambda ch: not is_5ghz(ch)), ("5 GHz Wifi", is_5ghz)]
    columns = []
    for band, in_band in bands:
        # one row per physical router in this band: its strongest BSSID (rows are sorted by RSSI),
        # with the per-network last MAC digit shown as "x" and a count of the other networks it serves
        routers = {}
        for r in rows:
            if in_band(r["ch"]):
                routers.setdefault(r["key"], {"row": r, "ssids": set()})["ssids"].add(r["ssid"])
        lines = [rule(band, COL_WIDTH)] + header
        if not routers:
            lines.append("(no APs in this scan)")
        for router in routers.values():
            r = router["row"]
            room = r["room"] if len(r["room"]) <= 12 else r["room"][:11] + "…"
            extra = len(router["ssids"]) - 1
            ssid = r["ssid"] + (f" +{extra}" if extra else "")
            ssid = ssid if len(ssid) <= 15 else ssid[:14] + "…"
            ch = "" if r["ch"] is None else r["ch"]
            lines.append(f"{room:<13}{r['key'] + 'x':<18}{r['rssi']:>5}  {ssid:<16}{ch:>4}")
        columns.append(lines)
    for left, right in zip_longest(*columns, fillvalue=""):
        out.append(f"  {left:<{COL_WIDTH}}{COL_SEP}{right}".rstrip())

    out.append(rule(f"Floor Rankings (top {voters} APs vote)"))
    if not floors:
        out.append("  (no known APs heard)")
    for n, (fl, v, best) in enumerate(floors, 1):
        out.append(f"  {n:>2}. {fl:<12} {v} vote{'s' if v != 1 else ' '}   strongest {best:>4} dBm")

    out.append(rule("Room Rankings (strongest AP in room)"))
    if not rooms:
        out.append("  (no known APs heard)")
    shown = rooms[:args.top] if args.top else rooms
    for n, (room, rssi, name) in enumerate(shown, 1):
        out.append(f"  {n:>2}. {room:<14} {rssi:>4} dBm   {name}")
    if args.top and len(rooms) > args.top:
        out.append(f"      ... {len(rooms) - args.top} more")

    unknown = len({r["key"] for r in rows if not r["info"]})
    if unknown:
        out.append(f"  ({unknown} router{'s' if unknown != 1 else ''} not in the AP list, room shown as ?)")

    band_note = "2.4 + 5 GHz" if args.use_24ghz else "5 GHz only"
    out.append(rule(f"Particle Estimate (top {args.num_participants} positioned APs, {band_note})"))
    if est is None:
        out.append(f"  (no AP in the AP list has a '{POS_HEADER}' position)")
    elif not est["ranked"]:
        out.append("  (no positioned APs heard)")
    else:
        for n, (key, rssi) in enumerate(est["ranked"], 1):
            info = aps[key]
            x, y = info["pos"]
            out.append(f"  {n:>2}. {info['room'] or '(no room)':<14} {rssi:>4} dBm   "
                       f"({x:6.1f}, {y:6.1f}) ft   {info['name']}")
        got = len(est["ranked"])
        short = "" if got == est["wanted"] else f" (only {got} positioned AP{'s' if got != 1 else ''} heard)"
        out.append(f"  Order matched: {est['matched']} / {got}{short}   Particles: {len(est['particles'])}")
        if est["centroid"] is not None:
            cx, cy = est["centroid"]
            line = f"  Centroid: x = {cx:.2f} ft, y = {cy:.2f} ft"
            if scan["x_ft"] is not None and scan["y_ft"] is not None:
                err = ((cx - scan["x_ft"]) ** 2 + (cy - scan["y_ft"]) ** 2) ** 0.5
                line += f"   (error {err:.1f} ft)"
            out.append(line)
    out.append(rule())
    return "\n".join(out), rows, est


# ---------------------------------------------------------------- diagram

FIG_KEYS = {"left": "left", "a": "left", "right": "right", "d": "right", "up": "up", "w": "up",
            "down": "down", "s": "down", "home": "home", "end": "end", "g": "goto",
            "q": "quit", "escape": "quit"}


class Diagram:
    """One matplotlib figure per scan: show() closes the previous figure and opens the new one."""

    def __init__(self, display=True, save_dir=None):
        import matplotlib
        if not display:
            matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        self.plt, self.display, self.save_dir = plt, display, save_dir
        self.fig, self.keys = None, deque()
        plt.rcParams["figure.raise_window"] = False  # don't steal focus from the terminal
        for name in [n for n in plt.rcParams if n.startswith("keymap.")]:  # free the viewer's keys
            plt.rcParams[name] = [k for k in plt.rcParams[name] if k not in FIG_KEYS]
        if save_dir:
            os.makedirs(save_dir, exist_ok=True)

    def show(self, scans, i, aps, rows, est, args, path):
        plt = self.plt
        geometry = self._geometry()
        if self.fig is not None:
            plt.close(self.fig)
        self.fig = fig = plt.figure(figsize=(9, 8))
        draw_diagram(fig.add_subplot(), scans, i, aps, rows, est, args, path)
        fig.tight_layout()
        if self.save_dir:
            fig.savefig(os.path.join(self.save_dir, f"scan_{i + 1:04d}.png"), dpi=120)
        if self.display:
            fig.canvas.mpl_connect("key_press_event", self._on_key)
            self._restore(geometry)
            plt.show(block=False)
            plt.pause(0.001)
        else:
            plt.close(fig)
            self.fig = None

    def poll(self):
        """Keep the figure responsive while waiting for a key; return a key pressed in it, if any."""
        if self.fig is not None and self.plt.fignum_exists(self.fig.number):
            self.plt.pause(0.05)
        else:
            time.sleep(0.05)
        return self.keys.popleft() if self.keys else None

    def _on_key(self, event):
        if event.key in FIG_KEYS:
            self.keys.append(FIG_KEYS[event.key])

    def _geometry(self):
        """The current window's placement (Tk or Qt), so the next window opens in the same spot."""
        try:
            win = self.fig.canvas.manager.window
            return win.saveGeometry() if hasattr(win, "saveGeometry") else win.geometry()
        except Exception:
            return None

    def _restore(self, geometry):
        if geometry is None:
            return
        try:
            win = self.fig.canvas.manager.window
            if hasattr(win, "restoreGeometry"):
                win.restoreGeometry(geometry)
            else:
                win.geometry(geometry)
        except Exception:
            pass


def draw_diagram(ax, scans, i, aps, rows, est, args, path):
    scan = scans[i]
    heard = {"2.4": {}, "5": {}}  # band -> {key: strongest rssi}, positioned APs only
    for r in rows:
        if r["info"] and r["info"].get("pos"):
            heard["5" if is_5ghz(r["ch"]) else "2.4"].setdefault(r["key"], r["rssi"])
    heard_keys = set(heard["2.4"]) | set(heard["5"])

    def xy(keys):
        pts = [aps[k]["pos"] for k in keys]
        return [p[0] for p in pts], [p[1] for p in pts]

    unheard = [k for k, info in aps.items() if info.get("pos") and k not in heard_keys]
    if unheard:
        ax.scatter(*xy(unheard), s=40, facecolors="none", edgecolors="0.65", label="AP not heard", zorder=2)
    if est is not None and len(est["particles"]):
        ax.scatter(est["particles"][:, 0], est["particles"][:, 1], s=5, c="limegreen", alpha=0.5,
                   linewidths=0, label=f"particles ({len(est['particles'])})", zorder=1)
    if heard["2.4"]:
        ax.scatter(*xy(heard["2.4"]), s=120, c="red", label="2.4 GHz AP", zorder=3)
    if heard["5"]:
        ax.scatter(*xy(heard["5"]), s=40, c="blue", label="5 GHz AP", zorder=4)
    if est is not None:
        for n, (key, rssi) in enumerate(est["ranked"], 1):
            x, y = aps[key]["pos"]
            ax.annotate(f"{n}: {rssi}", (x, y), xytext=(6, -10), textcoords="offset points",
                        fontsize=8, fontweight="bold", zorder=6)
        if est["centroid"] is not None:
            ax.scatter(*est["centroid"], marker="P", s=110, c="darkgreen", edgecolors="white",
                       label="particle centroid", zorder=5)
    if scan["x_ft"] is not None and scan["y_ft"] is not None:
        ax.scatter(scan["x_ft"], scan["y_ft"], marker="x", s=130, c="black", linewidths=2.5,
                   label="true location", zorder=7)

    if est is not None:
        lo, hi = est["bounds"]
        ax.set_xlim(lo[0], hi[0])
        ax.set_ylim(hi[1], lo[1])  # y grows downward
    else:
        ax.invert_yaxis()
    ax.set_aspect("equal")
    ax.set_xlabel("x (ft)")
    ax.set_ylabel("y (ft)")
    ax.grid(alpha=0.3)

    band_note = "2.4 + 5 GHz" if args.use_24ghz else "5 GHz only"
    title = f"{os.path.basename(path)}   scan {i + 1} / {len(scans)}"
    if scan["label"]:
        title += f"   ({scan['label']})"
    sub = f"particles: top {args.num_participants} APs, {band_note}"
    if est is not None and est["ranked"]:
        sub += f", order matched {est['matched']} / {len(est['ranked'])}"
    ax.set_title(f"{title}\n{sub}", fontsize=10)
    ax.legend(loc="best", fontsize=8, framealpha=0.85)


# ---------------------------------------------------------------- keyboard

def read_key(poll=None):
    """Return one of: left right up down home end goto quit, or None for an unbound key.

    While no key is waiting in the terminal, poll() is called repeatedly; a non-None result is
    returned as the key (used for keys pressed in the diagram window).
    """
    poll = poll or (lambda: time.sleep(0.05))
    if os.name == "nt":
        import msvcrt
        while not msvcrt.kbhit():
            key = poll()
            if key:
                return key
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
            while not select_ready(fd):
                key = poll()
                if key:
                    return key
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
    diagram = None if args.no_plot else Diagram(display=True, save_dir=args.plot_dir)
    i = max(0, min(args.start - 1, len(scans) - 1))
    while True:
        sys.stdout.write("\x1b[2J\x1b[H")
        text, rows, est = render(scans, i, aps, args, path)
        print(text)
        print("  <-/-> step   up/down +-10   Home/End   g goto   q quit")
        sys.stdout.flush()
        if diagram:
            diagram.show(scans, i, aps, rows, est, args, path)
        key = read_key(diagram.poll if diagram else None)
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
    p.add_argument("--num-participants", type=int, default=3,
                   help="how many of the strongest positioned APs shape the particle swarm (default: 3)")
    p.add_argument("--use-24ghz", action=argparse.BooleanOptionalAction, default=True,
                   help="let 2.4 GHz readings rank APs for the particle swarm; "
                        "--no-use-24ghz ranks on 5 GHz only (default: on)")
    p.add_argument("--particle-samples", type=int, default=20000,
                   help="candidate points scattered per scan before filtering (default: 20000)")
    p.add_argument("--no-plot", action="store_true", help="don't show the diagram")
    p.add_argument("--plot-dir", default=None,
                   help="also save each scan's diagram as a PNG in this folder "
                        "(with --dump, diagrams are only made when this is given)")
    p.add_argument("--dump", action="store_true",
                   help="print every scan one after another instead of the interactive viewer")
    args = p.parse_args()
    if args.num_participants < 1:
        p.error("--num-participants must be at least 1")
    if args.particle_samples < 1:
        p.error("--particle-samples must be at least 1")

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
        diagram = Diagram(display=False, save_dir=args.plot_dir) if args.plot_dir and not args.no_plot else None
        for i in range(len(scans)):
            text, rows, est = render(scans, i, aps, args, path)
            print(text)
            print()
            if diagram:
                diagram.show(scans, i, aps, rows, est, args, path)
    else:
        try:
            interactive(scans, aps, args, path)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
