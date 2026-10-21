# Time-savings evaluation — what is measured, what is estimated, and how to measure the rest

*Nodule Research Copilot · 20 Oct 2026 · research prototype*

**Bottom line:** the 50 % time reduction is **not proven yet**. What we can show today, measured: the machine
steps take seconds to about 2 minutes, unattended. The tool also records every researcher action with timestamps,
so a timed run produces its own evidence. What is missing: a timed run by a researcher (Daniel or another reader).
Until then, every "after" number for researcher time is an **estimate** and is labelled as one.

## 1. Four kinds of numbers (never mixed)

| Kind | Example | Where |
|---|---|---|
| **Customer-reported** | Daniel: 25–40 min per baseline scan | discovery call |
| **Measured — app processing** | load, AI import, accept, export, scan switch | §3, `docs/eval/app-processing-times.json` |
| **Measured — AI inference** | TotalSegmentator wall-clock per scan | §3, `data/lidc/inference-times.json`, RIDER file timestamps |
| **Measured — operator interaction** | active review time, corrections, pauses | the app's Session summary; **no researcher run yet** |
| **Modelled / estimated** | "time budget" to reach 50 % | §4, labelled *estimate* |

## 2. Baseline: Daniel's manual workflow (customer-reported, not measured)

| Task | Manual (self-reported) |
|---|---|
| Load CT | 1–2 min |
| Find nodules (2 passes, 250–400 slices) | 10–20 min |
| Measure long/short axis | 2–4 min per nodule |
| Full manual outline for volume | 15–25 min per selected nodule (~20 % of nodules) |
| Document (screenshot + re-type into the sheet) | 3–5 min |
| Follow-up matching | ~10 min extra (≈ 50 % of scans are follow-ups) |
| **Typical baseline scan** | **25–40 min** |

## 3. Measured today

### 3a. App processing (machine time)

Built app (the deployed build of 20 Oct 2026) served from local disk, headless Chromium with **software** WebGL on a
2-vCPU Linux container — slower than a researcher's laptop. Sample: RIDER-1129164940, two scans (262 + 236 slices).
3 runs, each in a fresh browser (`docs/eval/app-processing-times.json`).

| Step | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Click "Load sample" → first image | 4.1 s | 4.4 s | 4.3 s |
| Click "Load sample" → AI worklist ready (both scans' files, AI + lobes imported) | 11.5 s | 11.9 s | 12.3 s |
| Press **A** → finding approved, Type/Lobe filled, saved | 0.8 s | 0.2 s | 0.4 s |
| **Export CSV** → file written | 0.11 s | 0.29 s | 0.12 s |
| Press **.** → follow-up image | < 0.1 s | < 0.1 s | < 0.1 s |
| Press **.** → follow-up AI candidates paired ("▼45 % vs Baseline?") | 9.1 s | 8.8 s | 8.6 s |

The exported row was checked: RIDER-1129164940, 2006-09-05, Baseline, N1, solid, RUL, 65.5 × 49.3 mm,
79,677 mm³, source "AI (TotalSegmentator 2.18.0 lung_nodules)", measured slice 82.

### 3b. AI inference (machine time, unattended)

| Data | Machine | Per scan | How measured |
|---|---|---|---|
| RIDER, 59 scans | MacBook, Apple Silicon, `--device mps` | median **100 s** (p10 78 s, p90 121 s, max 154 s) | gaps between the output files of one sequential loop (12:17 → 13:51 UTC) — *partially verified* |
| LIDC-IDRI, 15 scans | MacBook Pro, Apple M3 Pro, `--device mps` | median **97 s** (69–129 s), 0 failures | wall-clock per scan, logged by `scripts/lidc/prepare_lidc.py` — *verified* |

The AI runs before the researcher sits down (it can run as a batch). It costs **computer time, not researcher time**.
The researcher's only cost is starting it, which is one command for a whole folder of scans.

### 3c. Operator interaction — instrumentation (ready, no researcher data yet)

Captured automatically from the app's own timestamps (`src/findings/session.ts`, shown in **Session summary**, saved
as CSV with one row per scan):

| Captured | How |
|---|---|
| Task start / end | first and last action on the scan (AI import, click, edit, decision, export) |
| Active time on scan | sum of gaps between actions; **a gap over 2 min counts as a pause and is left out** (count and length of pauses are reported) |
| Per-finding work | the gap before each action is credited to that action's finding; median per decided finding |
| Corrections | brush/erase strokes, undo, reset, re-segment: count, findings corrected, time spent |
| Rejected AI findings | count |
| Added by researcher (misses) | count |
| Exports | Export CSV count and time; rows exported |
| AI processing | outside the app (above); the AI file carries model + version + run date |

Not captured: time to open the scan (load is measured above), time spent in other software, and attention. An
abandoned session is just a scan whose last action is "to review" — it shows as *still to review* and its time stops
at the last action.

## 4. Estimate (modelled, not measured): the time budget for the 50 % goal

The target is ≤ 50 % of the manual time. For a 25–40 min baseline scan, that means a researcher budget of **12.5–20 min per
scan** for the whole AI-assisted workflow:

| AI-assisted step | What the evidence says | Researcher time |
|---|---|---|
| Load + AI | measured: seconds of app time; AI ~100 s unattended | ~0 (batch) |
| Review AI candidates | median 4 candidates per RIDER scan (90th pct 23); each is one keypress after a look | **to be measured** |
| Confirming pass for misses | AI missed 6/59 RIDER tumours; a thick-slab (MIP) pass replaces the 2 slice-by-slice passes | **to be measured** |
| Fix edges | Dice ≥ 0.7 on 31/59 scans → *assumption:* about half of the AI outlines need edge correction before volumetry | **to be measured** (corrections are counted) |
| Add missed nodule | click (fails 1 in 3 on RIDER) or brush | **to be measured** |
| Document + follow-up | measured: export < 0.3 s; pairing automatic | ~0 + review of the pair |

So the 50 % goal is reached if review + confirming pass + corrections fit in about 12–20 minutes per scan. That is
plausible: the outline (15–25 min) and re-typing (3–5 min) steps are mostly gone. But it is **only a hypothesis until a
researcher is timed**. Small and ground-glass nodules (LIDC results) are where corrections and misses concentrate.

## 5. Protocol for a fair A-vs-B comparison (to run with Daniel or another reader)

**Task (same for both):** find every nodule ≥ 3 mm; record long/short axis for each; full outline + volume for the
largest nodule; enter the lab's spreadsheet row(s); for follow-ups, match each nodule to the prior scan.
**Quality bar (same for both):** checked afterwards against the LIDC-IDRI reader consensus — detection sensitivity and
measurement error must not be worse with the tool (non-inferiority, margin agreed before the run).

| | Workflow A — manual | Workflow B — AI-assisted |
|---|---|---|
| Software | the lab's current viewer + spreadsheet | this tool (AI results pre-computed, like an overnight batch) |
| Given | the CT only | the CT + AI candidates; **no** expert outline, no lesion coordinates |
| Timer | stopwatch from "scan open" to "row saved" | app timestamps + the same stopwatch |
| Recorded | time per step (sheet), misses, measurements | Session summary CSV + export |

- **Cases:** 10 LIDC-IDRI scans (mix: solid small, ground-glass/part-solid, large; 3–4 follow-up pairs from RIDER).
- **Learning effects:** split into two sets of 5; reader does set 1 in A and set 2 in B, then (after ≥ 2 weeks) the
  reverse. Order of A/B alternates. One practice scan with the tool first, not counted.
- **Reported:** per scan and per step (A vs B); misses and corrections; measurement differences vs consensus;
  pauses excluded on both sides with the same 2-min rule.
- **Confounders to state:** the reader's familiarity with each tool; public data ≠ the lab's scanners; the AI was run
  in advance (its compute time reported separately); one reader.

## 6. Results so far

| Case | Workflow | Total | Breakdown | Corrections | Misses | Status |
|---|---|---|---|---|---|---|
| — | A (manual) | — | — | — | — | not run: no researcher available; Daniel's self-report used as "before" |
| RIDER-1129164940 (2 scans) | B, machine steps only | load 12 s, follow-up 9 s, accept < 1 s, export < 0.3 s | §3a | — | — | **measured** (app processing) |
| — | B (researcher) | — | — | — | — | **pending**: needs a timed reader session (RESEARCHER_TEST_PROTOCOL.md) |

**Limitations.** No researcher has been timed. App timings come from a slow software-rendering container. AI timings
come from one Apple Silicon laptop. The manual baseline is self-reported.
