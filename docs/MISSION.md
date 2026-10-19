# MISSION — Nodule Research Copilot (Base44 FDE assignment, Part 1)

You are the lead engineer on this project, working directly in this repository with a real shell and browser.
I (Yuval) am the FDE and product owner. I am not a medical-imaging engineer: make the technical calls, explain the
important ones in plain language, and ask me only for authorization, product decisions, or manual testing.

**Hard deadline: Thursday 22 Oct 2026, 18:00 (Israel time).** Today is 19 Oct. That is ~3 working days, not 3 weeks.
Scope ruthlessly. A small thing that works end-to-end beats a large thing that half-works.

Read first: `CLAUDE.md` (project rules + known Vite/Cornerstone pitfalls), `README.md`, then the code.

---

## 1. What "winning" means (the grading lens)

Base44 is evaluating **how I think about the product, how I communicate, and how fast I turn an idea into something
that works**. The deliverables are:

1. A link to the running tool + source code + run instructions.
2. Results: **what works, what fails, and how we measured the time saved**.
3. A live presentation.

So every engineering choice must serve one of these: a convincing live demo, an honest measured result, or a clear
story. Honesty about failures is scored, not penalized. Fake AI or invented numbers would sink the whole project.

## 2. The customer, in their own words (verified in discovery — do not re-ask)

**Naomi Hart (Research Director, decision-maker)**
- Demo in "three weeks": *"a live demo on public data showing the tool finding and measuring a nodule, with Daniel
  correcting its work, and a short summary of how many minutes that saves."* ← **this sentence is the acceptance test.**
- Pilot success = *Daniel has a tool he trusts that lets him work faster than he does now.* 50% is a goal, not a gate.
- Must be **intuitive enough for the lab to open and use themselves** on the practice scans.
- Everything runs **in the browser**, on **public data**, **zero budget**, **no hospital IT approval**.
- Last year's vendor failed because it was (1) expensive, (2) needed IT approval, (3) **couldn't handle their
  measurement sheet**, (4) **only allowed accept/reject — Daniel couldn't fix its mistakes**. We must visibly beat all four.

**Daniel Reyes (Research Fellow, the user and the judge of trust)**
- Baseline scan 25–40 min; follow-up adds ~10 min. 1–3 nodules per scan; ~50% of scans are follow-ups.
- Steps: load thin axial series + lung window (1–2 min) → find nodules, two full passes over 250–400 slices
  (10–20 min, biggest bottleneck; biggest risk is *missing* small/ground-glass nodules; no second reader) → long and
  short axis with a ruler on the slice where it looks largest (2–4 min/nodule) → full slice-by-slice outline for volume
  (15–25 min/nodule, done for ~1 in 5 because it is so slow) → screenshot + **re-type everything** into his sheet
  (3–5 min, typo-prone; his viewer cannot export).
- Follow-up: opens last row + screenshot, re-finds the nodule by **anatomical landmarks, not slice number** (breathing
  shifts), re-measures, types a new row with match status **Confident / Uncertain** and notes on change.
- Sheet columns: **Patient ID, Date, Timepoint, Series, Nodule ID, Type, Lobe, Long diameter, Short diameter, Volume,
  Match status, Minutes, Notes.**
- Dream tool: *everything found and outlined, measured in mm, auto-paired on follow-up with growth on screen; "my job
  would be to review, adjust, and confirm"; "the spreadsheet would fill itself in the background."*
- Realism: *"I'm happy to start with small, honest steps — as long as I can check the work and it saves me real time."*
- He wants to stay **in control of the final edge call**.

## 3. The product bet (read this carefully — it shapes everything)

AI detection is the highest-risk feature and may not work well on this data in 3 days. So the product must deliver
real minutes **even if detection fails**. The minutes are hiding in the steps that need no AI miracle:

| Daniel's step | Today | With the tool | How |
|---|---|---|---|
| Measure long/short axis | 2–4 min | < 1 min | One click on the nodule → 3D segmentation → auto long/short axis (editable) |
| Full outline for volume | 15–25 min (20% of nodules) | 1–3 min | Same click gives a 3D mask; Daniel fixes edges with brush/eraser; volume recomputes |
| Screenshot + re-typing | 3–5 min | ~0 | Row auto-filled from scan metadata + measurement; screenshot auto-captured; CSV in his column order |
| Follow-up re-find + compare | ~10 min | 2–3 min | Baseline finding stored in patient coordinates; jump to the same region, side-by-side, change auto-computed |
| Find nodules (2 passes) | 10–20 min | reduced, **not replaced** | AI candidates as a *second reader*, plus a thin-slab MIP view that makes nodules pop out from vessels |

**Core loop to build first and make flawless:**
**click nodule → segmented + measured in mm → Daniel adjusts → Approve → research row exists → export CSV.**

Product principle: **AI/algorithm proposes → Daniel edits and confirms → the system documents.** Every value carries
its provenance: `ai-model`, `semi-auto (click)`, `manual`, `expert-reference`, and `edited-by-researcher`.

## 4. Data facts you must exploit

- **RIDER Lung CT** (TCIA, CC BY 4.0, cite the DOI): 32 NSCLC patients, each scanned **twice on the same day**
  ("coffee-break" test–retest). Tumours cannot grow in 15 minutes, so:
  - Use the **two scans of one patient as the "baseline → follow-up" demo pair**. Matching is a realistic problem
    (patient repositioned and re-breathed) and the true change is ~0.
  - Any measured difference between the two scans is **measurement variability**. That gives a principled,
    honest quality metric: compare our variability with the manual/expert variability.
- **RIDER-LungCT-Seg**: expert tumour segmentations (gross tumour volume), DICOM **SEG and RTSTRUCT**, 31 subjects.
  Confirm from its metadata which segmentations are manual and which are automatic, and **which CT series each one
  references (by SeriesInstanceUID / ReferencedSOPInstanceUIDs)**. Never assume a mask belongs to the loaded series.
- Local data: inspect `~/Downloads/rider_lung_ct/` (TCIA Data Retriever layout). Ask me for folder access if needed.
  Currently verified working: RIDER-1129164940, 262 slices, 512×512, 1.25 mm, Explicit VR Little Endian.
- These are mostly **primary tumours, often large**, not small screening nodules. Say so; don't claim small-nodule or
  ground-glass performance we didn't measure.
- The same collections are also on NCI **Imaging Data Commons (IDC)**, which may allow loading a public sample over
  DICOMweb without hosting it ourselves. Verify CORS/quotas before relying on it.

## 5. Build plan (in strict priority order, with gates)

Every milestone ends with: `npm run check` green → manual test in Chrome → git commit → 4-line report
(**BUILT / VERIFIED / BLOCKED / NEXT**). Never mark something verified that you didn't actually run.

### M0 — Foundation (Mon evening, ≤2 h)
- Git repo + private GitHub repo `yuvAIL/nodule-research-copilot` (**ask me before creating/pushing**).
- **Fix the reload problem:** today Cmd+R loses the scan and all work. Persist sessions in IndexedDB; use the File
  System Access API (`showDirectoryPicker`, store the handle) so after a reload Daniel clicks once to re-open the
  same folder. Fall back gracefully on browsers without it.
- **Load Sample CT** button: one public RIDER pair (both timepoints) served from a static host or IDC, never from the
  git repo. Keep **Load CT Folder** for local scans, processed 100% in the browser. Show attribution.
- Deploy the static app (Vercel / Netlify / Cloudflare Pages / GitHub Pages) so Naomi has a URL with no install.
  Verify in DevTools Network that local DICOM bytes are never uploaded, and only then claim it.

### M1 — Measure & edit (Tue, the heart of the demo)
Use existing Cornerstone3D 5.13.1 tools wherever possible (check what each actually does in this version):
`RegionSegmentPlusTool` / `RegionSegmentTool` (click-to-segment), `SegmentBidirectionalTool` (long/short axis
from a segment), `BidirectionalTool` (manual, editable perpendicular axes), `BrushTool` + eraser (edge
correction), `PlanarFreehandContourSegmentationTool`, segmentation statistics (volume). These need a volume
viewport and segmentation state: migrate carefully from the current stack viewport and **don't regress loading,
scrolling, W/L, zoom or pan.**
- Measurements in physical mm from DICOM geometry; volume = voxel count × voxel volume (mm³, also show mL).
- Short axis = longest diameter perpendicular to the long axis in the same axial plane (RECIST-style). Document it.
- **Unit tests on synthetic phantoms** (sphere/ellipsoid of known size, anisotropic spacing) must pass before
  trusting any number.
- Edits update measurements live; undo/reset; "Approve" locks a version and keeps the history.

### M2 — Documentation that writes itself (Tue night)
- Finding card → research row auto-filled: Patient ID, Date, Series, Timepoint, Nodule ID (auto N1, N2…),
  diameters, volume, provenance, review status, minutes spent (measured by the app). Daniel fills only judgment
  fields: Type (solid / part-solid / GGO), Lobe (pre-suggested if derivable, else a dropdown), Notes.
- **CSV export in exactly his column order and names**; also **CSV import** of a previous sheet so a follow-up
  starts from his existing baseline row. That beats the vendor's failure #3 head-on.
- Auto-saved PNG of the measured slice with overlay, named by Patient_Timepoint_Nodule.
- Missing required fields are visible and block "Complete scan" (not export).

### M3 — Follow-up comparison (Wed)
- Baseline (scan 1) and follow-up (scan 2) side by side; selecting a baseline nodule jumps the follow-up view to
  the same patient-coordinate region (optionally refined by a simple registration step; label it honestly).
- Daniel confirms the match (Confident / Uncertain); then Δ long axis (mm, %), Δ volume (mm³, %) are computed and a
  follow-up row is written. Automatic matching is a stretch goal. Never call manual matching "automatic".

### M4 — AI candidates (timeboxed: 4 h total, can run in parallel with M1–M3 in a separate Python folder)
- Evaluate quickly, in this order: TotalSegmentator (check whether a lung-nodule/lung-tumour task exists in the
  current release, its license and whether weights are free for research), MONAI model-zoo lung nodule detection
  (LUNA16 RetinaNet), one other credible option. Record task, license, weights, CPU/Mac runtime, input format.
- Run **real inference** on the RIDER scans; convert outputs into the same DICOM patient coordinates; load them as
  **candidate findings** in the review queue, labeled `AI candidate — precomputed with <model>, <date>`.
- In-browser live inference is a stretch goal (ONNX Runtime Web). If it is not feasible, say so and explain why
  (model size, WebGPU availability, runtime); precomputed results on public data are acceptable if clearly labeled.
- Optional, no-AI finding aid: a thin-slab MIP (e.g. 10 mm) toggle — vessels become lines and nodules stay dots.
- If no model works acceptably: document the failures and ship the product without AI detection. M1–M3 still deliver
  the minutes.

### M5 — Evidence & delivery (Thu, finish by 15:00, buffer until 18:00)
- **Accuracy:** for each tumour with an expert segmentation on the same series: Dice (semi-auto vs expert), long-axis
  difference (mm), volume difference (%). For AI candidates: detected yes/no per expert tumour (rule: candidate
  centre inside the mask or within X mm), false positives per scan. State N; with ~31 subjects say "pilot evidence".
- **Repeatability:** test vs retest scan of the same patient: |Δ long axis| and |Δ volume|% for our tool vs expert
  segmentations.
- **Time saved — the protocol (write it down before measuring):**
  1. Baseline times = Daniel's self-reported step times (cite them as self-reported).
  2. Tool times = measured by in-app instrumentation (timestamps per action: open → first finding → approve →
     export), on N ≥ 3 RIDER cases, operated by me as a proxy user (state that). Ask Daniel to try the same flow
     and report his times / corrections (via Slack, with screenshots: the client can't open external links).
  3. Report per step: before, after, saving, and which numbers are measured vs estimated. Include correction time.
  4. Translate to the lab's reality: e.g. "~X min saved per baseline scan, ~Y per follow-up, at Z scans/week".
- `docs/EVALUATION.md` with tables, method, N, failures, screenshots. `PROGRESS.md` kept current.
- README: live URL, how to run, how to load the sample, privacy statement (verified), limitations, data attribution.
- A **backup demo**: screen recording of the full flow in case live inference or the network fails.

## 6. UX requirements

- Three areas: **left** worklist (patients → scans → findings, with status: unreviewed / approved / edited /
  uncertain match / incomplete), **centre** viewer, **right** "Copilot" panel for the selected finding
  (measurements + provenance, baseline vs now, notes, Approve / Edit / Reject / Next).
- **Review queue:** one finding at a time, keyboard first (A = approve, E = edit, R = reject, N = next). No swipe
  gestures for medical editing.
- Value visible in 30 seconds: open the sample → click a tumour → numbers appear → Approve → row appears → Export.
- Dark, calm, clinical look; large viewport; no clutter. "Research use only — not for diagnosis" always visible.
- Daniel should never need to leave the app or re-type a value the system already knows.

## 7. Non-negotiables

1. **No fake AI.** No hard-coded coordinates, no expert masks shown as AI, no invented confidence, no LLM "reading"
   images. Precomputed ≠ live: label it.
2. **No invented numbers.** Measured vs estimated is always explicit.
3. **Researcher control.** Everything the system proposes can be edited, rejected or added to.
4. **Provenance + data separation.** CT, expert annotations, AI outputs, researcher edits and approved values are
   stored separately; ground truth is never overwritten.
5. **Privacy.** Local scans never leave the browser; no DICOM, secrets, model weights or caches in git.
6. **No regressions.** The working viewer is protected; run `npm run check` and a browser test before every commit.
7. **Graceful failure.** Unsupported data, failed loads and failed inference produce a clear message.

## 8. Client communication (I send the messages; you draft when useful)

- Naomi: busy, short, outcome-focused, never re-ask answered questions. She is waiting for a short prototype plan.
- Daniel: concrete questions only. Useful now: exact column headers/units/date format of his sheet; his preferred
  nodule-ID and timepoint naming; which RIDER case he uses as a reference.
- Post a short status in `#base44-internal` at each milestone.

## 9. Presentation pack (Thu)

Prepare `docs/DEMO_SCRIPT.md`: a 5-minute flow (problem in Daniel's words → live: open sample → AI candidate /
click → measure → correct an edge → approve → follow-up pair → change → CSV opens in Excel → time-saved table →
what fails and why → what's next for a hospital deployment: on-prem inference, validation on their data, IT-free
rollout as a static page).

## 10. Start now

1. Confirm shell, browser and repo access; run `npm run check`; open the app and load RIDER-1129164940.
2. Inspect `~/Downloads/rider_lung_ct/` and RIDER-LungCT-Seg: report which patients have both timepoints and an
   expert segmentation that references a series we have.
3. Give me a one-screen plan with risks for M0–M5. Then start M0 without waiting, except for the GitHub step.
