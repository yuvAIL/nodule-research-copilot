# Walkthrough script: 9 slides, about 15 minutes plus discussion

*For Daniel (primary user), Naomi (decision-maker) and the Base44 reviewers. The slides carry one message each; the
detail lives here. Numbers trace to `EVIDENCE_REGISTER.md` (E-numbers). Say "we measured", "Daniel estimated" or
"not measured yet". Never say "validated", "equivalent to radiologists" or "saves 50 %".*

| # | Slide | Min | The one message |
|---|---|---|---|
| 1 | Nodule Research Copilot | 0.5 | Who I am and what this is |
| 2 | Halve the time per scan, without losing quality | 1.5 | The goal and how we judge success |
| 3 | From the hospital scan to your sheet | 2 | How Daniel will actually work with it |
| 4 | The AI does the first pass | 1.5 | What the AI does, and that nothing is final |
| 5 | Review. Correct. Approve. | 2 | Daniel controls every number |
| 6 | Every nodule is matched to its earlier self | 1.5 | Follow-up without re-finding or arithmetic |
| 7 | Small solid: found. Ground-glass: not yet. | 2.5 | Honest results on the cases he asked about |
| 8 | What is proven, and what is not yet | 2 | Evidence vs. open questions |
| 9 | What would make this worth using? | 1 + discussion | His three answers and the next step |

---

## Slide 1 · Nodule Research Copilot (0.5 min)

- "I'm Yuval. This is a research tool for your lab: the AI does the first pass on a chest CT, and you stay in
  control of every number."
- Point at the image: a real public scan, with the AI outline and the expert's outline. Research prototype, not
  for clinical use.

## Slide 2 · Objective (1.5 min)

- Today: 25–40 minutes per baseline scan, in Daniel's own estimate (E1). Most of it is finding nodules (10–20 min,
  two passes through 250–400 slices) and outlining for volume (15–25 min per nodule, which is why he only does it
  for about 1 in 5). The rest: ruler measurements, re-typing into the sheet, and ~10 min extra on follow-ups.
- Goal: about half (Naomi's target, E2), so 12–20 minutes.
- Three tests for success: accurate, in his control, and faster as *measured*, not promised.

## Slide 3 · From the hospital scan to your sheet (2 min)

- Walk left to right. He exports the scan as for any research scan → one command runs the AI (~97 s per scan,
  measured; can run overnight) → he opens the folder in Chrome → he reviews, fixes and approves → the sheet fills
  itself in his columns.
- Only step 4 needs his judgement. The rest is machine time.
- Nothing leaves the lab computer, and the browser blocks connections to other sites (E22). No server and no
  hospital connection means no IT project, which is where last year's vendor stalled.
- Honest: export and the AI command are manual today. Next (not built): the AI runs by itself on new exports.
  Writing results back to the hospital system only if the hospital wants it (standard DICOM SEG).

## Slide 4 · The AI does the first pass (1.5 min)

- A real screenshot: public RIDER scan, real output of TotalSegmentator 2.18.0, an open model. It searched the
  whole scan, and nothing told it where to look (E20).
- Each candidate is outlined in 3-D and measured: long and short axis on the largest slice, volume from the voxels,
  plus a lobe hint from the AI's lung-lobe map.
- Here: N1 65.5 × 49.3 mm (79.7 mL), plus two tiny candidates. All start as "to review".

## Slide 5 · Review. Correct. Approve. (2 min)

- Left: the AI outline (cyan) and the expert's (dotted magenta). Right: after brush strokes on 5 slices.
- Volume moved 43.8 → 46.8 mL, toward the expert's 55.0 mL. One stroke overshot the long axis (65.1 vs 59.8 mm).
  "I'm showing that on purpose: every stroke re-measures, so a mistake shows at once and is one undo away." (E8)
- Say plainly: the strokes were made by our test script, so this shows the mechanism, not correction time.
- Keys: A accept, R reject, B brush, E erase, S click to add a missed nodule (logged as added by the researcher).

## Slide 6 · Every nodule is matched to its earlier self (1.5 min)

- Baseline 5 Sep 2006 and follow-up 20 Sep 2006, same patient. The app paired N1 with its earlier self (38 mm
  apart, closest first) and computed the change. The "?" stays until he confirms (E9).
- Caution: the two scans were reconstructed differently (STANDARD vs LUNG kernel), there is no expert outline on
  the baseline, and same-day repeat scans already differ by a median of 9.5 % (our click) to 17 % (expert) in
  volume (E10). The app does the re-finding and the arithmetic; whether it shrank is his call.

## Slide 7 · Small solid: found. Ground-glass: not yet. (2.5 min)

- "This is the slide you asked for." LIDC-IDRI: 15 public scans selected by fixed rules, 35 nodules each outlined by
  at least 3 of 4 radiologists, with their own texture ratings (E16).
- Solid: 26 of 27 found, 15 of 16 at ≤ 10 mm. But every outline the AI produced was too small (−26 % to −91 % in
  volume), so he redraws before using a volume.
- Part-solid 1 of 3. **Ground-glass 0 of 5.** Show the 15.8 mm ground-glass nodule with nothing on it (E21). For hazy
  nodules the AI does not help today; he keeps searching for them himself.
- Images 2 and 3 are from RIDER: a 13.5 mm tumour outlined at 8.0 mm (and missed entirely on a repeat scan 15
  minutes later, E14), and a 12.9 mm tumour matched closely (Dice 0.81, E15).
- If asked how we know the scoring is right: we caught a bug in our own scorer (outlines flipped on 5 scans) before
  reporting, and the AI's candidates landing on the radiologists' nodules confirmed the fix.

## Slide 8 · What is proven, and what is not yet (2 min)

- Measured: 53 of 59 known tumours found on RIDER (90 %; stricter Dice ≥ 0.5: 43/59), median overlap with the expert
  outline 0.76, AI time 97 s per scan (E3–E6). Context, not equivalence: on one scan, 5 readers using a
  semi-automatic tool scored 0.77–0.90 against the same expert (E19).
- Time: today 25–40 min (his estimate), goal 12–20 min, with the tool **not measured yet** (E17). The app already
  logs every action, correction and pause, so one timed session gives the answer.
- Not proven: researcher time saved, and ground-glass. False positives are only an upper bound (LIDC: a median of 1
  extra candidate per scan).

## Slide 9 · What would make this worth using? (1 min + discussion)

- Read his quote. It is his written feedback, not an observation of him using the tool (E18).
- Ask the three questions and write the answers down word for word.
- Propose the next step: a 20-minute timed session on 10 public scans, manual vs with the tool
  (`docs/RESEARCHER_TEST_PROTOCOL.md`).

## If asked

- *"Is it as good as a radiologist?"* We don't claim that. See slide 8 context: one scan, semi-automatic readers.
- *"False positives?"* Not measurable on RIDER (one tumour labelled per scan). LIDC gives an upper bound: median 1
  extra candidate per scan.
- *"Does data leave the computer?"* No. The browser blocks other sites (CSP), and the AI runs locally.
- *"Why not write results back to PACS?"* It's a research tool, and his output today is a research sheet. Writing
  back is possible (DICOM SEG) but needs the hospital's IT, so it's a phase-2 choice for them.
