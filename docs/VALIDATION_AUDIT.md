# Validation audit — which claims are backed by evidence

*Nodule Research Copilot · audit run 20 Oct 2026 · source of truth for the walkthrough and the evidence register*

Every earlier performance claim was treated as unverified until its code, data and output were found and the
numbers were **re-computed from scratch**. Classification:

- **VERIFIED** — re-run today from raw data with the committed scripts; the result matches.
- **PARTIALLY VERIFIED** — real evidence exists, but it is indirect, small, or the method is incomplete.
- **UNVERIFIED** — claimed, estimated, self-reported, or not yet measured.

## 1. Evidence inventory

| # | Claim (where it appeared) | Status | Evidence | Notes |
|---|---|---|---|---|
| 1 | AI found the expert-outlined tumour on **53/59** RIDER scans (EVALUATION §3, README, demo) | **VERIFIED** | `scripts/evaluate-ai.cjs` re-run with an empty cache → `docs/eval/ai-results.csv`: all 59 rows identical | Hit = ≥ 1 voxel overlap. Stricter: Dice ≥ 0.1 → 51/59, Dice ≥ 0.5 → 43/59. Per patient 29/31 (27/31 on every scan). |
| 2 | AI outline Dice **0.76** median [0.59–0.86], long-axis error 5.5 mm, volume error 26 % | **VERIFIED** | same run, `docs/eval/ai-summary.json` | Over the 53 hits only. Nodules ≤ 30 mm: Dice 0.68; masses: 0.81. |
| 3 | Click segmentation Dice 0.58 [0.30–0.77], 1 click in 3 fails, leaks 16/59 (EVALUATION §2) | **VERIFIED** | `scripts/evaluate.cjs` re-run into an empty folder: 295 click rows identical (timing columns excluded) | IQR uses the script's nearest-rank quantile (another method gives Q1 0.27). |
| 4 | Repeatability: volume difference TEST vs RETEST 9.5 % (click) vs 17.1 % (expert), 28 pairs | **VERIFIED** | recomputed from `docs/eval/results.csv` | Consistency, not accuracy. |
| 5 | "5 readers 0.72–0.87, QIN algorithms 0.81–0.88" on one scan (EVALUATION §3, demo script) | **WAS WRONG → CORRECTED** | `scripts/compare-readers.cjs` → `docs/eval/readers-vs-expert.json` | Re-run gives readers **0.77–0.90** (TEST) / 0.85–0.89 (RETEST), algorithms **0.80–0.95**. The readers used a **semi-automatic** tool (QIBA CT 1B, Random Walker) — not manual radiologist outlines. One patient only: context, never "equivalent to radiologists". Docs corrected. |
| 6 | AI predictions are real model output, no ground-truth leakage | **VERIFIED** | Headers of all 59 AI files: `TotalSegmentator 2.18.0`, segments `lung`, `lung_nodules`, each references its own CT series. TotalSegmentator is called with the CT folder only (`-i <CT>`). `src/ai/candidates.ts` imports only a *type* from the reference module; expert files are read only by the scoring scripts and the optional overlay. | The model runs on the whole CT without seeds — it **locates** the lesion autonomously; nothing tells it where to look. |
| 7 | Public demo uses genuine model output | **VERIFIED** | `dist/sample/.../ai-1..4.dcm`: TotalSegmentator 2.18.0 SEGs created 20 Oct 2026 (2 nodule + 2 lobe files) referencing the two sample CT series; expert file is RIDER-LungCT-Seg (QIICR, 2019) | The demo labels them "AI (TotalSegmentator 2.18.0 lung_nodules)". |
| 8 | AI takes "~2 min per scan" on a MacBook (EVALUATION §3) | **VERIFIED (LIDC) / PARTIAL (RIDER)** — LIDC wall clock: median 97 s (69–129 s), 15 scans, M3 Pro | File timestamps of the 59 RIDER AI files written by one sequential loop: 12:17 → 13:51 UTC, median 100 s between files (p10 78 s, p90 121 s, max 154 s) | No explicit timing log for RIDER. The LIDC run records wall-clock time per scan explicitly (`data/lidc/inference-times.json`, see CHALLENGING_NODULE_EVALUATION.md). |
| 9 | Follow-up pairing ("every nodule paired with its earlier self", ▼% change) | **PARTIALLY VERIFIED** | Unit tests `src/findings/priors.test.ts` (one-to-one, closest first, earlier dates only, ≤ 50 mm); shown on the sample pair in the app | Tested on **one** patient pair only; no pairing accuracy measured on a cohort. The sample's two scans use different reconstruction kernels (STANDARD vs LUNG), which alone changes measured volume — the displayed change is not a biological growth claim. |
| 10 | Type (solid / ground-glass…) and lobe suggestions | **UNVERIFIED** | Rule of thumb on HU (`src/measure/density.ts`); lobe from the AI lobe map | Never compared with a reference; shown as suggestions, one click to change. |
| 11 | Time saved | **UNVERIFIED (not measured yet)** | No measured before/after. "Before" = Daniel's self-reported times. | See TIME_SAVINGS_EVALUATION.md: what is measured (app processing, instrumentation) and what is still estimated. The 50 % target is a goal, not a result. |
| 12 | Scans never leave the browser (CSP blocks other hosts) | **VERIFIED (20 Oct, earlier session)** | README "Data & privacy": blocked test `fetch`, network log of the live site | Re-check before the demo (P4 checklist). |
| 13 | Small and ground-glass nodule performance | **VERIFIED (new test)** | LIDC-IDRI, 15 scans, 35 reader-confirmed nodules: solid 26/27, part-solid 1/3, **ground-glass 0/5**; all found outlines too small | CHALLENGING_NODULE_EVALUATION.md. A scorer bug (orientation flipped on 5 scans) was found and fixed before reporting. |
| 15 | Corrections re-measure the finding and are tracked | **VERIFIED (demo)** | Real app, sample follow-up N1: scripted brush strokes on 5 slices → volume 43.76 → 46.51 mL (expert 54.99), long axis 55.4 → 62.8 mm (expert 59.8), Dice 0.87 → 0.88, finding marked "edited by researcher" | Mechanism only: strokes were made by a script, so this says nothing about correction time or quality. |
| 14 | Daniel's feedback | **Simulated stakeholder statement** | Slack messages from the simulated research fellow | Not a usability observation; nobody but the developer has operated the tool. |

## 2. How the 53/59 was computed (evaluation unit and matching)

- **Unit:** one CT scan with one expert-labelled primary tumour (RIDER-LungCT-Seg `SegmentAlgorithmType = MANUAL`).
  59 scans, 31 patients, 28 of them with a same-day TEST/RETEST pair.
- **AI:** TotalSegmentator 2.18.0 `lung_nodules`, whole CT in, DICOM SEG out. The app splits the mask into
  26-connected candidates ≥ 5 mm³ (`src/ai/candidates.ts`), exactly as in the product.
- **Match:** a scan is a hit when any candidate shares ≥ 1 voxel with the expert outline (on the CT voxel grid, patient
  coordinates). Dice and axis errors are for the candidate that overlaps most. Rules are in the script header, fixed
  before the first result.
- **False positives:** not measurable on RIDER (only one lesion is labelled per scan). 344 candidates across the 59 scans
  did not touch the labelled tumour; they are reported as *unconfirmed* (median 3 per scan, 0 on 8 scans, up to 30).

## 3. What changed because of this audit

1. Reader/algorithm ranges corrected in `docs/EVALUATION.md` and `docs/DEMO_SCRIPT.md`, with the semi-automatic
   caveat; new reproducible script `npm run eval:readers`.
2. Stricter hit thresholds added next to the lenient headline.
3. Data-quality caveat on the follow-up example (different kernels).
4. Timing instrumentation extended (corrections, correction time, pauses, per-finding work, exports) — see
   TIME_SAVINGS_EVALUATION.md.
5. The challenging-nodule test moved to LIDC-IDRI, which has reader-rated nodule texture.

## 4. Reproduce

```bash
npm run eval:ai -- ~/Downloads/rider-seg-all ~/Downloads/ai-results/rider --out docs/eval    # 53/59, Dice
npm run eval -- ~/Downloads/rider-seg-all --out docs/eval                                    # click segmentation, repeatability
npm run eval:readers -- ~/Downloads/rider-1129164940-all --out docs/eval                     # readers / algorithms context
```

Data: RIDER Lung CT + RIDER-LungCT-Seg (TCIA, CC BY), downloaded with `idc-index` from the NCI Imaging Data Commons.
