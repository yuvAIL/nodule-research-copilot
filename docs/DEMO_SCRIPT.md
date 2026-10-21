# Demo script

The current step-by-step demo on public data is in [`PILOT_READINESS.md` §5](PILOT_READINESS.md#5-demo-script-public-data-about-8-minutes):
baseline preparation, correction with re-approval, adding a finding, export, timed task, and follow-up confirmation.

## Corrections to the earlier 5-minute version (21 Oct 2026)

These lines from the earlier script are no longer true or were never supported, so do not use them:

- **"A → accepted *and* paired."** Accepting no longer confirms a follow-up match. **M** confirms it.
- **"A 45 % drop is real."** The two sample scans were reconstructed differently (STANDARD vs LUNG kernel). The change
  is a measured difference, not a biological claim.
- **"The sheet fills itself" (linked before the call).** Link sheet is optional and not verified end to end. Demo the
  Export CSV download instead.
- **"After = measured in the app (Yuval, n = 3, proxy)."** No time-saved measurement exists. Developer runs are not a
  proxy for researcher time.
- **"5 readers 0.72–0.87".** The corrected figure is 0.77–0.90: one patient, readers using a semi-automatic tool, given
  as context only (VALIDATION_AUDIT #5).
- **"Session summary → Start a new timed run".** That only resets the findings. Timing now uses **▶ Start timed task**
  and **Finish** in the header.

## If something breaks live

- **Slow first load:** the sample is about 250 MB of public CT. Switch to the backup recording.
- **AI result not shown:** use **Worklist → Load AI result…** with the files in the sample folder.
