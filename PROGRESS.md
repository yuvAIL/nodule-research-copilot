# Progress — Nodule Research Copilot

Deadline: **Thu 22 Oct 2026, 18:00 (IL)**. Full brief: `docs/MISSION.md`.

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
