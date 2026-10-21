# Challenging-nodule evaluation: small solid and ground-glass nodules

*Nodule Research Copilot · 20 Oct 2026 · research prototype, not a medical device*

**Status in one line:** tested on two public datasets with radiologist outlines. **Solid nodules are usually found
(LIDC 26 of 27, including 15 of 16 at ≤ 10 mm) but always outlined too small. Ground-glass nodules were not found at
all (0 of 5), and part-solid 1 of 3.** Every failure is listed below; no case was removed.

## 1. Why a separate test

Daniel named small and hazy nodules as the cases that cost him the most time. The headline evaluation (53/59,
VALIDATION_AUDIT.md) is on RIDER, which is mostly large solid NSCLC tumours: 41 of 59 scans are over 30 mm, the
smallest is 12.9 mm, and there are no ground-glass labels. That data cannot answer his question on its own.

## 2. Part A: smaller solid tumours on RIDER (measured)

**Data:** RIDER Lung CT + RIDER-LungCT-Seg (TCIA, CC BY), 59 scans, 31 patients. **Reference:** the MANUAL expert
segment. **AI:** TotalSegmentator 2.18.0 `lung_nodules`, run on the whole CT. **Scoring:** `scripts/evaluate-ai.cjs`,
re-run from scratch on 20 Oct 2026 with identical results. **Size:** expert long axis on the largest slice.

| Expert long axis | Scans | Found (≥ 1 voxel) | Median Dice of hits | Median long-axis error | Median volume error |
|---|---|---|---|---|---|
| ≤ 30 mm | 18 | 15 (83 %) | 0.68 | 3.4 mm | 39 % |
| > 30 mm | 41 | 38 (93 %) | 0.81 | 6.6 mm | 20 % |

### The 12 smallest scans (all cases, nothing removed)

| Scan | Expert long axis | Found | Dice | AI long axis | AI volume vs expert | Candidates on scan |
|---|---|---|---|---|---|---|
| RIDER-2799584460 RETEST | 12.9 mm | yes | 0.81 | 12.3 mm | −26 % | 16 |
| RIDER-1801720707 RETEST | 13.3 mm | **no** | — | — | — | 3 |
| RIDER-2799584460 TEST | 13.3 mm | yes | 0.76 | 11.9 mm | −36 % | 18 |
| RIDER-1801720707 TEST | 13.5 mm | yes | 0.29 | 8.0 mm | −83 % | 5 |
| RIDER-1225316081 RETEST | 14.0 mm | yes | 0.59 | 10.6 mm | −54 % | 3 |
| RIDER-1225316081 TEST | 14.7 mm | yes | 0.30 | 9.6 mm | −82 % | 3 |
| RIDER-9763310455 TEST | 14.9 mm | yes | 0.59 | 9.8 mm | −57 % | 6 |
| RIDER-9763310455 RETEST | 15.9 mm | yes | 0.48 | 9.2 mm | −69 % | 6 |
| RIDER-1867199702 RETEST | 17.5 mm | yes | 0.81 | 15.1 mm | −26 % | 8 |
| RIDER-1867199702 TEST | 18.5 mm | yes | 0.76 | 15.1 mm | −37 % | 9 |
| RIDER-2541949645 RETEST | 18.7 mm | yes | 0.08 | 8.5 mm | −96 % | 8 |
| RIDER-2541949645 TEST | 19.6 mm | yes | 0.06 | 10.5 mm | −97 % | 9 |

Source: `docs/eval/ai-results.csv`. "Candidates on scan" includes the one that hit.

### What the failures look like

1. **Under-segmentation, every time.** All 11 small hits have an AI volume *below* the expert's, by 26–97 %. On
   RIDER-2541949645 the "hit" overlaps the tumour by only a sliver (Dice 0.06–0.08). Detection alone overstates
   usefulness here: at Dice ≥ 0.5, 6 of these 12 scans count as found.
2. **Inconsistent between same-day scans.** RIDER-1801720707 was found on TEST (poorly, Dice 0.29) and **missed** on
   RETEST 15 minutes later. That points to a model near its limit, not to a feature of the tumour.
3. **Extra candidates.** The best small result (RIDER-2799584460, Dice 0.81) came with 15–17 other candidates per
   scan to review. They are unconfirmed: RIDER labels only one tumour per scan, so some may be real nodules.
4. **No sub-10 mm nodules in this data.** Nothing here says how the AI does on 4–10 mm nodules.

**Consequence for the workflow:** on small lesions the researcher should expect to redraw edges before any volume is
used, to add the occasional miss with **S**, and to reject a batch of extra candidates on some scans. Those steps are
where the time goes, and they are what the timed session must measure.

## 3. Part B: LIDC-IDRI ground-glass, part-solid and small solid nodules (measured)

### Why LIDC-IDRI

[LIDC-IDRI](https://doi.org/10.7937/K9/TCIA.2015.LO9QL9SX) (TCIA, CC BY 3.0) is the standard public chest-CT set with
nodule outlines by up to 4 thoracic radiologists. Each reader also rates **texture** from 1 (non-solid, ground-glass)
to 5 (solid). That gives a documented basis for "ground-glass", instead of us judging it from the image.

> **Possible overlap with the model's training data (found 21 Oct 2026).** The `lung_nodules` model was "trained on
> 1353 subjects, partly from LIDC-IDRI" ([TotalSegmentator README](https://github.com/wasserth/TotalSegmentator)). The subject list is not published, so we cannot tell whether any
> of our 15 LIDC scans were in it. If some were, the LIDC detection rates below are **optimistic** (the model may have
> seen these nodules). It does not soften the ground-glass result: 0 of 5 found even if they were in training. RIDER is
> not named as a training source, but the full training list is not public, so its independence is not proven either.

### Selection rules (fixed before any AI result, in `scripts/lidc/prepare_lidc.py`)

- Annotations from the LIDC radiologist XML, as packaged in the pylidc database. Scans with slice thickness ≤ 2.5 mm,
  one scan per patient, taken in patient-ID order.
- Annotations of the same nodule are grouped when their 3-D boxes overlap. A **reference nodule** is one outlined by
  ≥ 3 of 4 readers (LUNA16 convention).
- **Type** = median reader texture: ≤ 2.5 non-solid (ground-glass), < 4 part-solid, ≥ 4 solid.
- Categories, first eligible scans in ID order: **4 non-solid, 3 part-solid, 5 small solid (4–10 mm), 3 large solid
  (≥ 20 mm)**, 15 scans in all. Every annotated nodule on a selected scan is scored, not only the one that caused the
  selection. No case is removed afterwards.

### Scoring (fixed in `scripts/lidc/evaluate-lidc.cjs`, same app code as the RIDER test)

- Reference outline = 50 % consensus of the readers' outlines.
- **Detected** = ≥ 1 voxel overlap (as on RIDER), also reported at Dice ≥ 0.1 and ≥ 0.5.
- Per nodule: Dice, long- and short-axis error, volume error, mean HU, and agreement between readers (median
  reader-vs-consensus Dice), which shows how hard the outline is even for radiologists.
- **False positives:** a candidate that touches no reader outline is *unmatched*. Readers also marked nodules < 3 mm
  without outlines, so this is an upper bound.
- **Inference time:** wall-clock per scan, logged by the run (`data/lidc/inference-times.json`).

### How to run it (lab laptop, about 30–60 min unattended)

```bash
cd ~/Downloads/nodule-research-copilot
scripts/lidc/run-lidc.sh                               # select → download (IDC) → TotalSegmentator, timed
npm run eval:lidc -- data/lidc --out docs/eval          # → lidc-nodules.csv, lidc-candidates.csv, lidc-summary.json
node scripts/lidc/make-rtstruct.cjs data/lidc           # reader outlines as RTSTRUCT, to view them in the app
```

The scoring script was tested end to end on a RIDER scan with known answers. The download step needs the network
access that this laptop has and our build environment does not.

### Results (run 20 Oct 2026, MacBook M3 Pro, TotalSegmentator 2.18.0 `--device mps`)

15 scans selected, 15 run, 15 scored. 35 reference nodules (≥ 3 of 4 readers) plus 25 nodules outlined by only 1–2
readers, which are not scored as reference.

| Reader-rated type | Reference nodules | Found (≥ 1 voxel) | Found at Dice ≥ 0.5 | Dice of found (median) | Long / short-axis error | Volume error (median) | Readers vs consensus (Dice) |
|---|---|---|---|---|---|---|---|
| **Ground-glass (non-solid)** | 5 (5.7–15.8 mm) | **0** | 0 | — | — | — | 0.88 |
| Part-solid | 3 (7.5–19.4 mm) | 1 | 0 | 0.21 | 9.1 / 8.7 mm | −88 % | 0.89 |
| Solid | 27 (6.0–42.6 mm) | 26 | 19 | 0.60 | 2.7 / 1.6 mm | −55 % | 0.87 |
| **All** | 35 | **27 (77 %)** | 19 | 0.59 | 2.7 / 1.6 mm | −55 % | 0.88 |

| Expert long axis | Reference nodules | Found | Dice ≥ 0.5 | Dice of found | Volume error |
|---|---|---|---|---|---|
| < 6 mm | 1 | 0 | 0 | — | — |
| 6–10 mm | 21 | 15 | 9 | 0.56 | −61 % |
| 10–20 mm | 8 | 7 | 5 | 0.59 | −58 % |
| ≥ 20 mm | 5 | 5 | 5 | 0.76 | −38 % |

- **Solid ≤ 10 mm:** 15 of 16 found.
- **All 27 found nodules were outlined too small**, by 26 % to 91 % in volume. The long axis is close (median error
  2.7 mm), but the volume is not. The AI outline hugs the dense core.
- **Extra candidates:** 57 in all, 38 touch an annotated nodule and 19 touch none (median 1 per scan, median 36 mm³).
  This is an upper bound on false positives: readers also marked nodules < 3 mm without outlines.
- **Inference time (measured, wall clock):** median **97 s** per scan (69–129 s), 15 scans, Apple M3 Pro, MPS. No run
  failed.

**The 8 missed reference nodules**

| Nodule | Type | Expert long axis | Mean HU inside the consensus outline | Nearest AI candidate |
|---|---|---|---|---|
| LIDC-IDRI-0046 N3 | ground-glass | 5.7 mm | −553 | 10.5 mm away |
| LIDC-IDRI-0075 N1 | ground-glass | 15.8 mm | −508 | 95 mm away (screenshot on slide 5) |
| LIDC-IDRI-0076 N2 | ground-glass | 8.3 mm | −651 | 70 mm away |
| LIDC-IDRI-0088 N1 | ground-glass | 6.6 mm | −653 | 152 mm away |
| LIDC-IDRI-0088 N2 | ground-glass | 8.3 mm | −643 | 80 mm away |
| LIDC-IDRI-0008 N1 | part-solid | 8.2 mm | −617 | 180 mm away |
| LIDC-IDRI-0045 N4 | part-solid | 7.5 mm | −601 | 73 mm away |
| LIDC-IDRI-0008 N2 | solid | 9.5 mm | −468 | 35 mm away |

Seven of the eight misses have a mean density of −508 to −653 HU: hazy tissue, not solid nodules. The model was
not built for these, and in this test it does not see them.

### A scoring bug we found and fixed before reporting

The first scoring run "missed" every nodule on 5 of the 15 scans. The cause was in our scorer, not the AI: it chose the
contour orientation per scan from a density heuristic, and on those 5 scans it flipped the radiologists' outlines onto
bone and soft tissue. The scorer now uses pylidc's documented convention (x = column) on every scan. Independent
check: with the fixed orientation, the AI's own candidates land on the radiologists' nodules on those scans (e.g.
LIDC-IDRI-0011: 3 of 3, where before it was 0 of 3, and unmatched candidates fell from 11 to 3). Results above are
from the fixed scorer (cache `docs/eval/cache-lidc-v2`).

## 4. Failure analysis checklist (what we look for when the LIDC run is in)

| Failure mode | RIDER evidence so far | LIDC check |
|---|---|---|
| Small-lesion misses | 1 of the 12 smallest scans missed; 3/18 ≤ 30 mm missed | 6–10 mm: 15/21 found; the misses are mostly ground-glass |
| Ground-glass under-segmentation | not testable (no labels) | worse: ground-glass is **not detected at all** (0/5); part-solid 1/3 at Dice 0.21 |
| False-positive vessels | 344 unconfirmed candidates on 59 scans (median 3, max 30); not classified | 19 unmatched candidates on 15 scans (median 1, median 36 mm³); not classified by anatomy |
| Leak into neighbours | AI: not seen in the examples above (it under-segments). Click method: 16/59 leaks | outlines extending beyond all readers |
| Large volume error despite high Dice | follow-up sample: Dice 0.87 with −20 % volume | every found nodule −26 % or worse; volume is the weak point |
| Acquisition differences | baseline/follow-up sample uses STANDARD vs LUNG kernels | slice thickness and kernel per scan in `lidc-scans.csv` |
| Unsupported input | none of the 59 RIDER scans failed | none of the 15 LIDC scans failed |

## 5. Screenshots

Real app screenshots on slide 5 of the walkthrough: LIDC-IDRI-0075 N1 (ground-glass, missed; reader outline loaded
into the app as RTSTRUCT by `scripts/lidc/make-rtstruct.cjs`), RIDER-1801720707 TEST (found, outlined too small) and
RETEST (missed), RIDER-2799584460 RETEST (success).

## 6. Limits of this test

- 15 LIDC scans and 35 reference nodules: enough to show the pattern, too few for confident rates (5 ground-glass
  nodules). LIDC scans are older (1.25–2.5 mm slices), and 14 of the 15 use the STANDARD kernel.
- Type comes from reader texture ratings (median), not from us. Sizes are the consensus outline's long axis.
- "Found" is lenient (≥ 1 voxel), so the Dice ≥ 0.5 column is reported next to it.
- The model was trained partly on LIDC-IDRI (subject list not public): the LIDC detection rates may be optimistic;
  an independent test set would be needed for a fair rate (see §3).
- This is the AI's performance alone. With the researcher in the loop, misses are added by hand. Timing that is the
  open question.
