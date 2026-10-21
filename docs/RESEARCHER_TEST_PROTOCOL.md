# Researcher test protocol — 15–20 minute guided evaluation

*Status: **proposed protocol**. No session has been run yet. Until one is, nothing here is a usability result.*

**Who:** one research reader (Daniel Reyes or another fellow), one facilitator. **Where:** reader's own laptop,
Chrome, live site or local copy. **Data:** public, de-identified CT only (RIDER sample + LIDC-IDRI cases).
**Recorded:** the app's Session summary CSV (timestamps, corrections, misses), the exported research CSV, the
facilitator's notes. Optional screen recording with the reader's consent.

## Before the session (facilitator, 5 min)

1. Open the site once, so the sample is cached. In **Session summary**, choose **Start a new timed run** on both
   sample scans, so the worklist is fresh.
2. Have the LIDC case folder ready (CT + AI result), with the reader's case ready to open.
3. Explain the ground rules: the AI proposes and the reader decides. Think aloud. There are no wrong answers, and we
   are testing the tool, not the reader.

## Session plan

| Min | Step | Reader does | Facilitator watches for |
|---|---|---|---|
| 0–2 | **Context** | Hears the goal: cut manual processing time without lowering measurement quality. Sees the sample baseline scan. | Does the reader understand what is AI and what is not? |
| 2–5 | **AI worklist** | Reviews the AI candidates: **J/K** to move, looks at each outline, **A** accept / **R** reject. | Time to the first decision; hesitation on small candidates; whether the location hint (lobe) is trusted. |
| 5–9 | **Correction** | Picks the AI outline that looks worst. Turns on the expert outline (dotted magenta), then fixes the edge with **E** erase / **B** brush. Watches the volume update, then approves. | Number of strokes and time (logged). Is undo (**⌘Z**) found? Is "edited by researcher" noticed? |
| 9–12 | **Difficult case** | Opens a LIDC ground-glass or small nodule case. Reviews the AI result and adds a missed nodule with **S** + click (or brush). | Does the reader find the miss? With the thick-slab view (**T**)? How long does adding it take? |
| 12–15 | **Follow-up + export** | Presses **.** to open the follow-up, checks the suggested pair ("▼% vs Baseline?"), and accepts it. Then exports the CSV or links the sheet and opens it in Excel. | Is the pair trusted? Is the change understood as volume? Is anything still re-typed? |
| 15–20 | **Feedback** | Answers the questions below. | Record the answers verbatim. |

## Questions (record answers verbatim)

1. Is the suggested worklist helpful?
2. Is it obvious which findings are AI-generated?
3. Can inaccurate contours be corrected efficiently?
4. Does the tool make it easy to find missed nodules?
5. Do the measurements appear understandable and trustworthy?
6. Is the follow-up comparison useful?
7. Does exporting eliminate repetitive spreadsheet work?
8. Which tasks would still require returning to the existing hospital viewer?
9. Would the tool save enough effort to justify using it regularly?
10. Which specific error would most reduce your confidence?

## After the session

- Save the Session summary CSV for each scan, plus the research CSV.
- Fill in the results table in `TIME_SAVINGS_EVALUATION.md §6`, marked "researcher session, <date>, <reader>".
- Write the observations as **observed** (what the reader did) vs **reported** (what the reader said).
- Do not generalise from one reader. The next step is the A-vs-B protocol (TIME_SAVINGS_EVALUATION.md §5).

## Asynchronous version (if no live session is possible)

Send the 7-slide walkthrough plus the live link, with three tasks: (1) review the sample worklist, (2) fix one edge
and approve it, (3) open the follow-up and export. Ask for the Session summary CSV and answers to questions 1, 3, 8
and 10. Any reply is a **reported** opinion, not an observed usability result.
