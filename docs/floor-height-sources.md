# Floor height sources and remaining gaps

Reviewed **2026-10-21** for the EER, ASE, and ECJ room-and-wall model.

**ECJ now has 11 documented historical level elevations and one source-based estimate. EER and ASE still have no verified per-level elevation schedule.** No building's interior wall heights have been measured or verified. Documented means supported by a cited drawing, not certified as-built accuracy.

The model uses **Level 1 = 0 ft** as its local coordinate datum. For ECJ, values are normalized by subtracting the record drawings' **Level 1 EL 552 ft**. The original survey datum and finished-floor versus structural-slab interpretation are unspecified. A schematic placeholder must remain distinguishable from a documented elevation. Visual separation must not change these coordinates or exported elevations.

## ECJ: newly recovered record elevations

[Rodrigo Sarlo's 2018 Virginia Tech dissertation](https://hdl.handle.net/10919/84477), *High-Resolution, High-Frequency Modal Analysis for Instrumented Buildings*, reproduces WJE record drawings for UT project **CP412964**, dated **May 8, 2013**. [Appendix C, PDF pages 189-190](https://vtechworks.lib.vt.edu/bitstreams/b9653165-72de-4e1e-9470-21996593bbe9/download#page=189), printed pages 171-172, Figures C.1-C.2, contain south/east elevation sheets **S3.2/S3.1**.

| Model level | Drawing elevation (ft) | Local elevation (ft above Level 1) | Status |
| --- | ---: | ---: | --- |
| SB | Unknown | Unknown | Schematic placement only |
| B | 536 | -16 | Documented |
| 1 | 552 | 0 | Documented datum |
| 2 | 568 | 16 | Documented |
| 3 | 582 | 30 | Documented |
| 4 | 596 | 44 | Documented |
| 5 | 610 | 58 | Documented |
| 6 | 624 inferred; tag conflicts | 72 | Estimated; requires confirmation |
| 7 | 638 | 86 | Documented |
| 8 | 652 | 100 | Documented |
| 9 | 666 | 114 | Documented |
| 10 | 680 | 128 | Documented |
| 11 | 694 | 142 | Documented, with level correspondence below |
| 11M | Unknown | Unknown | Schematic placement only |
| R | Multiple roof surfaces not resolved | Unknown | Schematic placement only |

**Level 6 conflict:** both sheets print EL 536 ft for Level 6, duplicating the basement elevation. Their dimension chains show 14 ft between Levels 5-6 and 6-7, bounded by EL 610 and EL 638. These imply EL 624 ft; the model records the resulting 72 ft local coordinate as **estimated**, rather than silently correcting the source.

**Level 11 correspondence:** the drawings label EL 694 ft as Roof Level. PDF page 191, printed page 173, Table C.1 explicitly places Floor 11 sensors at Z = 126 ft relative to Level 2. Adding Level 2 EL 568 ft yields EL 694 ft. The same table corroborates B, 5, 7 and 9 at -32, 42, 70 and 98 ft relative to Level 2.

The drawings also identify the upper penthouse roof at EL 711 ft. That value is **not assigned to the complete R plan**: the local plan is titled **Roof (TBD)** and does not distinguish the heights of its nested outlines. SB and the elevator-equipment mezzanine 11M are absent from the elevation schedule. Their unknown status is preserved.

The drawing note derives existing-building information from Page Southerland Page's **March 10, 1971** contract drawings and requires field verification. These are historical drawing levels, not a new survey, guaranteed present conditions, measured wall heights, or an established finished-floor reference.

Source PDF SHA256: `5cf0c4aa258c6e5fb1f442d74a33a883c6b8c69c72b88acfea3b8795a84b53c8`.

## What the sources establish

| Building | Source | Supported evidence | Limit for this model |
| --- | --- | --- | --- |
| ASE (0983) | [UT building inventory](https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/ASE/) | Seven floors and the building's identity. | No floor elevations, floor-to-floor dimensions, or wall heights. |
| ASE | [Official drawing portal](https://utdirect.utexas.edu/apps/campus/lis/drawings/ASE/) | The inventory links here and labels the plans restricted. | The link redirects to UT authentication. Additional drawings were not inspected through this portal. |
| EER (0223) | [UT building inventory](https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/EER/) | Nine floors and the building's identity. | No floor elevations, floor-to-floor dimensions, or wall heights. |
| EER | [Ennead architect project page](https://www.ennead.com/work/eerc) | Primary architectural project description and imagery. | No numerical floor-elevation schedule was verified in the reviewed material. Renderings and photographs are not dimensional evidence. |
| EER | [Architect-provided transverse section, published by ArchDaily](https://www.archdaily.com/881939/cockrell-school-of-engineering-education-research-center-eerc-ennead-architects/59e83b27b22e38b6a3000639-cockrell-school-of-engineering-education-research-center-eerc-ennead-architects-section) | The original 2000 x 1500 image shows unequal lower-level spacing, so uniform spacing is not supported. | The graphic scale has no units; floor IDs, a vertical datum, and elevation dimensions are absent. It cannot establish numeric level elevations. |
| EER | [Official drawing portal](https://utdirect.utexas.edu/apps/campus/lis/drawings/EER/) | The inventory identifies the restricted plans. | The link redirects to UT authentication. No additional height information was recovered. |
| ECJ (0227) | [UT building inventory](https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/ECJ/) | Fourteen floors. The local model also includes a roof plan sheet. | Counting a roof sheet, basement, or mezzanine does not establish its vertical offset. |
| ECJ | [UT roof-replacement solicitation](https://construction.utexas.edu/26dbl001-cp2001733-ecj-roof-replacement-rfq), linking the [public RFQ PDF](https://utexas.box.com/s/k7zef80nsnhzma53vbyihkfszvcg483w/file/2253671762219) | Official provenance for RFQ 26DBL001, project CP2001733, including engineering assessment reports. | The public package contains no verified level-by-level elevation schedule. |

### ECJ: the 175 ft figure is overall context only

In the 326-page RFQ PDF:

- **PDF page 29**, Design Criteria Package, printed page 9, section 4.02: gives rooftop elevation as approximately **175 ft**, in the context of crane access.
- **PDF page 41**, WJE Roof Condition Assessment, printed page 1, dated August 26, 2025: describes a **175-foot-tall structure**.
- **PDF pages 61, 62, and 65** contain roof-plan and framing excerpts. Inspection did not establish a numerical floor-elevation schedule.
- **PDF page 66**, AEC-WAY structural assessment, printed page 3, section 2.2: identifies signed original structural drawings by Page Southerland Page, dated **March 10, 1971**, titled **`P-ECJ-OC-ASB-0227-NA-CTS-S-ALL-4`**.

The recovered record drawings put the penthouse roof 175 ft above basement (711 - 536), consistent with the report's approximate figure. The report itself does not identify its datum. Therefore **do not assign the model roof `elevation_ft: 175` above Level 1, divide 175 ft by a floor count, or use it to calculate mezzanine or basement elevations**. `building.vertical.overall_height_context` records it separately from floor coordinates. The RFQ's PDF page 64 explicitly distinguishes mechanical-penthouse floor L11 and roof L12; multiple roof surfaces remain to be modeled separately.

## Documents needed to establish elevations

Obtain current dimensioned sections for EER **0223** and ASE **0983**; confirm ECJ **0227** Level 6, SB, 11M and each roof surface. Resolve the reference datum and finished-floor/slab distinction before treating historical drawing levels as surveyed coordinates. Wall height needs its own evidence; floor-to-floor distance does not equal clear wall or ceiling height.

For ECJ, request the exact **`P-ECJ-OC-ASB-0227-NA-CTS-S-ALL-4`** set identified above, together with current architectural sections and subsequent modifications. This is a document identifier found in the source, not a claim that the full set was accessed.

The [UT Libraries Buildings Collection finding aid](https://archives.lib.utexas.edu/repositories/2/resources/84) identifies the university's architectural and engineering records custodians as holders of current architectural and as-built drawings. Its historical archive is not comprehensive, especially for later buildings. Use that record and [UT Planning, Design and Construction](https://construction.utexas.edu/) to locate the appropriate current records holder. No requests or messages have been sent.

## Repository provenance

Each `collector/buildings/<building>/building.json` records:

- `vertical.datum`: the chosen local Level 1 coordinate reference.
- `vertical.reviewed` and `vertical.research_status`: when the source review happened and whether documented elevations were found.
- `vertical.sources`: stable source IDs, public URLs, and the evidence and limitations of each source.
- `vertical.note`: building-specific gaps.
- ECJ only: `vertical.overall_height_context`, deliberately separate from any floor's `elevation_ft`.

ECJ floors additionally record `elevation_ft`, `elevation_source.status`, source reference, original/inferred elevation, normalization offset and reference interpretation. Unknown floors retain no elevation value. EER and ASE remain schematic vertically. Horizontal plan scale and registration residuals do not supply Z coordinates or certify on-site accuracy.

PDF metadata modification dates indicate file processing, **not** an as-built or field-verification date. Plan title-block dates and historical record-drawing dates also do not prove present room layouts. See [CAD source review](cad-source-review.md) for additional geometry evidence and renovation notices.
