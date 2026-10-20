# Demo script — 5 minutes

*Live site: https://nodule-research-copilot.pages.dev · Chrome · open it once before the call so the sample is cached.*
*Backup: screen recording of the same flow (docs/demo.mp4, made Wed morning).*

## Before the call (2 min)
- Open the site, **Load sample CT**, let it finish (AI loads on both scans). Open **Session summary → Start a new timed run** twice so the worklist is fresh.
- Window full screen, browser zoom 100 %, notifications off.

## 0:00 — The problem, in Daniel's words (no clicks)
> "Daniel spends 25–40 minutes per baseline scan: two passes over 300 slices to find nodules, a ruler for the axes,
> 15–25 minutes to outline one nodule for volume — so he only does it for 1 in 5 — then he re-types everything into
> the sheet. Last year's vendor failed because it was expensive, needed IT, couldn't fill the sheet, and only allowed
> accept/reject."

## 0:30 — Open a scan: the AI has already done the first pass
- Point at the worklist: **"AI found 3"**, each outlined in 3-D and measured. Patient timeline at the top: Baseline + Follow-up.
- Say: *"Runs on the lab's own computer; the scan never leaves it — the browser blocks every connection to other sites."*

## 1:00 — Daniel decides, not the AI
- **A** on N1 (the tumour) → accepted, Type and Lobe filled from suggestions, jumps to the next.
- **R** on a small candidate → rejected (toast with **Undo**).
- Show one correction: **E** + drag on an edge → volume updates, provenance says *"edited by researcher"*. **⌘Z**.
- **T**: thick-slab MIP — *"this is how he checks nothing was missed without reading every slice."* **T T** to switch off.

## 2:15 — Follow-up in one key
- **.** → the 2006-09-20 scan opens as *Follow-up 1*, AI candidates already there.
- Card: *"Same nodule as N1 (Baseline)?"* → **M** → worklist shows **▼ 45 % vs Baseline**.
- Say: *"Remember the test–retest result: even two scans 15 minutes apart differ by 10–17 % in volume, so a 45 % drop
  is real, a 10 % change is not."*

## 3:00 — The sheet fills itself
- **Export CSV** → open in Excel: Daniel's 13 columns + where every number came from (AI model and version, edited or not,
  measured slice, approval time).
- **Session summary**: AI candidates / accepted / rejected / added by researcher / time on this scan.

## 3:30 — Is it good enough? (EVALUATION.md, one slide)
| On 31 patients / 59 scans vs expert outlines (RIDER-LungCT-Seg) | |
|---|---|
| AI found the tumour | **53 / 59 (90 %)** |
| AI outline vs expert (Dice) | **0.76** (5 human readers on one scan: 0.72–0.87) |
| Long-axis error | 5.5 mm (AI) vs 10.5 mm (our one-click fallback) |
| Where it fails | 6 misses in 4 patients; a few scans with 15–30 small unconfirmed candidates |
- Say: *"That's why every candidate is reviewed and missed ones are one click away (S)."*

## 4:15 — Time saved (the table from EVALUATION.md §5)
- Before = Daniel's self-reported times. After = measured in the app (Yuval, n = 3, proxy — Daniel's own runs are the
  first pilot step).

## 4:45 — Next step (ask)
> "Pilot: Daniel runs the practice set with it for a week; we compare his minutes and his corrections. Next build: the
> AI inside the browser so there's no command to run."

## If something breaks live
- Slow first load → it's 250 MB of public CT; switch to the recording.
- AI result not shown → **Worklist → Load AI result…** is the manual path (files in the sample folder).
