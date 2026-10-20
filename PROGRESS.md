# Progress — Nodule Research Copilot

Deadline (own target): **Wed 21 Oct 2026, 18:00 (IL)**. Full brief: `docs/MISSION.md`.
Live: **https://nodule-research-copilot.pages.dev** (Cloudflare Pages, static).

## AI worklist + evaluation — Tue 20 Oct, 15:10 ✅ (deploy pending)

**BUILT** — AI candidates: TotalSegmentator 2.18.0 `lung_nodules` (offline, Mac MPS, ~2 min/scan) → DICOM SEG →
app splits it into connected pieces → findings with source "AI" (model/version/run date shown), position estimate
from the AI lung mask. Worklist: "AI found N · M reviewed · m:ss on this scan", A/R auto-advance, J/K, "?" sheet.
SEG/RTSTRUCT files in an opened folder are offered as AI result or expert outline. Sample = 2006-09-20 TEST scan +
AI result + expert outline (auto-loaded). Design system v2 (dark clinical, colour + symbol). `npm run eval`
(resumable) + docs/EVALUATION.md.
**VERIFIED** — 54 unit tests in the harness; tsc + ESLint on the Mac; in the browser (dev server): sample → AI found 2
→ A accepts N1 and jumps to N2 → R rejects N2 → CSV has 1 row "AI (TotalSegmentator 2.18.0 lung_nodules)";
expert comparison N1 Dice 0.87. Evaluation on 31 patients / 59 scans (numbers in docs/EVALUATION.md).
**FOUND & FIXED** — overlapping expert segments overwrote each other (manual 55 mL showed as 1.8 mL).
**PENDING** — AI on all 59 scans; Yuval's 3 timed runs; Daniel review pack; deploy.

## Assumptions (made without asking — revisit if wrong)
- Host = Cloudflare Pages (free, static, custom headers via `public/_headers`, per-file limit fits DICOM slices).
- The public sample (RIDER-1129164940, CC BY) may be served from the live site; it is not in git.
- Licence wording: CC BY 4.0 as stated in the IDC download metadata (older TCIA wiki pages say CC BY 3.0).
- Evaluation truth = the SEG segment coded MANUAL; RTSTRUCT names disagree for some patients (documented).
- AI candidates smaller than 5 mm³ are counted but not listed (noise); the threshold is shown in the UI message.

## Deploy — Tue 20 Oct, 14:00 ✅

**BUILT** — Production deploy on Cloudflare Pages (wrangler, direct upload of `dist/`, 275 files incl. sample).
Content-Security-Policy in two places: `public/_headers` (HTTP header, + frame-ancestors) and a build-time
`<meta>` tag (`vite.config.ts`), so the restriction survives any static host. "Data & privacy" panel in the app
with TCIA attribution + DOIs. README rewritten (live URL, verified privacy statement, attribution, run/deploy).
**VERIFIED** (Claude, built-in browser, live URL)
- `npm run check` on the Mac: 43/43 tests, lint, typecheck, build green (Yuval's terminal).
- CSP header and meta tag both present; Cornerstone workers + WASM decode fine under CSP (no CSP errors).
- Deliberate `fetch('https://example.com', POST)` → blocked by `connect-src`.
- Load sample → 262 slices; Click nodule on slice 80 (right posterior mass) → N1 52.7 × 26.0 mm, 23 244 mm³,
  40 slices, axes on slice 84; erase stroke → 22 440 mm³; ⌘Z → 23 244; A → approved; Export CSV →
  `RIDER-1129164940_Baseline_2026-10-20.csv`, bytes EF BB BF, CRLF, 1 row with provenance (semi-auto, slice 84).
- Network log: only same-origin GETs (app files + `/sample/…`). 41 DICOM files opened via **Open files…** →
  **0** network requests afterwards.
**NOTE** — Same tumour, different seed slice → 23.2 mL here vs 31.5 mL on 19 Oct: the click result depends on
where you click. To quantify in M5 (seed-to-seed variability), not hide.

## M2 — Documentation that writes itself (Mon 19 Oct, 21:45) ✅

**BUILT** — Research record panel (Patient ID, date, series read from DICOM; timepoint selector saved per series);
CSV export in Daniel's 13 columns + provenance/follow-up columns (UTF-8 BOM, CRLF, RFC 4180 quoting → opens in Excel);
missing Type/Lobe highlighted; JPEG snapshot of the measured slice saved with the finding at approval; full-resolution
PNG screenshot per finding named Patient_Timepoint_Nodule.png; minutes per nodule from app timestamps.
**VERIFIED** — record unit tests (column order, quoting round-trip, minutes); in the app: Patient ID/date/series filled,
Type/Lobe/Notes saved, snapshot captured on approval (21 KB), exported CSV content checked (BOM bytes EF BB BF present).

## M3 — Follow-up comparison (Mon 19 Oct, 22:00) ✅ (spreadsheet path) / ⏳ (two-scan path)

**BUILT** — Earlier measurements per patient from (a) scans measured in this app (approved findings saved per series with
thumbnail + patient-coordinate centre) and (b) CSV import of the lab sheet (loose header matching). Finding card shows
earlier vs now images, long/short/volume with Δ mm and Δ %, earlier notes; "Same nodule — Confident / Uncertain";
confirmed match adopts the earlier Nodule ID; closest-position suggestion (labelled as a hint, not registration);
"go to earlier position (approx.)"; CSV gets Match status + prior/Δ columns. Saves flush when the tab is hidden/closed.
**VERIFIED** — priors unit tests; in the app with a hand-written TEST sheet row: import → Δ +6.5 mm (+12.6 %) / +14.5 %
volume shown; Confident → finding renamed N1, CSV has Match status + prior + Δ columns. Test data deleted afterwards.
**BLOCKED** — two-scan follow-up needs the second same-day RIDER series (requested from Yuval).

## M1 — Measure & edit (Mon 19 Oct, 21:15) ✅

**BUILT**
- Click segmentation (`src/measure/segment.ts`, classical, not AI): threshold (−400 HU default, adjustable per finding),
  per-slice lung-region constraint (convex hull of lungs → excludes chest wall), adaptive morphological opening
  (0–6 voxels, first setting that does not leak), slice-wise hole filling, 60 mm search radius, leak warning.
- Measurements (`src/measure/measure.ts`): RECIST-style long axis on the slice where largest, perpendicular short axis,
  volume = voxels × voxel volume; edge-to-edge convention documented in code.
- Findings store: shared labelmap, provenance (click / manual / edited), status (to review / approved / rejected),
  per-stroke undo, reset, re-segment with new threshold, timeline timestamps (for M5 time analysis),
  saved per series in IndexedDB (outline RLE + findings) and restored on reopen.
- UI: Measure toolbar (Click nodule S, Brush B, Erase E, brush size, 3D sphere brush), outlines + axes + mm labels drawn
  over the CT following zoom/pan, right "Findings" panel with metrics, provenance, Approve (A) / Reject (R) / Undo (⌘Z) /
  Reset, threshold slider, Type / Lobe / Notes; N = next unreviewed finding.

**VERIFIED**
- Unit tests (phantoms): ellipse 20×12 mm and rotated anisotropic ellipse within 1 px; sphere volume within 0.3 %;
  vessel cut; cavity filled; chest-wall-touching tumour stays out of the wall; store click/edit/undo/re-segment/manual.
  (Run here with a Node test shim; `npm run check` on the Mac still to run.)
- Real `tsc` + ESLint on the Mac: pass.
- In the app on RIDER-1129164940 (Claude, desktop-app browser): click on the right posterior mass → N1 outlined & measured
  in < 1 s; 3D data prepared in ~1 s after load; erase stroke → volume 31 495 → 31 170 mm³, provenance "edited by researcher";
  ⌘Z → back to 31 495; A → Approved; reload → finding restored.

**KNOWN LIMITATION (honest)**
- On this tumour the click outline (58.5 × 36.6 mm, 31.5 mL) extends along hilar structures on some slices. The lung
  constraint removed the chest wall (89 mL → 36 mL) and opening removed the rest of the leak warning, but the hilar strip
  still needs manual erasing. Quantify against RIDER-LungCT-Seg expert outlines in M5 before claiming accuracy.

## Status (Mon 19 Oct, evening)

**BUILT**
- Milestone 1 viewer: local DICOM CT loading, series grouping/sorting, lung/mediastinum/bone presets, scroll/zoom/pan/WL, metadata panels.
- Dev-server black-viewport bug fixed (duplicate `@cornerstonejs/metadata` registry in Vite pre-bundle; see `vite.config.ts`).
- M0 (code): session restore after reload (IndexedDB + File System Access folder handle → one-click "Reopen" at the same series/slice), "Load sample CT" (manifest-based, public data, never in git), `npm run prepare:sample`.

**VERIFIED** (Mon 19 Oct, 20:31)
- `npm run check` on the Mac: typecheck, lint, 18/18 tests, production build — all green.
- Private repo `yuvAIL/nodule-research-copilot` created and pushed (commit 73f3847 fixed `.gitignore` that had excluded `src/dicom/`).
- Real RIDER-1129164940 (262 × 512², 1.25 mm) renders; local folder → Cmd+R → "Reopen" restores the scan (Yuval, Chrome).
- "Load sample CT" (served from gitignored `public/sample/`): loads 262 slices, opens in lung window; keyboard scroll to slice 115;
  Mediastinum and Lung presets apply; reload → "Reopen" returns to slice 115 (Claude, desktop-app browser).
- `public/sample/` is ignored by git (checked with `git check-ignore`).

**DATA ON DISK** (`~/Downloads/manifest-1792427509271`, downloaded from IDC)
- Only ONE series: RIDER-1129164940, 2006-09-05, series 100 (one timepoint).
- Missing for M3/M5: the same-day **second scan** of this patient, and **RIDER-LungCT-Seg** (expert SEG/RTSTRUCT).

**BLOCKED / NEEDS YUVAL**
- Download the second timepoint + matching RIDER-LungCT-Seg objects (instructions in chat).

## Plan

| Milestone | When | Acceptance | Main risk → fallback |
|---|---|---|---|
| M0 Foundation | Mon | Reload keeps the scan; sample loads in one click; private repo; deployed URL | Hosting 2×~130 MB sample → static host with per-file limits OK; else IDC DICOMweb |
| M1 Measure & edit | Tue | Click → 3D mask → long/short axis + volume in mm; brush corrections; phantom tests pass | Volume viewport migration regresses viewer → keep stack path behind a flag |
| M2 Documentation | Tue night | Row auto-filled; CSV export in Daniel's columns; CSV import; PNG snapshot | Lobe not derivable → dropdown |
| M3 Follow-up | Wed | Test/retest pair side by side; confirmed match → Δ computed → follow-up row | Patient-coordinate jump inaccurate → manual navigate + label "manual match" |
| M4 AI candidates (≤4 h) | Wed | Real model output on RIDER as labeled candidates, or documented failure | No suitable model / too slow on Mac → ship without; report honestly |
| M5 Evidence & delivery | Thu | EVALUATION.md (accuracy, repeatability, time protocol), README, demo script, backup video | Too little time → cut M4 polish first, never M1–M3 |
