# System Design Report

**Due:** Fri Dec 4, 2026, 5:00 pm (Canvas, one team submission, unlimited attempts; early submission allowed)
**Graded by:** Writing TA (this assignment) and Technical TA (separate "Technical Content" assignment)
**Length:** about 15 to 20 pages of written text, not counting figures, tables, references, and appendixes

## Files

| Path | What it is |
|---|---|
| `main.tex` | LaTeX skeleton with every required heading and a `TODO` in each section. Build it with `pdflatex main.tex`, run twice. |
| `team-questions.md` | The 15 questions for the team, plus each member's answer file and risk reduction demo |
| `answers/` | One file per member (`ethan-chua.md`, `abhirit-das.md`, `esteban-martinez.md`, `li-shi.md`, `andrew-yin.md`). Each person edits only their own file. |
| `figures/` | Block diagram, test plots, Gantt export, and other figures |
| `resources/` | Assignment description, rubric, ECE Style Guide, and memo template |

## How this report differs from the earlier ones

- **Decimal section numbers are required** (1.0, 2.0, 3.1, 3.1.1). This overrides the "No decimal section numbers" rule in [`../writing-guide.md`](../writing-guide.md). `main.tex` is already set up for this, so use `\section`/`\subsection`/`\subsubsection` as usual.
- REFERENCES and the appendixes are unnumbered.
- **Appendixes A–E are mandatory.** If another appendix is added, the letters shift.
- All other formatting stays the same as the Prior Art Report. The preamble is copied from `../prior-art/main.tex`.

## Required outline and where the content comes from

| Section | Must contain | Source material |
|---|---|---|
| Memo heading | Exactly as in the template | Same as the Prior Art Report |
| 1.0 Introduction | Purpose, context, and a summary of the contents. An engineer new to the project should understand the problem, the approach, and the EE 464 plan. | — |
| 2.0 Design Project Background | Design problem, specifications written for a technical reader, and deliverables. Fix **every** TA comment on reused text. | `../project-definition/main.tex`, `TA_Feedback.txt`, annotated PDF |
| 3.0 System Design (overview para) | | |
| 3.1 Design Concept | System overview and **block diagram explained in the text**. For each subsystem: how it works, its inputs and outputs, and why it was chosen (rejected alternatives, tests, calculations, research, which spec it meets). Treat the UI as a subsystem. | `../oral-design-review/`, `../prior-art/main.tex` |
| 3.2 Risk Reduction | **Comprehensive** account of the lab experiments: methods, results, and analysis | `../risk-reduction-plan.md`, `../individual-risk-reduction-demos.md`, `../weekly-reports/` |
| 3.3 Test Plan | Key test(s) for each block, plus system-level test(s): procedure, data collected, and success criteria | Specs in 2.2 |
| 4.0 Project Management (overview para) | | |
| 4.1 Project Activities | Summary of the WBS (App. B) | |
| 4.2 Task Assignments | Summary of the LRC (App. C), with the rationale (fair workload, qualifications) | |
| 4.3 Project Schedule | Summary of the Gantt chart (App. D) in chronological order, with milestone **dates** | |
| 4.4 Project Budget | Summary of the BOM (App. E), organized in the same order as the table | |
| 5.0 Conclusion | Short summary for a manager, with a clear assessment of readiness for EE 464 and the prospects for success | — |
| References | IEEE style, required | Reuse the bibliographies of the earlier reports |
| App. A Relevant Standards | Updated from the Project Definition, with TA comments addressed | `../project-definition/main.tex` Appendix A |
| App. B WBS | All tasks from submission until the EE 464 prototype | |
| App. C LRC | Owner of every WBS task | |
| App. D Gantt Chart | Every WBS activity and milestone, from submission to the end of EE 464 | |
| App. E BOM | Major items only: description, quantity, and performance criteria (part numbers if known) | |

## Rubric checklist (Writing TA)

**Structure**
- [ ] The introduction opens with purpose and context and is specific to BevoTag
- [ ] The conclusion summarizes the purpose and main points, their significance, and what comes next
- [ ] Clear headings, with an intro paragraph before any group of 2+ subsections
- [ ] Topic sentences come first, transitions are smooth, and sentence length varies

**Organization**
- [ ] The body follows a logical line of argument, and the hierarchy matches the report's purpose
- [ ] Every subdivided section has at least 2 subsections
- [ ] Each paragraph covers one idea

**Content**
- [ ] Background covers the problem, clear specifications, and deliverables
- [ ] Design Concept starts with a system-level overview and explains every subsystem and its integration
- [ ] Design choices are justified at every level (alternatives, tests, calculations, research)
- [ ] Risk Reduction covers the methods, results, and analysis
- [ ] Test Plan gives procedures, data, and success criteria
- [ ] Sections 4.1–4.4 each summarize their appendix clearly

**Visual aids and appendixes**
- [ ] The block diagram is clear and legible
- [ ] WBS, LRC, Gantt, and BOM each have their own appendix
- [ ] Figures and tables are numbered, captioned, referenced in the text, and placed after their first mention
- [ ] Equations are numbered and discussed, and lists are formatted for easy reading
- [ ] Every appendix is referenced in the text

**Mechanics and formatting:** see [`../writing-guide.md`](../writing-guide.md). Watch especially for no first person, no "must," formal tone, and IEEE citations.
