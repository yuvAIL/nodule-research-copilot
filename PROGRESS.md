# Progress — Nodule Research Copilot

Deadline: **Thu 22 Oct 2026, 18:00 (IL)**. Full brief: `docs/MISSION.md`.

## Status (Mon 19 Oct, evening)

**BUILT**
- Milestone 1 viewer: local DICOM CT loading, series grouping/sorting, lung/mediastinum/bone presets, scroll/zoom/pan/WL, metadata panels.
- Dev-server black-viewport bug fixed (duplicate `@cornerstonejs/metadata` registry in Vite pre-bundle; see `vite.config.ts`).
- M0 (code): session restore after reload (IndexedDB + File System Access folder handle → one-click "Reopen" at the same series/slice), "Load sample CT" (manifest-based, public data, never in git), `npm run prepare:sample`.

**VERIFIED**
- Real RIDER-1129164940 series (262 × 512², 1.25 mm) renders in Chrome; slices 1→115 navigated (by Yuval).
- Strict `tsc` + ESLint pass against the real installed Cornerstone 5.13.1 types (run on the Mac).
- In the running dev server: one metadata module instance; new M0 modules compile and the UI renders.

**NOT YET VERIFIED**
- Reload → Reopen flow end-to-end (needs a manual folder pick).
- Load sample CT (needs `npm run prepare:sample` with a RIDER pair).
- `npm run test` and `vite build` after the M0 changes.

**BLOCKED / NEEDS YUVAL**
- GitHub: approved as private; commands in the handoff message (no GitHub sign-in in this session).
- RIDER folder access for data inspection (CT pairs + RIDER-LungCT-Seg references).

## Plan

| Milestone | When | Acceptance | Main risk → fallback |
|---|---|---|---|
| M0 Foundation | Mon | Reload keeps the scan; sample loads in one click; private repo; deployed URL | Hosting 2×~130 MB sample → static host with per-file limits OK; else IDC DICOMweb |
| M1 Measure & edit | Tue | Click → 3D mask → long/short axis + volume in mm; brush corrections; phantom tests pass | Volume viewport migration regresses viewer → keep stack path behind a flag |
| M2 Documentation | Tue night | Row auto-filled; CSV export in Daniel's columns; CSV import; PNG snapshot | Lobe not derivable → dropdown |
| M3 Follow-up | Wed | Test/retest pair side by side; confirmed match → Δ computed → follow-up row | Patient-coordinate jump inaccurate → manual navigate + label "manual match" |
| M4 AI candidates (≤4 h) | Wed | Real model output on RIDER as labeled candidates, or documented failure | No suitable model / too slow on Mac → ship without; report honestly |
| M5 Evidence & delivery | Thu | EVALUATION.md (accuracy, repeatability, time protocol), README, demo script, backup video | Too little time → cut M4 polish first, never M1–M3 |
