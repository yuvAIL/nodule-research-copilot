# Walkthrough script: 8 slides, 15–20 minutes with discussion

*For Daniel (primary user), Naomi (decision-maker) and the Base44 reviewers. Each slide answers one question.
Numbers trace back to `EVIDENCE_REGISTER.md` (E-numbers). Speak in "we measured / Daniel reported / not measured
yet". Never say "validated", "equivalent to radiologists", or "saves 50 %".*

| # | Slide | Minutes | Question it answers |
|---|---|---|---|
| 1 | From manual CT review to AI-assisted research | 1.5 | Where does Daniel's time go today? |
| 2 | From the hospital scan to your sheet | 1.5 | How will Daniel actually work with it? |
| 3 | Let AI propose the findings | 2 | What does the AI actually do? |
| 4 | Review. Correct. Approve. | 2.5 | Who is in control of the numbers? |
| 5 | Understand what changed | 2 | What does follow-up look like? |
| 6 | Testing where researchers lose the most time | 3 | How does it do on small and hazy nodules? |
| 7 | Does it actually save time? | 2 | What is measured, and what is not yet? |
| 8 | What would make this trustworthy enough to use? | 1.5 + 5 discussion | What does Daniel need before he uses it? |

---

## Slide 1 · The research workflow problem (1.5 min)

- "These are your own numbers, Daniel: 25–40 minutes per baseline scan. The two big blocks are finding nodules (two
  passes, 10–20 min) and outlining for volume (15–25 min), and that second one is why you only do it for about 1
  nodule in 5." (E1)
- "Naomi's goal is about half of that. Today that is a goal, and slide 7 shows exactly how far we have got." (E2)
- Close on the question: *can we cut this and still keep you in control of every number?*

## Slide 2 · From the hospital scan to your sheet (1.5 min)

- "Before the AI: this is your day with it." Walk left to right. You export the scan as for any research scan →
  one command runs the AI (overnight if you like) → open the folder in Chrome → review, fix, approve → the sheet
  fills itself.
- Only step 4 needs his judgement. Steps 2, 3 and 5 are machine time (measured: ~97 s AI per scan; ~12 s to open
  two scans with AI).
- Privacy and IT: nothing leaves the lab computer, and the browser blocks other sites (E22). There is no server and no
  PACS connection, so no IT project, which is where last year's vendor stalled.
- Be honest about the manual part: export and one command. Next: a watched folder; writing back to PACS only if
  the hospital wants it. Ask him: "How do you get research scans out of PACS today?"

## Slide 3 · Let AI propose the findings (2 min)

- A real screenshot, a real public scan (RIDER), real model output. TotalSegmentator 2.18.0 ran on the whole CT. It
  was not told where to look, and no expert data goes into it (E20).
- It runs on the lab laptop before you sit down, about 100 seconds per scan (E6, from file timestamps). Nothing leaves
  the computer.
- Point at the worklist: N1 65.5 × 49.3 mm, 79,677 mm³, RUL; plus two tiny candidates. "Every one starts as *To
  review*. Nothing is exported until you accept it."

## Slide 4 · Review. Correct. Approve. (2.5 min)

- Left: the AI outline in cyan, the expert outline as dotted magenta. Right: after brush strokes on 5 slices.
- Read the table: volume 43.8 → 46.8 mL, toward the expert's 55.0. One stroke overshot the long axis (65.1 vs 59.8).
  "I'm showing that on purpose: the numbers update after every stroke, so you see a mistake right away and undo
  it with one key." (E8)
- Say plainly: *these strokes were made by our test script, not by a person*, so this shows the mechanism and says
  nothing about correction time.
- Mention **S** + click for anything the AI missed. It is logged as "added by researcher".

## Slide 5 · Understand what changed (2 min)

- Baseline 2006-09-05 vs follow-up 2006-09-20, same patient. The app paired N1 with its earlier self automatically
  (38 mm apart) and computed the change: −10.1 mm long axis, −45.1 % volume. The "?" stays until you confirm (E9).
- Then the caution: the two scans were reconstructed differently (STANDARD vs LUNG kernel), the baseline has no
  expert outline, and even two scans on the same day differ by a median 10–17 % in volume (E10). "The app does the
  re-find and the arithmetic. Whether the tumour really shrank is your call."

## Slide 6 · Small and ground-glass nodules (3 min)

- "This is the slide you asked for." Start with the limitation: RIDER's smallest tumour is 12.9 mm, and there are no
  ground-glass labels.
- On tumours ≤ 30 mm: 15 of 18 found, but outlines are worse (Dice 0.68, volume 39 % off) (E12). On the 12 smallest,
  every AI outline was too small, by 26–97 % (E13).
- The failure: the same 13 mm tumour was outlined at 8 mm on one scan and **missed** on the repeat 15 minutes later
  (E14). The success: 12.9 mm found with Dice 0.81, but 15 other candidates to reject on that scan (E15).
- Then the new test you asked for (E16): LIDC-IDRI, 15 scans, 35 nodules each outlined by at least 3 radiologists,
  with the radiologists' own texture ratings. Solid: 26 of 27 found, 15 of 16 at ≤ 10 mm. **Ground-glass: 0 of 5.**
  Part-solid: 1 of 3. Show the 15.8 mm ground-glass nodule with nothing on it (E21).
- Say what it means: for hazy nodules the AI does not help today, so he keeps searching for them himself. For
  solid nodules it finds them, but every outline is too small, so he redraws before using a volume.
- If asked how we know the scoring is right: we caught a bug in our own scorer (outlines flipped on 5 scans) before
  reporting. The fix is checked by the AI's candidates landing on the radiologists' nodules.

## Slide 7 · Does it actually save time? (2.5 min)

- Top row, measured: 53/59 found (stricter Dice ≥ 0.5: 43/59), Dice 0.76, a median of 3 extra candidates per scan,
  97 s of AI time per scan (E3–E6). Right card: the LIDC numbers repeat the slide 6 message (E16).
- The bar chart is the honest part: manual = your estimate; 50 % = the goal; with the tool = **not measured yet**
  (E17). The app already logs every action, correction, pause and export, so one timed session produces the answer.
- Machine time is seconds (E7). The open question is your review and correction time, especially on small nodules.

## Slide 8 · What would make this trustworthy? (1.5 min + discussion)

- Read Daniel's quote (E18). Say it is his written feedback, not an observation of him using the tool.
- Status on his three points: review and correction built; timing instrumented but not run; small solid tested with
  failures shown, ground-glass pending.
- Ask the four questions and write the answers down word for word. Propose the next step: a 15–20 minute timed
  session (RESEARCHER_TEST_PROTOCOL.md) on public scans, manual vs AI-assisted.

## If asked

- *"Is it as good as a radiologist?"* We don't claim that. On one scan, 5 readers using a semi-automatic tool scored
  Dice 0.77–0.90 against the expert, and the AI scored 0.87 (E19). That is context from one patient, not equivalence.
- *"False positives?"* Not measurable on RIDER, because only one tumour is labelled per scan. LIDC has all nodules
  labelled, so it gives an upper bound.
- *"Does data leave the computer?"* No. The browser blocks connections to other sites (CSP), and the AI runs locally.
