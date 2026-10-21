# Evaluation — what works, what fails, how it was measured

*Nodule Research Copilot · research prototype, not a medical device · generated 20 Oct 2026*

Every number below says how it was obtained: **measured** (computed by a script you can re-run), **self-reported**
(Daniel's own estimate), or **pending** (not measured yet — no number is shown).

## 1. Data

| | |
|---|---|
| Source | Public, de-identified TCIA data: **RIDER Lung CT** scans + **RIDER-LungCT-Seg** expert tumour outlines (CC BY) |
| Size | **31 patients, 59 CT scans** (TEST and RETEST scan of the same day, ~15 min apart) |
| Truth | The outline the RIDER-LungCT-Seg SEG file labels **MANUAL** (`SegmentAlgorithmType`) |
| Lesion size | Expert long axis 12.9–93.1 mm; **18 scans ≤ 30 mm** ("nodules"), **41 scans > 30 mm** ("masses") |
| Bias to know | The cohort is NSCLC tumours, mostly large. Small and ground-glass nodules — Daniel's biggest worry — are under-represented. |

## 2. Click-to-measure accuracy (measured)

**Method** (`npm run eval`, `scripts/evaluate.cjs`, fixed before looking at results): the app's own segmentation code
runs headless on each scan. Simulated researcher clicks = the centre of the expert outline + 4 random points inside
it. Default settings only, no per-case tuning. Patients were split by ID: every 3rd is *development*, the rest
*held-out*. **No algorithm change was made after the split** — so both groups are reported, and the overall number is
the honest headline.

| Centre click vs expert (median) | All 59 scans | Held-out (39 scans, 20 pts) | Development (20 scans, 11 pts) |
|---|---|---|---|
| Dice (1 = identical outline) | **0.58** [IQR 0.30–0.77] | 0.64 [0.47–0.81] | 0.32 [0.23–0.63] |
| Dice ≥ 0.7 | 20 / 59 | 16 / 39 | 4 / 20 |
| Failed outline (Dice < 0.2) | 12 / 59 | — | — |
| Leaked into neighbours | 16 / 59 | 11 / 39 | 5 / 20 |
| \|long-axis error\| | 10.5 mm | 10.2 mm | 15.1 mm |
| \|volume error\| | 55 % | 49 % | 83 % |

| By size (all scans) | Nodules ≤ 30 mm (18) | Masses > 30 mm (41) |
|---|---|---|
| Dice, centre click | 0.52 [0.17–0.80] | 0.60 [0.33–0.72] |
| \|long-axis error\| | 6.7 mm | 16.1 mm |
| Any of 5 clicks fails (Dice < 0.2) | 34 / 90 clicks | 69 / 205 clicks |

**Reading it honestly**
- Click segmentation is **inconsistent**: good on well-separated solid lesions (Dice 0.8–0.97), poor when the
  lesion touches the chest wall or mediastinum (leaks, or a "safe" fragment). About **one click in three fails**.
- The development/held-out gap (0.32 vs 0.64) on so few patients means the split matters more than any tuning. Do
  not quote 0.64 alone.
- **Product consequence:** the click is the *fallback*, not the main path. The researcher must see and correct the
  outline before approving — which the app enforces (nothing is exported unapproved, edits are tracked).

## 3. AI candidates (measured — the headline)

Model: **TotalSegmentator 2.18.0, task `lung_nodules`** (Apache-2.0), run offline on a MacBook (Apple Silicon,
`--device mps`, ~2 min per scan), output as DICOM SEG and turned into candidates by the app's own code
(`npm run eval:ai`, `scripts/evaluate-ai.cjs`). Definitions fixed before the run: **hit** = at least one candidate
overlaps the expert MANUAL outline; Dice/axes are for the candidate that overlaps most; other candidates are
**unconfirmed** (the dataset labels one primary tumour per patient, so they may be false positives *or* real,
unlabelled nodules).

| AI vs expert, all 59 scans / 31 patients | All | Nodules ≤ 30 mm (18) | Masses > 30 mm (41) |
|---|---|---|---|
| **Tumour found (hit)** | **53 / 59 (90 %)** | 15 / 18 | 38 / 41 |
| Patients with the tumour found on ≥ 1 of 2 scans | 29 / 31 | | |
| Dice of the hit (median [IQR]) | **0.76** [0.59–0.86] | 0.68 | 0.81 |
| Dice ≥ 0.7 | 31 / 59 | 7 / 18 | 24 / 41 |
| \|long-axis error\| (median) | **5.5 mm** | 3.4 mm | 6.6 mm |
| \|volume error\| (median) | 26 % | 39 % | 20 % |
| Candidates per scan (median; 90th pct; max) | 4; 23; 30 | 5.5 | 3 |

Split check (same split as §2): development 19/20 hits, Dice 0.62; held-out 34/39 hits, Dice 0.77.

**AI vs our click segmentation on the same 59 scans:** Dice 0.76 vs 0.58, long-axis error 5.5 vs 10.5 mm, volume error
26 % vs 55 %. → The AI is the main path; the click is for what the AI misses.

**Where the AI fails**
- **Misses (6 scans, 4 patients):** RIDER-1286684383 TEST, RIDER-1760553574 TEST+RETEST, RIDER-1801720707 RETEST,
  RIDER-2073083717 TEST+RETEST. In the app these are "added by researcher" (press S, click) — counted as the miss rate.
- **Noisy scans:** a few scans produce 15–30 candidates (90th percentile 23). Most are small and unconfirmed; review takes
  longer there (each is one keypress to reject). A minimum-size filter is a researcher decision we have not made for them.
- Context on the one patient with several independent outlines (RIDER-1129164940; `npm run eval:readers`,
  `docs/eval/readers-vs-expert.json`), Dice vs the same MANUAL outline: 5 QIBA readers using a semi-automatic tool
  0.77–0.90 (TEST) and 0.85–0.89 (RETEST); 3 QIN challenge algorithms (9 runs, TEST) 0.80–0.95; TotalSegmentator 0.87 /
  0.85; our centre click 0.61 / 0.63. One patient — context, not a comparison with radiologists.
  *(Corrected 20 Oct 2026: an earlier version said "readers 0.72–0.87, algorithms 0.81–0.88"; a re-run did not
  reproduce that.)*
- Stricter hit rules on the same 59 scans: Dice ≥ 0.1 → 51/59, Dice ≥ 0.5 → 43/59. Re-run from an empty cache on
  20 Oct 2026: all 59 rows identical.

## 4. Repeatability — same patient, two scans 15 minutes apart (measured)

Tumours cannot change in 15 minutes, so any difference is measurement noise.

| Median difference TEST vs RETEST (28 patients) | Click segmentation | Expert manual outline |
|---|---|---|
| Volume | **9.5 %** | 17.1 % |
| Long axis | 1.7 mm | 2.3 mm |

Consistency is not accuracy: the click method can be consistently wrong (e.g. the same under-segmentation twice). Still,
a growth call below ~10–17 % volume change is within noise — for the expert too.

## 5. Time saved

**Before = self-reported by Daniel** (discovery call). **After = pending**: measured by the app's own timestamps
(first finding → last action, shown as "m:ss on this scan" in the worklist) over ≥ 3 runs by Yuval on the sample, as a
proxy until Daniel runs it.

| Step (per scan, 1–3 nodules) | Before (self-reported) | With the tool | Status |
|---|---|---|---|
| Load series, lung window | 1–2 min | seconds (auto lung window, reopens after reload) | observed, not timed |
| Find nodules (2 passes, 250–400 slices) | 10–20 min | review AI candidates + one confirming pass | **pending** |
| Long/short axis | 2–4 min / nodule | automatic on click / AI outline | **pending** |
| Full outline for volume | 15–25 min / nodule (done for ~1 in 5) | automatic; brush to correct | **pending** |
| Screenshot + re-typing into the sheet | 3–5 min | 0 (CSV in the sheet's columns + PNG) | **pending** |
| Follow-up re-find + compare | ~10 min | side-by-side, Δ mm / Δ % computed | **pending** |

Instrumentation: every finding has a timeline (`created`, `edited`, `approved`, `rejected`, …) with timestamps; the CSV's
*Minutes* column is creation → approval from these timestamps. Correction time is included because edits happen
between creation and approval.

## 6. Reproduce

```bash
# expert data (31 patients) via the NCI Imaging Data Commons
#   see README → "Evaluation data"
npm run eval -- ~/Downloads/rider-seg-all --out docs/eval      # → docs/eval/results.csv, summary.json
# AI on all scans (background, ~2 min per scan on Apple Silicon), then score it
for d in $(find ~/Downloads/rider-seg-all -type d -name "CT_*"); do
  TotalSegmentator -i $d -o ~/Downloads/ai-results/rider/$(basename $d).dcm -ta lung_nodules --output_type dicom_seg --device mps
done
npm run eval:ai -- ~/Downloads/rider-seg-all ~/Downloads/ai-results/rider --out docs/eval   # → ai-results.csv, ai-summary.json
```

## 7. Known failure modes (seen in the data)

1. **Leak** — the outline grows into the chest wall/mediastinum when the lesion touches it (16 / 59 scans).
2. **Fragment** — a strong "anti-leak" cut keeps only a small part of a large lesion (8 / 59 below 10 % of expert volume).
3. **Click sensitivity** — different clicks on the same lesion give different outlines (median Dice spread 0.18–0.25).
4. **Labels in public data are inconsistent** — the RTSTRUCT and SEG versions of RIDER-LungCT-Seg name the manual and
   automatic outlines differently for the same patient; we use the coded SEG field.
5. **Privacy note for real lab data** — TotalSegmentator reports anonymous usage statistics by default; disable this
   before running it on non-public scans (see its documentation). The browser app itself sends nothing anywhere.
