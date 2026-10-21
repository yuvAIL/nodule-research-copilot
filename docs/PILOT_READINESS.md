# Pilot readiness: what changed, what was checked, how to run the first sessions

*Nodule Research Copilot · 21 Oct 2026 · research prototype, not for clinical use*

The goal of this round was a workflow Daniel can attempt on his own, with measurements he can trust and a fair way
to test whether it saves time. This page covers what changed, what was verified (and by whom), what is still open,
how to run it, a demo script, the 20-minute usability session and the separate timing study.

## 1. What changed, and why it matters to Daniel

**Findings and export**
- **An edit after approval needs a new approval.** If an approved finding is edited, its status becomes *↻ Re-approve*
  and it is left out of the export until it is accepted again. Undo restores the outline, the numbers and the approval.
- **The original AI proposal is kept.** The card shows it next to the edited result, and the CSV exports it in two new
  columns: *Proposed long diameter (mm)* and *Proposed volume (mm3)*.
- **A single-slice outline gets no volume.** The card shows "— single slice: diameters only". In the CSV the volume
  cells stay empty and *Volume basis* reads "single slice: diameters only, no volume". 3-D outlines read
  "3-D outline, N slices".
- **Identity columns.** Every row now carries *Finding UID* and *Series UID*.
- **Export rules.** The CSV contains only accepted findings, one row each, so exporting twice writes the same rows
  again with no duplicates. Exporting with nothing accepted explains why instead of writing an empty file. If the
  download fails, the app says that nothing was saved. *Rows exported* in the session summary is now the last export,
  not a running total.

**Follow-up comparison**
- **Accepting no longer confirms a match.** Before this change, **A** both approved the measurement and silently
  confirmed the suggested match. Now the match stays *suggested* until Daniel decides. He has three choices:
  - **M** / *Same nodule*: confirmed match.
  - *Probably same (uncertain)*.
  - *Not in earlier scan*: exported as "No earlier match".
- **Where a match came from is always visible:** "Suggested by position only (… mm apart)", "Picked by you", or
  confirmed by Daniel.
- **No arbitrary pairings.** A finding with no earlier nodule within 50 mm is not paired with an unrelated one. An
  earlier nodule already confirmed for another finding is marked "already matched to N…".
- **The comparison table.**
  - Each column shows its scan's timepoint and date.
  - Units are in the row labels, and % is change ÷ earlier value. A zero or missing earlier value shows "—".
  - Volume is compared only between outlines that span several slices.
  - The table notes that a measured change is not a statement about growth or response.
- **Reconstruction differences are flagged.** Kernel and slice thickness are now saved with each earlier measurement.
  When they differ, the panel says so. The public sample pair is STANDARD vs LUNG, both 1.25 mm.
- **The empty comparison now explains itself.** The empty panel in the screenshot came from the comparison using only
  *accepted* findings of the earlier scan. Matching itself was not broken. The panel now gives the reason and the next
  step:
  - the earlier scan has nothing accepted yet: with an *Open it* link;
  - this is the earliest scan, so there is nothing to compare;
  - there is no earlier scan in this browser: with a CSV import.

**Link sheet**
- **Failures are now reported.** *Link sheet* used to show "Sheet linked" even when the write failed. It now reports
  the actual result.
- **The panel explains what it does:**
  - Chrome/Edge only.
  - It rewrites the whole chosen file with every accepted finding of every scan measured in this browser.
  - Nothing is uploaded.
  - After a reload, writing needs permission again (*Resume writing*).
  - Excel locks open files.
- **Export CSV is presented as the reliable path.**

**Timing**
- **Explicitly timed tasks.** The header has **▶ Start timed task / Pause / Resume / Finish**.
  - **Task time** runs from Start to Finish, minus explicit pauses. Pause time is recorded and reported.
  - **AI inference is not part of the task.** It runs before the session and is reported separately.
- **Expert reference handling.**
  - **At Start:** the expert outline is hidden.
  - **If it is shown during the task:** the session is labelled *reference-assisted* and flagged in the time-saved table.
  - **If it is loaded during a timed task:** it stays hidden.
- **Phases and counts.** At Finish, the app records phases that do not overlap and add up to the task time: review,
  correction, adding, documentation/export, and other. It also counts accepted, rejected, edited, added and exported
  findings. A task with no export during it is marked *not completed* and is not used for time saved.
- **Observed manual sessions.** **Timing** has a form to enter them: minutes timed by an observer, completed or not,
  and notes.
  - **Time saved = manual − assisted.** It is computed only for a scan that has both kinds of session, so it can be
    negative, and repeats are averaged and counted.
  - **Historical estimates are not entered.** Self-reported times stay out of the table.
  - **Timing CSV.** One row per session.
- **The old implicit counter is renamed "activity"** ("m:ss activity" in the worklist), so it is not mistaken for a
  timed task.

**Code (for review):**
- `src/findings/timing.ts` (new), `src/components/TimingPanel.tsx` (new).
- `src/findings/{types,store,record,priors}.ts`.
- `src/components/{FollowUpPanel,FindingsPanel}.tsx`, `src/App.tsx`, `src/styles.css`.

## 2. Verification

### 2a. Automated checks (21 Oct 2026)

| Check | Result |
|---|---|
| TypeScript, strict (`tsc -p tsconfig.app.json --noEmit`) | 0 errors |
| ESLint (`eslint src --max-warnings=0`) | 0 problems |
| Unit tests: 15 files, 78 tests | all pass |

The tests were run with `tsx` and a small vitest-compatible shim, because vitest could not be installed in the
offline environment. **`npm run check` (vitest + production build) must be run once on the Mac before committing.**
That command is in the commit block.

New tests:
- `timing.test.ts`:
  - pauses are excluded;
  - phases do not overlap and sum to the task time;
  - time saved only for comparable sessions, negative allowed, reference-assisted flagged;
  - counts.
- `record.test.ts`:
  - single-slice → no volume;
  - approved values (not later edits) are exported, with the proposal kept;
  - identity columns;
  - "No earlier match".
- `store.test.ts`:
  - proposal kept;
  - edit after approval → re-approval needed;
  - undo restores approval;
  - *no earlier match* and *match* are mutually exclusive.

### 2b. Developer walkthrough in a real browser

This was a walkthrough by Claude (the developer), not a researcher.

- **Setup:** Mac dev server, the app's built-in browser pane at 1440×900, IndexedDB cleared first.
- **Data:** public RIDER-1129164940, with real TotalSegmentator 2.18.0 output and the RIDER-LungCT-Seg expert outline.
- **Corrections:** made with mouse strokes by the developer. They show that the mechanism works, not how long it
  takes a person or how well a person does it.

| Step | Observed |
|---|---|
| Load sample | Baseline 2006-09-05: "AI found 3"; N1 65.5 × 49.3 mm, 79 677 mm³, 49 slices |
| Start timed task | Timer running; notice explains the task |
| A on N1, R on N2 and N3 | N1 approved with Type/Lobe filled; N2 and N3 rejected |
| Erase stroke on approved N1 | Volume 79 677 → 78 654 mm³; status *↻ Re-approve*; export count dropped to 0; original proposal shown |
| Undo | 79 677 mm³ restored; status back to *Approved*; export count 1 |
| Erase again, then A | Re-approved at 78 654 mm³ |
| Brush, 3-D off, nothing selected | New finding N4 "added by you", 16.4 × 6.2 mm, 1 slice, volume "— single slice: diameters only" |
| Click-add on air | Message: "No dense tissue (> −400 HU) at the click…" |
| Export twice | Each file has exactly 2 rows (N1, N4); rejected N2/N3 absent. N1: 78654 mm³, basis "3-D outline, 49 slices", proposed 65.5 mm / 79677 mm³, edited provenance, both UIDs. N4: volume empty, basis "single slice: diameters only, no volume" |
| Pause 3 s / Resume / Finish | Task 2:30, paused 0:03. Phases 0:39 / 0:42 / 0:55 / 0:04 / 0:09 (sum 2:29, rounding); counts 2/2/2/1/2; completed |
| Manual session entry (labelled SOFTWARE TEST ENTRY, then removed) | 2:00 manual vs 2:30 assisted → "−0.5 min", "−25 %": a negative result is shown, not hidden |
| `.` → follow-up 2006-09-20 | N1 55.4 × 40.6 mm, suggested match to baseline N1, 38 mm apart, "↔ ▼44% vs Baseline?" |
| Comparison table | Baseline 2006-09-05 vs Follow-up 1 2006-09-20; long −10.1 mm (−15.5 %), short −8.7 mm (−17.6 %), volume −44.4 %; warning "Reconstructed differently: STANDARD vs LUNG" |
| A on follow-up N1 | Approved; match **still suggested** ("?") |
| M | Match confirmed |
| N2 (no nearby earlier nodule) | Says so, offers *Not in earlier scan*; does not compare against an unrelated nodule |
| Follow-up export | N1: Match "Confident", prior Baseline values, changes. N2: "No earlier match" |
| Start timed task on the follow-up | Expert outline hidden. Turning it on marked the session *reference-assisted*. Finish without export → "NOT completed". Test session removed |
| Reload | Follow-up reopened with its approvals and matches. `,` back to the baseline: its own 4 findings, unaffected (series isolation) |
| Baseline comparison panel | "This is the earliest scan … nothing earlier to compare with" |
| Network | Every resource request during the session went to the app's own origin (127.0.0.1:5173) |

**Not verified in this walkthrough:**
- *Link sheet* end to end. The browser pane cannot drive the file picker; only the error reporting changed.
- The "earlier scan has nothing accepted yet" message in the browser. It is code-reviewed and depends on the same data
  as the verified cases.
- Other laptop sizes and browser zoom levels. At 1440×900 everything was reachable. Selecting Brush makes the measure
  toolbar wrap onto two lines.
- The difficult-case example comes from the earlier evaluation, not from this walkthrough:
  - LIDC-IDRI ground-glass nodule, 15.8 mm, with no AI candidate (E21);
  - RIDER 13.5 mm tumour missed on a repeat scan (E14).

### 2c. Validation by a researcher

None yet. Nobody but the developer has used the tool. Daniel's quote is written feedback on a description, not an
observation of him using it.

### 2d. Evaluation claims

All re-checked on 20 Oct (`docs/VALIDATION_AUDIT.md`); unchanged today.

| Claim | Status | Scope to keep with it |
|---|---|---|
| Target tumour found on 53/59 RIDER scans, 31 patients | Verified | Hit = ≥ 1 voxel overlap; stricter: Dice ≥ 0.5 → 43/59 |
| Median Dice 0.76 | Verified | 3-D, vs the MANUAL expert segment, over the 53 hits only (misses excluded) |
| LIDC ground-glass 0/5, part-solid 1/3, solid 26/27 | Verified | 15 scans, 35 nodules outlined by ≥ 3 of 4 readers; every found solid outline too small |
| ~97 s inference per scan | Verified on LIDC | Median 97 s (69–129 s), 15 scans, M3 Pro, `--device mps`; RIDER ≈ 100 s from file timestamps (partial) |
| Other AI candidates | — | "Additional candidates to review" (median 3 per RIDER scan). Not adjudicated, so they are not called false positives |
| Time saved | **Not measured** | The 50 % figure is a business target |

## 3. Limitations and open questions

- **Time saved is unknown.** The tools to measure it exist; no researcher has been timed.
- **Ground-glass nodules are not found by the AI** (0/5), and solid outlines come out too small. Approval by a
  researcher does not make a measurement accurate; it records his decision.
- **Matching is a position-based suggestion,** tested on one public pair. It is not registration. Large anatomical
  shifts (breathing, positioning) can suggest the wrong nodule, which is why every match is Daniel's call.
- **The baseline must be accepted in the same browser** for follow-up comparison, or imported as a CSV.
  - Data lives in that browser profile; clearing site data deletes it.
  - There is no sync between computers.
- **Link sheet:** Chrome/Edge only, not verified end to end, and it rewrites the whole chosen file. Use a dedicated
  file, not Daniel's master sheet.
- **A timed task belongs to one scan.** If the researcher switches scans before Finish, the time is kept but phases are
  not broken down (the session notes say so). A reload during a task keeps the clock running; it is not paused.
- **Setup on a hospital computer:**
  - The AI needs Python + TotalSegmentator, with a one-time model download (internet).
  - Processing a scan is local.
  - `scripts/run-ai.sh` turns off TotalSegmentator's anonymous usage statistics before each run.
  - Whether IT allows a Python install is the hospital's decision.
- **Single-frame CT DICOM only; one axial view.**

## 4. Setup and run

```bash
# once
git clone <repo> && cd nodule-research-copilot
npm install
npm run dev            # http://127.0.0.1:5173  (Chrome or Edge)
npm run check          # typecheck + lint + unit tests + production build

# the AI, on the lab computer (one-time install + model download, then local)
pip install TotalSegmentator highdicom      # results in this repo used TotalSegmentator 2.18.0
scripts/run-ai.sh /path/to/scan-folder [...] # writes <scan>_ai/ with DICOM SEGs; usage stats off
# then open the PARENT folder in the app: the AI results are picked up automatically
```

**Live public build:** <https://nodule-research-copilot.pages.dev>. It has the sample built in; for other scans, open a
folder.

## 5. Demo script (public data, about 8 minutes)

Use a fresh browser profile, or clear site data first.

1. **Baseline preparation (1 min).**
   - **Load sample CT.** The baseline 2006-09-05 opens with "AI found 3".
   - Say: the AI ran beforehand on this computer, about 97 s per scan. Nothing here is final until accepted.
2. **Start the clock.** Click **▶ Start timed task** and point out that the expert outline is hidden.
3. **Review (1 min).**
   - **A** on N1: Type and Lobe are filled as suggestions.
   - **R** on N2 and N3: "additional candidates to review", not proven false.
4. **Correct (1.5 min).**
   - Select N1 and use **E** on an edge: the volume changes at once, the status becomes *↻ Re-approve*, and the
     original AI numbers stay visible.
   - **⌘Z**: everything returns.
   - Correct again, then **A** to re-approve.
5. **Add a missed finding (1 min).**
   - **S** + click on a solid nodule gives a 3-D outline and a volume.
   - Alternatively, **Esc** and brush on one slice: the card says "diameters only".
6. **Export and inspect (1 min).**
   - **Export CSV** and open the file: only accepted rows, the volume basis, the proposed vs final values, and the
     UIDs.
   - Export again to show it produces no duplicates.
7. **Finish.** **Finish**, then **Timing**: task time, pauses, phases, counts. No time saved is shown, because there is
   no manual session.
8. **Follow-up (2 min).**
   - **.** opens Follow-up 1 2006-09-20, where N1 shows "↔ ▼44% vs Baseline?" as a suggestion.
   - **A** approves the measurement, and the "?" stays.
   - Check the images, then **M** to confirm.
   - Read the reconstruction warning (STANDARD vs LUNG): the change is measured, not a growth claim.
   - The small N2: *Not in earlier scan*.
   - Export: matched and unmatched rows.
9. **Close with the limits.**
   - Ground-glass nodules are not found (LIDC 0/5).
   - Outlines of small solid nodules are too small.
   - Time saved is what the next session measures.

## 6. Sessions with Daniel

### 6a. First session: 20-minute usability, one scan (not a timing study)

**Purpose:** see where he gets stuck. Times from this session are **not** used for time saved: it is his first use,
there is a facilitator, and he thinks aloud.

| Min | Step | Watch for |
|---|---|---|
| 0–2 | Goal and ground rules: the AI proposes, he decides; think aloud | Does he understand what is AI and what is his? |
| 2–7 | Load the sample baseline; review the 3 candidates | Time to first decision; trust in small candidates |
| 7–11 | Correct N1's edge, with the expert outline on (allowed here, since this session is not timed); undo; re-approve | Does he notice *Re-approve*? Does he find undo? Does he trust the re-measured numbers? |
| 11–14 | Add one finding (S or brush); export; open the CSV | Is single-slice vs volume clear? Is anything still re-typed? |
| 14–17 | Follow-up: suggested match, confirm or reject, comparison, reconstruction note | Does he confirm without looking? Does he read the % as biology? |
| 17–20 | Questions: where did you get stuck; what would you still do in the hospital viewer; which error would cost your trust; would you time 5 scans? | Write answers verbatim; observed vs reported |

**Collect:** the exported CSVs and the facilitator's notes. Optionally a screen recording, with his consent.

### 6b. Then: a timing study (separate, several scans)

- **Task (identical in both arms):**
  - find every nodule ≥ 3 mm;
  - long/short axis for each;
  - a 3-D outline and volume for the largest;
  - spreadsheet rows complete;
  - for follow-ups, a match decision for each nodule.
- **Quality standard:** fixed in advance and checked afterwards against the LIDC-IDRI reader consensus. Detection and
  measurement error must be no worse with the tool, within an agreed margin.
- **Cases:** about 10 public scans:
  - a mix of small solid, part-solid/ground-glass and large nodules;
  - 3–4 follow-up pairs;
  - one practice scan per arm, not counted.
- **Arms:**
  - **Manual:** his usual viewer + spreadsheet. An observer times it from "scan open" to "rows saved" and enters it in
    **Timing → Add an observed manual session**, on the same scan.
  - **Assisted:** **▶ Start timed task → Finish**, with the expert outline hidden. Any reference-assisted session is
    reported separately.
- **Learning and order effects:**
  - Two sets of scans, crossed: set 1 manual and set 2 assisted, then the reverse after a washout of ≥ 2 weeks.
  - Alternate which arm comes first.
  - Note in *Notes* whether he had seen the scan before.
- **Report per scan:** manual, assisted and saved (± and %, negative kept), the phase breakdown (where corrections take
  the time), counts, quality vs consensus, and the AI inference time listed separately.
- **What it can and cannot say:** one reader on public data, and a timing CSV that comes straight out of the app.
  It does not establish a lab-wide effect.
