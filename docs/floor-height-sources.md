# Floor height sources and remaining gaps

Reviewed **2026-10-21** for the EER, ASE, and ECJ room-and-wall model.

**No per-floor elevation schedule, floor-to-floor dimensions, or measured wall heights have been verified for these three buildings.** Public sources establish building identity and floor counts; one ECJ engineering report also gives approximate overall height. These facts do not justify replacing the previous uniform 14 ft spacing with another set of apparently measured values.

The model's coordinate datum is **Level 1 = 0 ft**, chosen for local coordinates. It is not a surveyed altitude, a sea-level datum, or evidence of the heights of other levels. A model placeholder or user-entered value must remain distinguishable from a documented elevation. Visual floor separation must not change physical elevations or exported coordinates.

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

The 175 ft passages do not identify a datum or the precise reference point at the building base. Therefore **do not assign the model roof `elevation_ft: 175`, divide 175 ft by a floor count, or use the figure to calculate mezzanine or basement elevations**. `building.vertical.overall_height_context` records it separately from floor coordinates.

## Documents needed to establish elevations

Obtain the current as-built architectural building sections, exterior elevations, structural level schedules, and relevant stair sections for EER **0223**, ASE **0983**, and ECJ **0227**. The documents should identify the reference datum and finished-floor or structural-slab elevations, including basements, mezzanines, roof levels, and any split levels. Wall height needs its own evidence; floor-to-floor distance does not equal clear wall or ceiling height.

For ECJ, request the exact **`P-ECJ-OC-ASB-0227-NA-CTS-S-ALL-4`** set identified above, together with current architectural sections and subsequent modifications. This is a document identifier found in the source, not a claim that the full set was accessed.

The [UT Libraries Buildings Collection finding aid](https://archives.lib.utexas.edu/repositories/2/resources/84) identifies the university's architectural and engineering records custodians as holders of current architectural and as-built drawings. Its historical archive is not comprehensive, especially for later buildings. Use that record and [UT Planning, Design and Construction](https://construction.utexas.edu/) to locate the appropriate current records holder. No requests or messages have been sent.

## Repository provenance

Each `collector/buildings/<building>/building.json` records:

- `vertical.datum`: the chosen local Level 1 coordinate reference.
- `vertical.reviewed` and `vertical.research_status`: when the source review happened and whether documented elevations were found.
- `vertical.sources`: stable source IDs, public URLs, and the evidence and limitations of each source.
- `vertical.note`: building-specific gaps.
- ECJ only: `vertical.overall_height_context`, deliberately separate from any floor's `elevation_ft`.

This source review adds **no numerical per-floor elevations**. The existing horizontal plan scales and registrations remain useful for XY geometry, but do not supply Z coordinates. When documented elevations become available, record the document, sheet/page, datum, units, and measurement interpretation alongside each value. Normalize values to the chosen local datum only after resolving finished-floor versus slab references. Preserve unknown values explicitly instead of silently promoting visual placeholders to measured geometry.
