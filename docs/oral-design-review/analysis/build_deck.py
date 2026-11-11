"""Build BevoTag-Design-Review.pptx from the outline, chart_data.json, and the assets folder.

Usage (from docs/oral-design-review):  py -3 analysis/build_deck.py
Rebuild after editing this file or chart_data.json. Text, notes, tables, and native charts are all
generated here; edit the deck in PowerPoint afterwards only for changes you don't need to regenerate.
"""
import json
import os

from lxml import etree
from PIL import Image
from pptx import Presentation
from pptx.chart.data import CategoryChartData, XyChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_AXIS_CROSSES, XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION
from pptx.enum.dml import MSO_LINE_DASH_STYLE
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_AUTO_SIZE, PP_ALIGN
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.util import Inches, Pt

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(HERE)
ASSETS = os.path.join(BASE, "assets")
OUT = os.path.join(BASE, "BevoTag-Design-Review.pptx")
DATA = json.load(open(os.path.join(HERE, "chart_data.json"), encoding="utf-8"))

GRAY = RGBColor(0x59, 0x59, 0x59)
BLUE = RGBColor(0x44, 0x72, 0xC4)    # Office default accent 1
ORANGE = RGBColor(0xED, 0x7D, 0x31)  # Office default accent 2
LIGHT = RGBColor(0xA5, 0xA5, 0xA5)   # Office default accent 3

prs = Presentation(os.path.join(ASSETS, "template", "blank-office-16x9.pptx"))

# Calibri Light / Calibri instead of Aptos, so the deck renders the same on older Office installs.
theme = prs.slide_master.part.part_related_by(RT.THEME)
ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
root = etree.fromstring(theme.blob)
root.find(".//a:majorFont/a:latin", ns).set("typeface", "Calibri Light")
root.find(".//a:minorFont/a:latin", ns).set("typeface", "Calibri")
theme._blob = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)

LAYOUT = {layout.name: layout for layout in prs.slide_layouts}
asset = lambda *p: os.path.join(ASSETS, *p)


# ---------------------------------------------------------------- helpers
def slide(title, layout="Title Only", notes=""):
    s = prs.slides.add_slide(LAYOUT[layout])
    t = s.shapes.title
    t.left, t.top, t.width, t.height = Inches(0.6), Inches(0.3), Inches(12.13), Inches(1.0)
    t.text = title
    t.text_frame.paragraphs[0].runs[0].font.size = Pt(36)
    if notes:
        s.notes_slide.notes_text_frame.text = notes
    return s


def remove(shape):
    shape._element.getparent().remove(shape._element)


def body(s, l, t, w, h, items, size=20):
    """Bulleted text in the layout's own content placeholder (default bullets and spacing).

    items: a string, a list of runs [("b", "Bold "), "plain"], or ("sub", item) for a second-level bullet.
    """
    ph = [p for p in s.placeholders if p.placeholder_format.idx == 1][0]
    ph.left, ph.top, ph.width, ph.height = Inches(l), Inches(t), Inches(w), Inches(h)
    tf = ph.text_frame
    tf.auto_size = MSO_AUTO_SIZE.NONE
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        level = 0
        if isinstance(item, tuple) and item[0] == "sub":
            level, item = 1, item[1]
        p.level = level
        for part in item if isinstance(item, list) else [item]:
            r = p.add_run()
            bold = isinstance(part, tuple)
            r.text = part[1] if bold else part
            r.font.size = Pt(size - 2 * level)
            if bold:
                r.font.bold = True
    for p in list(s.placeholders):
        if p.placeholder_format.idx not in (0, 1):
            remove(p)
    return ph


def text(s, l, t, w, h, lines, size=16, color=None, align=None, bold=False):
    tb = s.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    for i, line in enumerate(lines if isinstance(lines, list) else [lines]):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        if align:
            p.alignment = align
        r = p.add_run()
        r.text = line
        r.font.size = Pt(size)
        r.font.bold = bold
        if color:
            r.font.color.rgb = color
    return tb


def source(s, line):
    text(s, 0.6, 6.95, 12.13, 0.4, line, size=11, color=GRAY)


def picture(s, path, l, t, w, h):
    """Fit an image inside the box (inches), keeping its aspect ratio, centered."""
    iw, ih = Image.open(path).size
    scale = min(w / iw, h / ih)
    pw, ph = iw * scale, ih * scale
    return s.shapes.add_picture(path, Inches(l + (w - pw) / 2), Inches(t + (h - ph) / 2), Inches(pw), Inches(ph))


def photo_box(s, l, t, w, h, label):
    box = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(l), Inches(t), Inches(w), Inches(h))
    box.name = "PHOTO PLACEHOLDER"
    box.fill.background()
    box.line.color.rgb = GRAY
    box.line.width = Pt(1.25)
    box.line.dash_style = MSO_LINE_DASH_STYLE.DASH
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = f"[ATTACH PHOTO: {label}]"
    r.font.size = Pt(14)
    r.font.color.rgb = GRAY


def table(s, rows, l, t, widths, size=16, row_h=0.42):
    shape = s.shapes.add_table(len(rows), len(rows[0]), Inches(l), Inches(t), Inches(sum(widths)), Inches(row_h * len(rows)))
    tbl = shape.table
    for j, w in enumerate(widths):
        tbl.columns[j].width = Inches(w)
    for i, row in enumerate(rows):
        tbl.rows[i].height = Inches(min(row_h, 0.5) if i == 0 else row_h)
        for j, value in enumerate(row):
            cell = tbl.cell(i, j)
            cell.margin_top = cell.margin_bottom = Inches(0.04)
            p = cell.text_frame.paragraphs[0]
            r = p.add_run()
            r.text = value
            r.font.size = Pt(size)
            if i == 0:
                r.font.bold = True
    return tbl


def axis_title(axis, label, size=13):
    axis.has_title = True
    axis.axis_title.text_frame.text = label
    axis.axis_title.text_frame.paragraphs[0].runs[0].font.size = Pt(size)
    axis.axis_title.text_frame.paragraphs[0].runs[0].font.bold = False


def chart_title(chart, label, size=16):
    chart.has_title = True
    chart.chart_title.text_frame.text = label
    run = chart.chart_title.text_frame.paragraphs[0].runs[0]
    run.font.size = Pt(size)
    run.font.bold = True


def category_chart(s, kind, categories, series, l, t, w, h, title=None, y_label=None, number_format="0",
                   labels=True, legend=True, colors=(BLUE, ORANGE, LIGHT)):
    cd = CategoryChartData()
    cd.categories = categories
    for name, values in series:
        cd.add_series(name, values)
    chart = s.shapes.add_chart(kind, Inches(l), Inches(t), Inches(w), Inches(h), cd).chart
    chart.font.size = Pt(13)
    if title:
        chart_title(chart, title)
    else:
        chart.has_title = False
    chart.has_legend = legend and len(series) > 1
    if chart.has_legend:
        chart.legend.position = XL_LEGEND_POSITION.BOTTOM
        chart.legend.include_in_layout = False
    for ser, color in zip(chart.plots[0].series, colors):
        ser.format.fill.solid()
        ser.format.fill.fore_color.rgb = color
    if labels:
        plot = chart.plots[0]
        plot.has_data_labels = True
        plot.data_labels.number_format = number_format
        plot.data_labels.number_format_is_linked = False
        plot.data_labels.font.size = Pt(12)
    if y_label:
        axis_title(chart.value_axis, y_label)
    chart.value_axis.has_major_gridlines = True
    chart.value_axis.major_gridlines.format.line.color.rgb = RGBColor(0xD9, 0xD9, 0xD9)
    return chart


# ---------------------------------------------------------------- data shortcuts
ant = DATA["antenna"]
csi = DATA["csi"]
aps = DATA["aps_per_scan"]
stab = DATA["stability"]
amp = DATA["csi_amplitude"]
floors = DATA["floors"]
csi_ap_indoor = [v["campus_ap"] for k, v in csi.items() if not k.startswith("Plaza")]
csi_ap_plaza = [v["campus_ap"] for k, v in csi.items() if k.startswith("Plaza")]
csi_rand = [v["randomized"] for v in csi.values()]
stds = [x["std"] for x in stab["series"]]
other_floor = sum(1 for f in floors if f["floor"] != "2")
r1 = lambda v: f"{v:.0f}" if abs(v - round(v)) < 0.05 else f"{v:.1f}"

# ================================================================= 1. Title
s = prs.slides.add_slide(LAYOUT["Title Slide"])
s.shapes.title.text = "BevoTag: Finding Lost Items Anywhere on the UT Campus"
sub = s.placeholders[1]
sub.text_frame.text = "Oral Design Review  ·  Team SP11"
for line in ["Ethan Chua, Abhirit Das, Esteban Martinez, Li Shi, Andrew Yin",
             "Faculty Mentor: Dr. Haris Vikalo",
             "Technical TA: Michael Zhao  ·  Writing TA: Mugdha Jadhao",
             "November 10, 2026"]:
    p = sub.text_frame.add_paragraph()
    p.text = line
for p in sub.text_frame.paragraphs:
    for r in p.runs:
        r.font.size = Pt(20)
s.notes_slide.notes_text_frame.text = (
    "Introduce the team and the project in one sentence: BevoTag is a small tag that finds a laptop, bag, "
    "or piece of lab equipment anywhere on campus, including inside buildings where today's trackers fail. "
    "Say that the talk covers the design choices we have made so far and the results of our five risk "
    "reduction deliverables, and that we want feedback on the open questions at the end.")

# ================================================================= 2. Opener
s = slide("Where Is the Laptop You Left in EER Last Night?", "Title and Content", notes=(
    "Open with the scenario, not the technology. Someone leaves a laptop in an EER lab and realizes it at "
    "home. An AirTag updates only when a passing iPhone hears it, and at night an empty lab has none. GPS "
    "is the other common answer, but satellite signals barely reach indoors, and even between tall buildings "
    "one test of a precise receiver without inertial aiding measured errors over 9 m. The point to land: "
    "campus already has the infrastructure we need. UT IT's list shows 300 access points in EER alone, and "
    "BevoTag uses those signals instead of new hardware or other people's phones."))
body(s, 0.6, 1.45, 12.13, 5.3, [
    "An AirTag updates only when a passing iPhone hears it. An empty lab at night has no passing phones [1].",
    "GPS barely works indoors. Between tall buildings, one test measured position errors over 9 m [2].",
    "Campus already has the infrastructure: UT IT lists 300 Wi-Fi access points in EER alone [12].",
    [("b", "BevoTag"), " uses those campus Wi-Fi signals and its own motion sensor to find the item, "
     "indoors and on any floor."],
], size=24)
source(s, "Sources: [1] Apple, AirTag; [2] Yoder and Humphreys, NAVIGATION, 2023; [12] UT IT access point list, 2026.")

# ================================================================= 3. Problem statement
s = slide("Problem Statement", "Title and Content", notes=(
    "Read the one-sentence problem statement, then the four targets in the table. These four numbers are how "
    "we will judge every design choice in the rest of the talk. Room identification is the hardest one: "
    "published Wi-Fi fingerprinting already reaches 1 to 5 m, so the 5 m median error is a ceiling, but "
    "picking the right room as conditions change is where existing systems fall short."))
body(s, 0.6, 1.45, 12.13, 1.6, [
    "BevoTag is a low-cost tag that locates misplaced items anywhere on the UT campus, including inside "
    "buildings and on any floor, without new infrastructure or passing phones.",
], size=22)
for p in s.placeholders[1].text_frame.paragraphs:
    p.runs[0].font.size = Pt(22)
table(s, [
    ["Target", "Value"],
    ["Identifies the room that contains the item", "More than 90% of trials"],
    ["Median position error", "Under 5 m"],
    ["Location update while the item moves", "At least every 10 s"],
    ["Battery life on one charge", "At least 24 h"],
], 1.9, 3.25, [6.0, 3.6], size=20, row_h=0.6)
source(s, "Source: BevoTag Project Definition, Oct. 2026.")

# ================================================================= 4. Agenda
s = slide("What We Will Cover", "Title and Content", notes=(
    "Give the roadmap in one breath. We start with the problem and the targets, then the requirements and "
    "standards, then the alternatives we considered and how we chose. After the block diagram and our "
    "progress against plan, we present the five risk reduction deliverables: the omnidirectional antenna, "
    "the ESP32 firmware, the survey collector, the 3D building model, and the EER data collection. We close "
    "with the residual risks, each member's contributions, and our assessment."))
body(s, 0.6, 1.45, 12.13, 5.3, [
    "Design objectives: requirements, standards, and what we design vs. buy",
    "Alternatives we considered and the criteria we used to choose",
    "System block diagram and progress against our original plan",
    "Five risk reduction deliverables:",
    ("sub", "Omnidirectional antenna  ·  ESP32 firmware  ·  Survey collector  ·  3D building model  ·  EER data collection"),
    "Residual risks for EE 464 and our plan to address them",
    "Team contributions and our assessment of the project",
], size=24)

# ================================================================= 5. Requirements
s = slide("Requirements and Key Specifications", notes=(
    "Explain how the product meets the need: it works indoors on every floor, it needs no beacons installed "
    "in rooms, and it does not depend on a passerby's phone. Then walk the table briefly. The first four rows "
    "are accuracy and timeliness; the last four are battery, size, mass, and cost, which constrain the tag "
    "hardware. All values come from the Project Definition; we will confirm them with Dr. Vikalo before "
    "detailed design."))
text(s, 0.6, 1.4, 12.13, 0.9, [
    "Need: find an item indoors, on any floor, with no new infrastructure and no passing phones.",
], size=20)
table(s, [
    ["Parameter", "Target", "Parameter", "Target"],
    ["Room identification", "> 90% of trials", "Time to first fix", "< 30 s"],
    ["Floor identification", "> 95% of indoor trials", "Battery life", "≥ 24 h per charge"],
    ["Median position error", "< 5 m", "Tag size", "≤ 80 × 50 × 25 mm"],
    ["Update interval while moving", "≤ 10 s", "Tag mass", "≤ 100 g"],
    ["End-to-end latency", "< 5 s", "Parts cost", "≤ $50 per tag"],
], 0.6, 2.2, [3.4, 2.8, 2.8, 3.1], size=18, row_h=0.62)
text(s, 0.6, 6.15, 12.13, 0.6, "Operating conditions: surveyed EER floors and plazas first; at least three access points above −80 dBm; 0 to 40 °C; walking speed up to 5 m/s.", size=16)
source(s, "Source: BevoTag Project Definition, Oct. 2026 (Performance and Operating Environment Specifications).")

# ================================================================= 6. Standards
s = slide("Standards and Constraints", notes=(
    "Each standard changes a concrete design decision. 802.11 defines the training fields that CSI is "
    "measured from, so the tag needs a Wi-Fi chip that exposes CSI. FCC Part 15 pushes us to a radio module "
    "that is already certified. IEC 62133-2 covers lithium battery safety, so we choose a certified cell and "
    "add a protection circuit. UT's acceptable use policy forbids probing or disrupting the network, so the "
    "tag only listens or joins utexas-iot as an ordinary client, and it never stores another person's device "
    "address."))
table(s, [
    ["Standard or policy", "Effect on BevoTag"],
    ["IEEE 802.11 [11]", "Defines the training fields that CSI is measured from; the tag needs a CSI-capable Wi-Fi chip"],
    ["FCC 47 C.F.R. Part 15 [13]", "Use a pre-certified radio module and label the product \"Contains FCC ID\""],
    ["IEC 62133-2 [14]", "Certified lithium cell plus a protection circuit for overcharge, short circuit, and heat"],
    ["UT Acceptable Use Policy [15]", "Tag acts only as an ordinary client on utexas-iot; never probes or congests the network"],
    ["Privacy commitment (Project Definition)", "Keep only access point measurements; discard frames from people's devices"],
], 0.6, 1.5, [3.9, 8.23], size=18, row_h=0.8)
source(s, "Sources: [11] IEEE Std 802.11-2020; [13] 47 C.F.R. Part 15; [14] IEC 62133-2:2017+A1:2021; [15] UT Austin, Acceptable Use Policy, 2019.")

# ================================================================= 7. New vs off-the-shelf
s = slide("What We Design vs. What We Buy", notes=(
    "Left column is our design content: the firmware, both parts of the web app, the position estimation and "
    "fusion, and next semester the server, user app, and tag circuit board. Right column is off-the-shelf: "
    "the ESP32 board, the IMU and GPS modules we bought for the logger, the Linx omnidirectional antenna, a "
    "certified battery, and the campus access points themselves, which we use but do not control."))
table(s, [
    ["We design", "We buy or reuse"],
    ["ESP32 firmware: RSSI and CSI capture", "ESP32 development board"],
    ["Survey collector web app", "IMU and GPS modules"],
    ["3D building model and signal map", "Linx 2.4 GHz omnidirectional antenna"],
    ["Position estimation and sensor fusion", "Certified rechargeable battery"],
    ["Location server and user app (EE 464)", "Three.js 3D library, UT floor-plan PDFs"],
    ["Tag circuit board and enclosure (EE 464)", "300 EER and 103 ECJ campus access points"],
], 0.6, 1.5, [6.06, 6.07], size=20, row_h=0.68)

# ================================================================= 8. Concept alternatives
s = slide("Alternatives Considered: The Product Concept", notes=(
    "We did not start with BevoTag. In our September 20 brainstorm we compared a GPS watch or bike computer "
    "with a campus item tag, and our September 1 proposal described a general urban positioning system. "
    "Walk the criteria row by row. The watch needs little survey work but mainly competes on user experience "
    "with mature products. The urban system matched our skills but was too broad to test in two semesters. "
    "The campus tag needs the most survey effort, but it answers a clear need that current trackers miss and "
    "we can test it in buildings we use every day."))
table(s, [
    ["Criterion", "GPS watch / bike computer", "Urban positioning system", "Campus item tag (BevoTag)"],
    ["Source", "9/20 brainstorm", "9/1 project proposal", "9/20 brainstorm; 10/15 Project Definition"],
    ["Survey effort", "Low: street level", "High: whole urban area", "High: room level, a few buildings"],
    ["Optimized for", "User experience", "Sub-meter accuracy", "Small size, low power, low cost"],
    ["Unmet user need", "Weak: mature products exist", "Broad, hard to define a user", "Strong: trackers fail indoors"],
    ["Testable in 2 semesters", "Yes", "No: scope too large", "Yes: EER, ECJ, ASE"],
    ["Decision", "Rejected", "Narrowed into BevoTag", "Chosen"],
], 0.6, 1.5, [2.6, 3.0, 3.1, 3.43], size=17, row_h=0.66)
source(s, "Sources: team brainstorming notes (9/20/2026); ECE 364D Student-Proposed Project Form (9/1/2026).")

# ================================================================= 9. Technical alternatives
s = slide("Alternatives Considered: Technical Choices", notes=(
    "Each row is a design decision, the options we compared, the criteria, and where we stand. For the signal, "
    "GNSS fails indoors, BLE crowdsourcing needs passing phones, and beacons or UWB need new hardware in every "
    "room, so Wi-Fi wins on infrastructure. RSSI is the baseline; CSI stays only if it improves room "
    "identification, since DeepFi reported 30 to 39 percent lower error on more capable hardware. For fusion, "
    "the EKF is light enough for the tag but cannot use walls; a particle filter can, but would likely run on "
    "the server. We will compare both on logged EER walks."))
table(s, [
    ["Decision", "Options compared", "Criteria", "Current choice"],
    ["Position signal", "GNSS, BLE crowdsourcing, BLE beacons, UWB, Wi-Fi RSSI, Wi-Fi CSI",
     "Works indoors; no new infrastructure; cost", "Wi-Fi RSSI baseline; CSI under test [4], [5]"],
    ["Fusion filter", "Extended Kalman filter vs. particle filter", "Uses floor plans; compute cost",
     "Compare both on logged EER walks [7], [8]"],
    ["Where the position is computed", "On the tag vs. on the server", "Battery life; tag memory",
     "Decide after measuring power"],
    ["Fingerprint matching", "k-nearest neighbors vs. neural network", "Accuracy; amount of survey data needed",
     "k-NN baseline built; neural network later"],
    ["Antenna", "ESP32 onboard antenna vs. external omnidirectional", "RSSI change with heading",
     "Omnidirectional (risk reduction 1)"],
], 0.6, 1.5, [2.5, 3.9, 2.9, 2.83], size=16, row_h=0.85)
source(s, "Sources: [4] Bahl and Padmanabhan, INFOCOM, 2000; [5] Wang et al., IEEE Trans. Veh. Technol., 2017; [7] Evennou and Marx, 2006; [8] Welch and Bishop, 2004.")

# ================================================================= 10. Block diagram
s = slide("System Block Diagram", notes=(
    "Walk left to right. Inputs enter the BevoTag device: Wi-Fi RSSI and CSI from campus access points, "
    "motion from the IMU, optional GNSS outdoors, and USB-C charging. The tag sends telemetry over campus "
    "Wi-Fi to the location server, which holds the building survey and map and estimates the position. The "
    "user application shows the position, status, and last update time, and connects over USB-C for setup "
    "and debugging. Point out that this semester we built the measurement side and the survey and map data; "
    "the server and user app are EE 464 work."))
picture(s, asset("diagrams", "io-diagram.png"), 0.8, 1.4, 11.73, 5.4)
source(s, "Source: BevoTag Project Definition, Oct. 2026, Fig. 2. Dashed items are optional.")

# ================================================================= 11. Plan vs now
s = slide("Original Plan vs. Where We Are Now", notes=(
    "The plan in the Project Definition was to build a data logger first, then survey EER and test the "
    "matching method. The logger, firmware, collector, and 3D model are done, and the omnidirectional antenna "
    "arrived and was tested on November 8. Behind plan: the survey covers two spots on EER level 2 and two "
    "outdoor points, short of the multi-floor survey with 5,000 samples per location in our week 6 report. We "
    "have no IMU or GPS data yet, so fusion has not started, and system design of the tag starts now."))
table(s, [
    ["Item", "Planned", "Status"],
    ["Logger hardware: ESP32, IMU, GPS", "Week 3", "Done: acquired week 3"],
    ["Logger web app (survey collector)", "Week 3", "Done: week 3, refined through week 7"],
    ["CSI capture in the ESP32 firmware", "Week 4", "Done: first CSI capture 10/11"],
    ["Access point list and floor plans from UT IT", "Week 3", "Received week 4"],
    ["Omnidirectional antenna", "Week 4 (ordered)", "Done: first capture 11/8"],
    ["3D building model in the web app", "Week 5", "Done: EER, ECJ, ASE by 10/21"],
    ["Multi-floor EER survey, 5,000 samples per location", "Weeks 6 to 7", "Behind: 2 indoor spots, 2 plaza points"],
    ["Fingerprint matching model", "Week 7", "Partial: k-NN baseline only"],
    ["IMU and GPS fusion", "EE 364D", "Not started: no IMU or GPS data yet"],
], 0.6, 1.45, [5.5, 2.4, 4.23], size=16, row_h=0.5)
source(s, "Sources: BevoTag Project Definition; team status reports, weeks 1 to 7 (Sept. 25 to Nov. 6, 2026).")

# ================================================================= 12. Capture setup
s = slide("Capture Setup", "Two Content", notes=(
    "Describe the photo. The ESP32 sits on a tripod at a fixed height and heading, which is what Dr. Vikalo "
    "asked for so that the fingerprints are not corrupted by orientation. A USB cable runs to the laptop "
    "running our survey collector. The operator clicks the spot on the floor plan and starts the log. The "
    "firmware then runs a 3-minute RSSI phase, about 85 scans, followed by a 5-minute CSI phase. We captured "
    "the 2.813 south corridor and the 2.701 staircase corner, each facing north and east, plus two points on "
    "the plaza by PMA. Every capture needs two people: one with the device, one running the logger."))
picture(s, asset("photos", "capture-setup-tripod.png"), 0.6, 1.45, 6.0, 5.35)
ph = body(s, 6.9, 1.45, 5.83, 5.35, [
    "ESP32 on a tripod at fixed height and heading, USB to a laptop running our collector (115200 baud)",
    "Operator marks the spot on the floor plan and starts the CSV log",
    "Firmware runs a 3-minute RSSI phase (about 85 scans), then a 5-minute CSI phase",
    "Spots: EER 2.813 south corridor and 2.701 staircase corner, each facing north and east",
    "Outdoor: two points on the plaza by PMA (10/11)",
    "Each session needs two people",
], size=18)

# ================================================================= 13. RR1 antenna
s = slide("Risk Reduction 1: Omnidirectional Antenna", "Two Content", notes=(
    f"Goal: our first capture on October 11 showed that turning the board changed the readings, which would "
    f"corrupt fingerprints. We bought a Linx 2.4 GHz flexible antenna and mounted it vertically, shown in the "
    f"photo, and repeated the 2.813 corridor capture facing north and then east. The chart compares one scan "
    f"in each direction for both antennas. The typical per-AP change dropped from {r1(ant['onboard_1011']['median'])} "
    f"to {r1(ant['omni_1108']['median'])} dB, and the largest change from {r1(ant['onboard_1011']['max'])} to "
    f"{r1(ant['omni_1108']['max'])} dB. Fewer access points appear in only one direction, "
    f"{ant['onboard_1011']['one_direction_only']} vs. {r1(ant['omni_1108']['one_direction_only'])}. Decision: "
    f"every survey uses the omnidirectional antenna on the tripod. The 10/11 setup was the same board without "
    f"the external antenna, using the antenna trace printed on the ESP32 module."))
body(s, 0.6, 1.45, 4.6, 5.35, [
    [("b", "Goal: "), "readings changed when the board turned (10/11 notes)"],
    [("b", "What we did: "), "bought a Linx 2.4 GHz omnidirectional antenna; repeated the 2.813 capture facing north and east"],
    [("b", "Result: "), f"typical change {r1(ant['onboard_1011']['median'])} → {r1(ant['omni_1108']['median'])} dB; "
     f"largest {r1(ant['onboard_1011']['max'])} → {r1(ant['omni_1108']['max'])} dB"],
    [("b", "Decision: "), "survey only with the omnidirectional antenna on the tripod"],
], size=18)
category_chart(s, XL_CHART_TYPE.COLUMN_CLUSTERED, ["Typical AP", "Largest change"], [
    ("Onboard antenna (10/11)", [ant["onboard_1011"]["median"], ant["onboard_1011"]["max"]]),
    ("Omnidirectional antenna (11/8)", [ant["omni_1108"]["median"], ant["omni_1108"]["max"]]),
], 5.3, 1.45, 4.0, 5.0, title="RSSI change, facing north vs. east", y_label="Change in RSSI (dB)")
picture(s, asset("photos", "esp32-omni-antenna.png"), 9.45, 1.45, 3.3, 5.35)
source(s, "Data: 2.813 south corridor, one scan per heading per antenna (11/8: median over 81 scan pairs). Photo: ESP32 with Linx antenna.")

# ================================================================= 14. RR2 firmware
s = slide("Risk Reduction 2: ESP32 Firmware", "Two Content", notes=(
    f"Goal: show that the ESP32 can record CSI from campus access points, not only RSSI, since the "
    f"literature left that in doubt for a single-antenna chip. The firmware runs an RSSI scan phase and a CSI "
    f"phase and sends every result to the laptop as one JSON line. Top chart: CSI frames per second for each "
    f"capture, split by sender. Campus access points gave {min(csi_ap_indoor):.0f} to {max(csi_ap_indoor):.0f} "
    f"frames per second indoors and {min(csi_ap_plaza):.0f} to {max(csi_ap_plaza):.0f} on the plaza. Gray is "
    f"phones and laptops with randomized addresses, {min(csi_rand):.1f} to {max(csi_rand):.1f} per second, "
    f"which our privacy commitment says the firmware must discard. Bottom chart: the same access point, in "
    f"room {amp['ap_room']}, has a different CSI amplitude pattern at the two spots, which is what makes CSI "
    f"useful as a fingerprint."))
body(s, 0.6, 1.45, 4.4, 5.35, [
    [("b", "Goal: "), "confirm the ESP32 records CSI from campus access points, not only RSSI"],
    [("b", "What we did: "), "Arduino firmware with an RSSI phase and a CSI phase; each result sent as a JSON line over USB"],
    [("b", "Result: "), f"{min(csi_ap_indoor):.0f}–{max(csi_ap_indoor):.0f} CSI frames/s from campus APs indoors; "
     f"{len(amp['subcarriers'])} usable subcarriers per frame; pattern differs between spots"],
    [("b", "Decision: "), "keep CSI under test; discard frames from people's devices before storing"],
], size=18)
labels = list(csi.keys())
category_chart(s, XL_CHART_TYPE.COLUMN_STACKED, labels, [
    ("Campus access points", [csi[k]["campus_ap"] for k in labels]),
    ("Phones/laptops (randomized MAC)", [csi[k]["randomized"] for k in labels]),
    ("Other devices", [csi[k]["other"] for k in labels]),
], 5.15, 1.4, 7.6, 2.75, title="CSI frames per second, by sender", number_format="0", labels=False,
    colors=(BLUE, LIGHT, ORANGE))
cd = CategoryChartData()
cd.categories = [str(i) for i in amp["subcarriers"]]
cd.add_series("2.813 corridor", amp["corridor"])
cd.add_series("2.701 staircase", amp["staircase"])
chart = s.shapes.add_chart(XL_CHART_TYPE.LINE, Inches(5.15), Inches(4.2), Inches(7.6), Inches(2.65), cd).chart
chart.font.size = Pt(12)
chart_title(chart, f"CSI amplitude, AP in room {amp['ap_room']}, facing north (11/8)", size=14)
chart.has_legend = True
chart.legend.position = XL_LEGEND_POSITION.RIGHT
chart.legend.include_in_layout = False
for ser, color in zip(chart.plots[0].series, (BLUE, ORANGE)):
    ser.format.line.color.rgb = color
    ser.format.line.width = Pt(2.25)
    ser.smooth = False
axis_title(chart.category_axis, "Subcarrier index", size=12)
axis_title(chart.value_axis, "Amplitude", size=12)
chart.category_axis.tick_labels.font.size = Pt(10)
chart.value_axis.major_gridlines.format.line.color.rgb = RGBColor(0xD9, 0xD9, 0xD9)
cat_ax = chart.category_axis._element
for tag, val in (("tickLblSkip", "8"), ("tickMarkSkip", "8")):
    el = etree.SubElement(cat_ax, f"{{http://schemas.openxmlformats.org/drawingml/2006/chart}}{tag}")
    el.set("val", val)
source(s, f"Data: 10/11 and 11/8 captures. Campus AP = vendor prefix in UT IT's AP list [12]. "
          f"Amplitude averaged over {amp['frames']['corridor']} and {amp['frames']['staircase']} frames; unused subcarriers omitted.")

# ================================================================= 15. RR3 collector
s = slide("Risk Reduction 3: Web App Survey Collector", "Two Content", notes=(
    "Goal: every measurement has to carry its true location, or it is useless for fingerprinting. The "
    "collector runs in Chrome and talks to the ESP32 over Web Serial. The operator picks the building and "
    "floor, clicks the spot on the registered floor plan, types the room, and starts the CSV log. Every line "
    "the device sends is saved raw with the location, time, and operator, so new firmware data, such as IMU "
    "readings next semester, needs no app changes. Result: all ten capture files in our dataset, about 55,000 "
    "CSI frames and 350 RSSI scans, were recorded with this tool. The screenshot is from the October 11 "
    "capture on EER level 2."))
body(s, 0.6, 1.45, 4.6, 5.35, [
    [("b", "Goal: "), "tie every measurement to a building, floor, room, and x/y position"],
    [("b", "What we did: "), "browser app over Web Serial: click your spot on the floor plan, then log every device line raw to CSV"],
    [("b", "Result: "), "all 10 capture files (about 55,000 CSI frames, 350 RSSI scans) recorded with it; floor plans registered in feet"],
    [("b", "Decision: "), "keep raw logging so the firmware can add IMU data without app changes"],
], size=18)
picture(s, asset("screenshots", "collector-2d-capture.png"), 5.4, 1.45, 7.33, 5.35)
source(s, "Screenshot: BevoTag survey collector during the 10/11 EER level 2 capture.")

# ================================================================= 16. RR4 3D model
s = slide("Risk Reduction 4: Web App 3D Model and Signal Map", "Two Content", notes=(
    "Goal: the user app needs a 3D campus map, and we need to see survey coverage floor by floor. We "
    "reconstructed walls and rooms from UT's floor-plan PDFs and built a Three.js workspace on top of the "
    "collector. It covers EER with 9 levels, ECJ with 15, and ASE with 7, about 3,400 wall and room polygons, "
    "and it imports our CSV captures and shows signal heatmaps on the floor where they were taken. It also "
    "has a k-nearest-neighbor fingerprint estimate and exports IFC and OBJ files. Be clear about the limits: "
    "floor heights in EER are schematic, and position accuracy has not been measured yet."))
body(s, 0.6, 1.45, 4.6, 5.35, [
    [("b", "Goal: "), "a 3D campus map for the user app and for checking survey coverage by floor"],
    [("b", "What we did: "), "rebuilt walls and rooms from UT floor-plan PDFs; Three.js workspace with CSV import and heatmaps"],
    [("b", "Result: "), "EER 9 levels, ECJ 15, ASE 7 (3,403 wall and room polygons); k-NN position estimate; IFC/OBJ export"],
    [("b", "Limits: "), "floor heights unverified; accuracy not yet measured"],
], size=18)
picture(s, asset("screenshots", "crop-3d-exploded.png"), 5.4, 1.45, 7.33, 5.35)
source(s, "Screenshot: BevoTag Signal Studio, EER exploded view with the 11/8 captures imported.")

# ================================================================= 17. RR5a data: stability
s = slide("Risk Reduction 5: Data Collection", "Two Content", notes=(
    f"Goal: learn how RSSI behaves at a fixed spot before we scale up the survey. The top chart is the 3-minute "
    f"RSSI phase at the 2.813 corridor spot with the omnidirectional antenna: {stab['scans']} scans, five "
    f"strongest radios. Each line is nearly flat; standard deviations are {min(stds):.1f} to {max(stds):.1f} dB. "
    f"That means averaging a few scans gives a stable fingerprint at one spot. The bottom chart shows how "
    f"many access points the ESP32 hears per scan: about 30 indoors and over 100 on the open plaza, so outdoor "
    f"spots have far more signals to match against. Dr. Vikalo's advice to collect data early is why we have "
    f"these results now."))
body(s, 0.6, 1.45, 4.4, 5.35, [
    [("b", "Goal: "), "learn how RSSI behaves at a fixed spot before scaling up the survey"],
    [("b", "What we did: "), "2 spots on EER level 2 × 2 headings (11/8); 2 plaza points (10/11)"],
    [("b", "Result: "), f"RSSI standard deviation {min(stds):.1f}–{max(stds):.1f} dB over 3 minutes; "
     f"about 30 APs heard indoors vs. over 100 on the plaza"],
    [("b", "Decision: "), "average several scans per spot; survey 4 headings at 3 times of day"],
], size=18)
cd = XyChartData()
names = {"Radio C8:EA:F8:79:F3:Cx": "Non-UT hotspot", "Radio E4:A4:1C:A4:43:4x": "UT AP, not in EER list"}
for ser in stab["series"]:
    x = cd.add_series(f"{names.get(ser['label'], ser['label'])} (σ {ser['std']:.1f} dB)")
    for t, v in ser["points"]:
        if v is not None:
            x.add_data_point(t, v)
chart = s.shapes.add_chart(XL_CHART_TYPE.XY_SCATTER_LINES_NO_MARKERS, Inches(5.15), Inches(1.4), Inches(7.6), Inches(3.15), cd).chart
chart.font.size = Pt(12)
chart_title(chart, "RSSI over the 3-minute RSSI phase, 2.813 corridor (11/8)", size=14)
chart.has_legend = True
chart.legend.position = XL_LEGEND_POSITION.RIGHT
chart.legend.include_in_layout = False
chart.value_axis.minimum_scale = -90
chart.value_axis.maximum_scale = -65
chart.value_axis.crosses = XL_AXIS_CROSSES.MINIMUM  # time axis along the bottom
chart.category_axis.minimum_scale = 0
chart.category_axis.maximum_scale = 180
axis_title(chart.value_axis, "RSSI (dBm)", size=12)
axis_title(chart.category_axis, "Time (s)", size=12)
chart.value_axis.major_gridlines.format.line.color.rgb = RGBColor(0xD9, 0xD9, 0xD9)
for ser in chart.plots[0].series:
    ser.smooth = False
    ser.format.line.width = Pt(2)
heard = list(aps.keys())
chart = category_chart(s, XL_CHART_TYPE.BAR_CLUSTERED, heard, [("Access points heard per scan", [aps[k] for k in heard])],
                       5.15, 4.6, 7.6, 2.25, title="Access points heard per scan", number_format="0", legend=False)
chart.category_axis.reverse_order = True
source(s, "Data: 11/8 RSSI phase (omnidirectional antenna) and 10/11 captures. σ = standard deviation.")

# ================================================================= 18. RR5b data: floor finding
s = slide("The AP List Alone Does Not Identify the Floor", notes=(
    f"This is the most important result of the data collection. The left image is EER level 2 from our 3D "
    f"model, with the two survey spots as dots; both sit in EER's open central area. The chart ranks the ten "
    f"strongest UT access points heard at the corridor spot, using UT IT's list to find the room each one is "
    f"installed in. Only {10 - other_floor} of the ten are on floor 2; the strongest is in room "
    f"{floors[0]['room']}, on floor {floors[0]['floor']}. So the list of routers the ESP32 hears does not tell "
    f"us which floor it is on. Our explanation is the open area: access points on other floors have a clear "
    f"path to the tag. We have not run a floor classifier yet, so this is not a measured accuracy; it is why "
    f"floor identification is our top residual risk."))
picture(s, asset("screenshots", "crop-floor2-survey-points.png"), 0.6, 1.4, 4.4, 5.4)
img_l, img_t, img_w, img_h = 0.6, 1.4, 4.4, 5.4
iw, ih = Image.open(asset("screenshots", "crop-floor2-survey-points.png")).size
scale = min(img_w / iw, img_h / ih)
ox, oy = img_l + (img_w - iw * scale) / 2, img_t + (img_h - ih * scale) / 2
for label, (px, py) in (("2.701 staircase", (234, 410)), ("2.813 corridor", (258, 553))):
    text(s, ox + px * scale + 0.08, oy + py * scale - 0.2, 1.8, 0.35, label, size=13, bold=True)
categories = [f"{f['room']} (floor {f['floor']})" for f in floors]
chart = category_chart(s, XL_CHART_TYPE.BAR_CLUSTERED, categories, [("Mean RSSI (dBm)", [f["rssi"] for f in floors])],
                       5.2, 1.4, 7.55, 3.75, title="Strongest 10 UT access points at the 2.813 corridor spot (11/8)",
                       number_format="0", legend=False)
chart.value_axis.minimum_scale = -95
chart.value_axis.maximum_scale = -65
chart.value_axis.crosses = XL_AXIS_CROSSES.MINIMUM
chart.category_axis.reverse_order = True
axis_title(chart.value_axis, "Mean RSSI (dBm); blue = floor 2, the spot's floor", size=12)
for i, f in enumerate(floors):
    pt = chart.plots[0].series[0].points[i]
    pt.format.fill.solid()
    pt.format.fill.fore_color.rgb = BLUE if f["floor"] == "2" else LIGHT
text(s, 5.2, 5.2, 7.55, 1.7, [
    f"{other_floor} of the 10 strongest are installed on floors 0, 1, and 3. The strongest is in {floors[0]['room']}.",
    "Likely cause: both spots are in EER's open central area, where APs on other floors have a clear path.",
    "No floor classifier has been run yet; this is not a measured accuracy.",
], size=16)
source(s, "Data: 11/8 RSSI phase, 2.813 corridor facing north; installed rooms from UT IT's AP list [12]. Image: BevoTag Signal Studio, EER level 2.")

# ================================================================= 19. Residual risks
s = slide("Residual Risks for EE 464", notes=(
    "We see two residual risks that matter most. First, floor identification: in open areas like EER's "
    "atrium, access points on other floors are heard as strongly as those on the tag's floor, which threatens "
    "the 95 percent floor target. We will use the full RSSI and CSI pattern across many access points rather "
    "than the list alone, use the IMU to detect floor changes on stairs and elevators, and survey spots away "
    "from the open area for comparison. Second, room accuracy has not been measured at all. We will survey EER "
    "level 2 facing four directions at three times of day and test only on spots held out of the survey. "
    "Power, CSI rate on the final tag, and IMU fusion are tracked too but come after these two."))
table(s, [
    ["Risk", "Why it matters", "Plan in EE 464"],
    ["Floor identification in open areas",
     "APs on other floors are heard as strongly as those on the tag's floor; target is > 95% correct floor",
     "Match full RSSI and CSI patterns, not the AP list; use the IMU to detect stairs and elevators; survey spots away from open areas"],
    ["Room-level accuracy is unmeasured",
     "No held-out test yet; target is > 90% correct room",
     "Survey EER level 2 facing 4 headings at 3 times of day; test only on spots held out of the survey"],
], 0.6, 1.5, [3.0, 4.3, 4.83], size=18, row_h=1.4)
text(s, 0.6, 6.0, 12.13, 0.8, "Also tracked: CSI capture rate and power on the final tag against the 24 h battery target; IMU fusion (no IMU data yet).", size=16)

# ================================================================= 20. Team contributions
s = slide("Team Contributions in EE 364D", notes=(
    "Introduce the table, then each member gives one sentence about their own row."))
table(s, [
    ["Member", "Role", "Contributions so far"],
    ["Ethan Chua", "Project Lead", "Coordinated UT IT access point request; ordered the omnidirectional antenna; planned and ran EER captures"],
    ["Esteban Martinez", "Hardware and firmware", "Selected and acquired logger hardware; ESP32 CSI capture; organized CSI data and metadata"],
    ["Li Shi", "Hardware and firmware", "Logger firmware and serial data format; survey collector and 3D building model"],
    ["Andrew Yin", "Software; Documentation Lead", "Logger web app and reliability testing; mapped survey points onto the 3D model; Project Definition"],
    ["Abhirit Das", "Software", "Logger web app interface and serial link; CSI logging and live plots; 3D model integration"],
], 0.6, 1.5, [2.4, 2.9, 6.83], size=17, row_h=0.8)

# ================================================================= 21. Conclusion
s = slide("Conclusion", "Title and Content", notes=(
    "Restate the purpose: this review presented the alternatives we considered, how we chose, and where "
    "BevoTag stands. Main points: Wi-Fi RSSI is the baseline with CSI under test; the omnidirectional antenna "
    "halved the largest heading effect; the ESP32 records CSI from campus access points; and the access point "
    "list alone does not identify the floor in open areas. Time and resources: we waited about a week for UT "
    "IT's access point list, every capture needs two people, and the survey covers EER level 2 only. Our "
    "assessment: the measurement chain works end to end, and floor and room accuracy are the questions EE 464 "
    "must answer."))
body(s, 0.6, 1.45, 12.13, 5.35, [
    [("b", "Purpose: "), "present our design alternatives, how we chose, and where BevoTag stands"],
    [("b", "Main points: "), f"Wi-Fi RSSI baseline with CSI under test; omnidirectional antenna halves the largest heading effect "
     f"({r1(ant['onboard_1011']['max'])} → {r1(ant['omni_1108']['max'])} dB); the AP list alone does not identify the floor"],
    [("b", "Time and resources: "), "about 1 week waiting for UT IT's AP list; 2 people per capture; survey covers EER level 2 only; no IMU or GPS data yet"],
    [("b", "Assessment: "), "the measurement chain works end to end; floor and room accuracy are the open questions for EE 464"],
], size=22)

# ================================================================= 22. Questions
s = prs.slides.add_slide(LAYOUT["Title Slide"])
s.shapes.title.text = "Questions?"
s.placeholders[1].text_frame.text = "BevoTag  ·  Team SP11"
s.notes_slide.notes_text_frame.text = (
    "About 5 minutes. Questions we could ask the audience if time allows: how much survey data is enough for "
    "fingerprinting, and whether CSI amplitude and RSSI carry different information.")

# ================================================================= 23. References
s = slide("References", "Title and Content", notes="Not presented; for the submitted file.")
refs = [
    "[1] Apple Inc. (2026). AirTag [Online]. Available: https://www.apple.com/airtag/",
    "[2] J. E. Yoder and T. E. Humphreys, \"Low-cost inertial aiding for deep-urban tightly coupled multi-antenna precise GNSS,\" NAVIGATION, vol. 70, no. 1, Mar. 2023.",
    "[3] A. S. Yaro et al., \"A survey of the performance-limiting factors of a 2-dimensional RSS fingerprinting-based indoor wireless localization system,\" Sensors, vol. 23, no. 5, 2023.",
    "[4] P. Bahl and V. N. Padmanabhan, \"RADAR: An in-building RF-based user location and tracking system,\" in Proc. IEEE INFOCOM, 2000, pp. 775–784.",
    "[5] X. Wang et al., \"CSI-based fingerprinting for indoor localization: A deep learning approach,\" IEEE Trans. Veh. Technol., vol. 66, pp. 763–776, 2017.",
    "[6] S. M. Hernandez and E. Bulut, \"Lightweight and standalone IoT based WiFi sensing for active repositioning and mobility,\" in Proc. IEEE WoWMoM, 2020, pp. 277–286.",
    "[7] F. Evennou and F. Marx, \"Advanced integration of WiFi and inertial navigation systems for indoor mobile positioning,\" EURASIP J. Appl. Signal Process., 2006.",
    "[8] G. Welch and G. Bishop, \"An introduction to the Kalman filter,\" Univ. North Carolina, Tech. Rep. TR 95-041, 2004.",
    "[9] D. Lymberopoulos et al., \"Microsoft indoor localization competition: Experiences and lessons learned,\" GetMobile, vol. 18, no. 4, 2014.",
    "[10] Espressif Systems. (2026). ESP-IDF Programming Guide: Wi-Fi Vendor Features [Online].",
    "[11] IEEE Standard 802.11-2020, Wireless LAN MAC and PHY Specifications, Feb. 2021.",
    "[12] UT Austin Information Technology Services, access point list and floor plans for EER and ECJ, provided to the team, Oct. 2026.",
    "[13] Radio Frequency Devices, 47 C.F.R. Part 15, 2025.",
    "[14] IEC 62133-2:2017 with Amendment 1:2021, Safety requirements for portable sealed secondary lithium cells and batteries.",
    "[15] UT Austin Information Security Office. (2019). Acceptable Use Policy for University Students [Online]. Available: https://security.utexas.edu/policies/aup",
]
ph = body(s, 0.6, 1.35, 12.13, 5.6, refs, size=12)
for p in ph.text_frame.paragraphs:
    p.space_before = Pt(2)
    pPr = p._p.get_or_add_pPr()
    etree.SubElement(pPr, "{http://schemas.openxmlformats.org/drawingml/2006/main}buNone")
    pPr.set("marL", "0")
    pPr.set("indent", "0")

# ================================================================= speakers
# One contiguous section per person, matched to each member's role. The first line of every slide's notes
# names the speaker.
SPEAKERS = {}
for numbers, name in (
    (range(1, 5), "Ethan"),      # Introduction: title, opener, problem statement, agenda
    (range(5, 10), "Andrew"),    # Design objectives and alternatives
    (range(10, 15), "Esteban"),  # Block diagram, plan vs. now, capture setup, antenna, firmware
    (range(15, 18), "Li"),       # Survey collector, 3D model, data collection
    (range(18, 21), "Abhirit"),  # Floor finding, residual risks, team contributions
    (range(21, 23), "Ethan"),    # Conclusion; Ethan moderates questions
):
    for n in numbers:
        SPEAKERS[n] = name
for n, sl in enumerate(prs.slides, start=1):
    if n == 23:
        line = "Speaker: none (not presented)"
    elif n == 22:
        line = "Speaker: Ethan moderates; each person answers questions about their own section"
    else:
        line = f"Speaker: {SPEAKERS[n]}"
    tf = sl.notes_slide.notes_text_frame
    tf.text = line + "\n\n" + tf.text

prs.save(OUT)
print("wrote", OUT, "slides:", len(prs.slides))
