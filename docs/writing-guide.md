# BevoTag Writing Guide: What the TA Wants

A working guide for every BevoTag report (Prior Art Report, System Design Report, Final Report, and
any resubmission). It combines three sources:

1. **The TA's own comments** on the Project Definition (Mugdha Jadhao): 21 inline comments in
   `docs/project-definition/annotated-SP11_Project_Definition.pdf`, her summary in
   `docs/project-definition/TA_Feedback.txt`, and the rubric marks in `docs/project-definition/SP11.doc`.
2. **The course rules**: the ECE Writing Style Guide and the memo-style report template in
   `docs/prior-art/resources/`.
3. **What worked** when revising the Prior Art Report against all of the above.

Rules marked **[TA]** come straight from her comments. Rules marked **[Guide]** come from the style
guide or template. Rules marked **[Inferred]** are reasonable readings of her taste. Treat those as
strong defaults, not certainties.

> The source files listed above (the annotated PDF, `TA_Feedback.txt`, `SP11.doc`, and the course
> handouts) stay local and are not in the repo. Ask a teammate for copies.

---

## How the Project Definition was graded

| Rubric area | Mark | Her main complaints |
|---|---|---|
| Structure | **Very Poor** | Intro carried design details; conclusion too long |
| Organization | Below Average | Subheadings broke the story; ideas did not flow |
| Content | Below Average | Problem Statement lacked purpose, method, and metrics |
| Visual Aids | Average | Figures good; one table crowded; figure referenced far from its explanation |
| Mechanics, Grammar, Style | Below Average | First person, "must," informal tone, grammar |
| Formatting | Below Average | Citation format wrong throughout |

Most lost points came from **voice, structure, and citations**, not from technical content. Those
are the cheapest points to win back.

---

## The 12 rules that matter most

1. **No first person.** Never use *we*, *our*, or *us*, even in the subject line. **[TA]**
2. **Do not use "must."** Say what the design *will* do, or what a successful design achieves. **[TA]**
3. **Write formally.** No idioms, no casual verbs, no contractions. **[TA]** **[Guide]**
4. **Keep the Introduction high-level:** purpose, context, and a summary of the document. No
   numbers, acronyms, or technical detail. **[TA]**
5. **Keep the Conclusion short:** one paragraph (about 8 to 10 lines) that summarizes and says what
   comes next. **[TA]**
6. **Tell a story.** Do not chop a short section into one-paragraph subheadings. **[TA]**
7. **Spell out every abbreviation at first use**, including well-known ones like GPS. **[TA]**
8. **Cite as plain `[n]`.** Never `[1, Sec. I]` or `[3, Table 4]`. **[TA]**
9. **Back every claim** with a citation, and do not invent categories ("the three existing
   approaches") that no source supports. **[TA]**
10. **Be literally precise** about what the device does. **[TA]**
11. **Use a numbered list** whenever the text announces a count ("four changes," "five measures"). **[TA]**
12. **Place each figure or table right after the paragraph that introduces it**, and do not crowd
    tables. **[TA]** **[Guide]**

---

## 1. Voice and tone

### No first person [TA]
She wrote "dont use first person" on page 1. That covers *we, our, us, ours* everywhere: body,
headings, table text, and the memo **SUBJECT** line.

| Instead of | Write |
|---|---|
| We searched IEEE Xplore… | The team searched IEEE Xplore… |
| Our tag will capture… | BevoTag will capture… / The tag will capture… |
| We therefore decided to… | The team therefore decided to… |
| …that matter to us. | …that matter to BevoTag. |
| We have revised our survey protocol… | The team has revised the survey protocol… |
| …Patents That Inform Our Design | …Patents That Inform the Design |

Use "the team," "BevoTag," "the design," or occasional passive voice. Vary them so no single phrase
repeats in every sentence.

### Avoid "must" [TA]
She flagged "must" ("We discussed in WC about 'must' usage here"). It reads as commanding.

| Instead of | Write |
|---|---|
| BevoTag must locate an item to… | A successful design will identify… |
| Any design must measure, transmit… | BevoTag addresses this need by… |
| …the baseline every design must beat | …the baseline for every later design |
| …a survey must cover several orientations | …a survey needs to cover several orientations |

### Formal tone [TA] [Guide]
- No idioms or slang: *earn its place*, *open field*, *heavy to compute*, *seven-hour struggle*.
  Write *computationally expensive*, *narrowed to two candidates*, and so on.
- No contractions (*don't, it's*). **[Guide 4.2]**
- *based on* only after *to be*; otherwise *on the basis of* or *that relies on*. **[Guide 4.5]**
- Use *while* only for time; otherwise *whereas* or *although*. **[Guide 4.5]**
- *Data* is plural. Use *toward*, not *towards*. **[Guide 4.5]**
- Use the series (Oxford) comma. **[Guide 4.1]**
- Spell out numbers up to ten; use numerals above ten and with units (5 m, 10 s). **[Guide 4.3]**
- Tense: past for what the team did, future for what it will do, present for facts and for what
  the document says. **[Guide 4.4]**

---

## 2. Structure

### Introduction [TA] [Guide]
Her comments: "dont [put] many technical details for introductory para"; "try to consolidate these
two statements into one … further details mention in the next sections"; the second paragraph
"does not belong there"; and "a summary of [the] document … is expected in this section."

**Template (one paragraph):**
1. **Purpose:** what this document does.
2. **Context:** one sentence on what BevoTag is, plus where the project stands.
3. **Summary of the document:** the essential idea of each section, not just a list of headings.

**Do not put in the Introduction:** statistics, acronyms (CSI, RSSI, IMU), citations, requirements,
team roles, or design details. Save them for the body.

### Problem Statement / Overview section [TA]
She wanted it to:
- introduce BevoTag,
- state its purpose and motivation,
- summarize the method, and
- outline the metrics or functionality that define success.

She also said "there is not a need for these subheadings… present these paragraphs in a cohesive
flow… like you are telling a story about your design's development." A section of two or three
paragraphs should have **no subheadings**. A good order is **need, approach, targets**.

### Subheadings [TA] [Guide]
- Use them only where a section is long enough to need navigation (for example, one per reviewed
  paper or patent).
- At any level, use **at least two** subheadings or none.
- Put an **introductory paragraph** between a heading and its first subheading.
- Heading styles: **FIRST LEVEL BOLD CAPS**, **Second Level Bold**, ***Third Level Bold Italic***.
  Avoid fourth-level headings.

### Conclusion [TA]
She commented "Too long conclusion. Summarize the details further" on the Project Definition, which
had three paragraphs.
- **One paragraph, about 8 to 10 lines.**
- Restate the purpose, give the main findings in one or two sentences, state what they mean for the
  design, and end with what comes next.
- No new information, few or no numbers, and no repeated list of every result.

### Flow and transitions [TA] [Rubric]
- Open every paragraph with a **topic sentence** that states its main idea.
- **Link paragraphs.** The first sentence of a new subsection should connect to the one before it:
  - "Because DeepFi relied on a laptop card, evidence was also needed that BevoTag's own hardware…"
  - "Whereas Ricoh's patent uses inertial navigation to build a survey, BlackBerry's patent…"
  - "Each study above tested one system in a space of the authors' choosing. In contrast…"
- One idea per paragraph (paragraph unity).
- Vary sentence length. Avoid long chains of clauses joined by "and" and ", so."

---

## 3. Clarity and precision

### Say exactly what the device does [TA]
She asked of "place an item in the correct room in more than 90% of trials": "What does this
sentence exactly mean? … isn't the tag instead detecting the item?"
- Not this: *place the item in the correct room*
- Write: *identify the room that contains the item*

Before submitting, reread every sentence whose subject is "the tag," "the system," or "BevoTag," and
ask: *Is that literally what it does?*

### Give concrete examples for vague terms [TA]
On "infrastructure we cannot control" she wrote "sounds a bit vague. Give example or more details."
Write: *without new infrastructure such as Bluetooth beacons installed in every room.*

### Define every abbreviation at first use [TA] [Guide]
She wrote "do not use abbreviations before giving full forms."
- Expand at first use, then use the short form: *channel state information (CSI)*.
- This includes "obvious" ones: *Global Positioning System (GPS)*, *wireless local area network (WLAN)*.
- Avoid unexplained conference acronyms in the text (INFOCOM, WoWMoM). Write "presented in 2000"
  and leave the venue to the reference list.
- After an abbreviation is defined, use it consistently.

### Support every claim [TA]
On "the three existing approaches" she asked: "did you mention the existing approaches before? No
citation too. And are there only three approaches…?"
- Every factual claim about other work needs a citation.
- Do not create neat categories ("three approaches," "the only solution") unless a source supports them.
- Introduce an idea before relying on it.

### Avoid weird or ambiguous phrasing [TA]
She called "system of a…" a "weird phrasing" and marked "locate a tagged item **to within**" as
incorrect grammar. Watch for:
- Dangling "which" that could attach to the wrong noun.
- "The other three" without saying three of what.
- Elliptical clauses ("as BevoTag will to hear…").
- Pronouns ("it," "they," "this") with unclear antecedents.

---

## 4. Citations and references

### In-text citations [TA] [Guide 3.1]
She marked `[1, Sec. I]` as an **"incorrect way of citation"** and said to fix it "in the entire
document."
- Use **plain `[n]`** only. No `Sec.`, `Table`, or `§` locators inside the brackets.
  (The style guide allows page numbers, `[6, p. 23]`, but plain `[n]` is safest with this TA.)
- Number sources in order of **first citation**: the first source cited is [1].
- Reuse the same number for later citations of the same source.
- Put the bracket **before** punctuation, with a space before it: `…indoors [1].`
- Cite multiple sources as `[2], [3]`.

### Reference list [Guide 3.2, Appendix A]
- Heading **REFERENCES** (bold caps), directly after the Conclusion.
- Bracketed numbers **flush left**, text at a tab, single-spaced within an entry, and a blank line
  between entries.
- End every entry with a period.
- Use ***et al.*** for **three or more** authors (the course guide's rule, which overrides the
  newer IEEE rule).
- Omit the issue number (`no.`) for **IEEE Transactions** articles.
- Patents: `J. K. Author, "Title of patent," U.S. Patent x xxx xxx, Abbrev. Month day, year.`
- Web pages: `Org. (year). Title [Online]. Available: URL.`
- Cite journal articles found online as periodicals, not as web pages. A link to a search database
  is not a source.

---

## 5. Lists, tables, and figures

### Numbered lists [TA] [Guide 2.5]
On "We commit to five measures: …" she wrote "the measures can be mentioned in numbered list below."
- If a sentence announces a count ("four ways," "five measures"), follow it with a **numbered list**.
- Introduce every list with a lead-in sentence.
- Keep items **parallel** in grammar (all start the same way).
- Indent lists.

### Figures and tables [TA] [Guide 2.4]
- **Mention each one in the text before it appears**, in the paragraph right before it. She was
  confused when a figure was described far from where it appeared.
- **Say what the reader should see** in that mention ("Table 2 summarizes the five patents: the two
  expired patents are free to use…").
- If the graphic lands on a later page, say so ("Table 1 on the next page").
- Table titles go **above** ("Table 1. Title"); figure captions go **below** ("Figure 1. Title").
  Both are bold, initial caps, and centered.
- **Do not crowd tables.** She called one table "readability low and crowded" and praised a table
  with more white space ("Better readability here"). Add space between rows and keep cells to two
  or three lines.
- Do not let numbering collide. She confused "four functions" in the text with "four steps" in a
  figure. If two lists of four appear near each other, make the link explicit.
- She liked the figures ("good job on the figure"), so keep the diagrams.

---

## 6. Formatting checklist [Guide 2.1 to 2.3, template]

- 12-point Times or Times New Roman.
- 1.5 line spacing; 1-inch margins on all sides.
- Block paragraphs: no indent, one blank line between paragraphs.
- Ragged right (not justified).
- Page numbers centered at the bottom, on every page except page 1.
- Memo heading exactly as in the template: **DATE**, **TO**, **FROM**, **SUBJECT** in bold caps, two
  columns, single-spaced within a field.
  - **DATE** is the due date (for example, November 6, 2026).
  - **TO:** Dr. Haris Vikalo / **Mugdha Jadhao**. Note the spelling: Jadhao, not "Jadao."
  - **SUBJECT** names the document type and topic, in third person.
- No heading alone at the bottom of a page, and no single line of a paragraph alone at the top or
  bottom of a page.
- No decimal section numbers in memo-style reports.
- Appendixes: a divider page titled "APPENDIX A — Title," referenced in the text, continuing the
  page numbers.

---

## 7. Length

- Prior Art Report: **6 to 10 pages**, plus extra space for figures, tables, references, and
  appendixes. Other reports have their own limits; check each assignment.
- Practical target: **the Conclusion should end no later than page 10 plus the space the tables
  take.** For the Prior Art Report, that meant ending on page 11 with about 0.8 page of tables.
- Easy places to cut: the same fact or decision stated in both the review and the impact or
  analysis section; restated table contents; status sentences repeated in several places.
- Do not cut the parts the rubric checks: search procedures, how each source relates to the
  requirements, and the summaries in the Introduction and Conclusion.

---

## 8. Pre-submission checklist

Search the source (`main.tex`) or the PDF text before every submission.

**Voice**
- [ ] No *we / our / us* anywhere, including the memo subject line and table text
- [ ] No *must*
- [ ] No contractions, idioms, or casual phrasing

**Structure**
- [ ] Introduction is one paragraph: purpose, context, and summary of the document, with no numbers,
      acronyms, or citations
- [ ] No section split into one-paragraph subheadings; at least two subheadings per level
- [ ] An introductory paragraph under every heading that has subheadings
- [ ] Conclusion is one paragraph of about 8 to 10 lines that ends with next steps

**Clarity**
- [ ] Every abbreviation is expanded at first use (search for runs of two or more capital letters)
- [ ] Every claim about other work has a citation
- [ ] Every sentence about what BevoTag "does" is literally true
- [ ] Vague terms have an example

**Citations and references**
- [ ] Only plain `[n]` in the text (search for `\cite[`)
- [ ] References numbered in order of first citation
- [ ] *et al.* for three or more authors; no `no.` for IEEE Transactions

**Lists, tables, and figures**
- [ ] A numbered list wherever the text announces a count
- [ ] Each table or figure is introduced in the paragraph right before it, with a sentence on what
      it shows
- [ ] Tables are spaced and readable

**Format and length**
- [ ] Memo heading: due date, "Mugdha Jadhao," third-person subject
- [ ] Page numbers from page 2; 12-point Times; 1.5 spacing; 1-inch margins; ragged right
- [ ] Length within the assignment's page limit (tables and references excluded)

**Process** (her summary: "proofread the document for each other")
- [ ] At least one other team member has read the whole document before submission
