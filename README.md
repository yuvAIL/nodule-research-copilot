# Nodule Research Copilot

A browser tool for a thoracic oncology research lab: open a chest CT and get an **AI worklist** of nodule
candidates, each already outlined in 3-D and measured (long axis, short axis, volume in mm). The researcher
accepts, rejects or corrects each one with the keyboard, adds anything the AI missed with one click, and exports
the lab's spreadsheet rows — with earlier measurements of the same patient shown next to the new ones.

> **Research prototype. Not a medical device. Not for diagnosis or clinical decisions.**

**Live:** <https://nodule-research-copilot.pages.dev> (Chrome or Edge recommended).

### 60-second tour
1. Click **Load sample CT** — a public RIDER scan opens with its precomputed AI result and the expert's outline.
2. The **Worklist** on the right says *"AI found 3"* on the baseline. The first candidate is selected and shown on the image.
3. Press **A** to accept (jumps to the next one), **R** to reject, **J/K** to move, **B/E** to brush/erase the outline.
4. Missed one? Press **S** and click it — it is outlined and measured, and logged as *added by you*.
5. Pick Type and Lobe, then **Export CSV** — one row per accepted nodule, in the lab's columns, with provenance.
6. Press **.** for the follow-up scan: each nodule shows a *suggested* earlier match; **M** confirms it.
7. To time a task: **▶ Start timed task** before step 2, **Finish** after the export (see **Timing**).

**Results:** see [`docs/EVALUATION.md`](docs/EVALUATION.md) — accuracy on 31 patients / 59 scans against expert outlines,
repeatability, AI result, failure modes, and how time saved is measured.

**Pilot readiness (21 Oct 2026):** [`docs/PILOT_READINESS.md`](docs/PILOT_READINESS.md) — what changed for the pilot,
what was verified and how, limitations, demo script, the 20-minute usability session and the timing-study outline.

**Validation pack (20 Oct 2026):** [`docs/VALIDATION_AUDIT.md`](docs/VALIDATION_AUDIT.md) (which claims are verified) ·
[`docs/CHALLENGING_NODULE_EVALUATION.md`](docs/CHALLENGING_NODULE_EVALUATION.md) (small and ground-glass nodules) ·
[`docs/TIME_SAVINGS_EVALUATION.md`](docs/TIME_SAVINGS_EVALUATION.md) · [`docs/RESEARCHER_TEST_PROTOCOL.md`](docs/RESEARCHER_TEST_PROTOCOL.md) ·
walkthrough slides, script and evidence register in [`deliverables/`](deliverables/).

---

## What it does

| Step | In the app |
| --- | --- |
| Review AI candidates | **Load AI result…** (a DICOM SEG from TotalSegmentator `lung_nodules`, run offline) or a SEG file inside the opened folder. Each connected piece becomes a candidate *to review*, labelled with the model, version and run date. A/R/J/K review; nothing is exported until accepted. |
| Search faster | **T** toggles a thick-slab **MIP** (10 → 20 mm → off): nodules stay round bright blobs, vessels become lines — the radiologist's way to check for missed nodules without reading every slice. Display only. |
| Fill the sheet | On **Accept**, empty Type and Lobe are filled from suggestions: Type from the outline's HU (solid / part-solid / ground-glass / calcified, rule of thumb) and Lobe from the AI lobe map. Shown as suggestions; one click to change. |
| Follow-up | A **patient timeline** lists every scan of the patient (Baseline / Follow-up n from the dates); **,** / **.** switch scans. On a follow-up each finding gets a **suggested** earlier match by position (one-to-one, closest first, earlier scans only, ≤ 50 mm), shown as "↔ ▼44% vs Baseline?". A suggestion is never confirmed automatically: **A** approves the measurement only; **M** (or *Same nodule*) confirms the match, *Probably same* records it as uncertain, *Not in earlier scan* records "No earlier match". Comparisons use only **accepted** findings of the earlier scan; when there are none the panel says why and offers *Open it*. |
| Link sheet (optional) | Chrome/Edge: choose a CSV file on this computer and allow the browser to edit it; the browser then rewrites that file with every accepted finding of every scan measured in this browser. After a reload the browser asks again (*Resume writing*). A failed write is shown as an error, never as saved. **Export CSV** (a normal download) always works and is the reliable path. |
| Timed tasks | **▶ Start timed task** / Pause / Resume / Finish in the header. The expert outline is hidden at Start; showing it marks the session *reference-assisted*. Finish records task time (pauses excluded), phases (review / correction / adding / documentation / other, non-overlapping) and counts. **Timing** holds observed manual sessions and computes time saved = manual − assisted only for scans with both (can be negative). AI inference is not part of the task time. |
| Open a scan | **Open CT folder…** / **Open files…** / drag a folder in, or **Load sample CT**. Series are grouped and ordered by 3-D position; gaps and duplicates are flagged. After a reload (⌘R) the last scan reopens at the same slice. |
| Measure | **Click nodule (S)** → click inside the nodule. A classical (non-AI) region-grow builds a 3-D outline and computes RECIST-style long/short axes on the slice where the nodule is largest, plus volume. |
| Correct | **Brush (B)** / **Erase (E)**, size `[` `]`, optional 3-D sphere brush, **Undo (⌘Z)**, **Reset**, threshold slider + re-segment. Every stroke re-measures from the voxels. Edited findings are labelled “edited by researcher”; the original AI measurement is kept and exported next to the edited one. Editing an approved finding sets it back to *↻ Re-approve* and leaves it out of the export until accepted again; undo restores the outline, the numbers and the approval. |
| Review | **Approve (A)** / **Reject (R)**, **N** = next unreviewed. Type, lobe and notes per finding; missing fields are highlighted. |
| Document | **Export CSV**: one row per **accepted** finding (re-exporting writes the same rows, no duplicates): the lab's columns + provenance (measurement source, measured slice, approval time, volume basis, original AI measurement, finding UID, series UID) + follow-up columns. A single-slice outline exports diameters with an empty volume (“single slice: diameters only, no volume”). Opens directly in Excel (UTF-8 BOM, CRLF). PNG screenshot per finding. |
| Follow-up | Earlier measurements come from scans measured in this app or from an imported lab CSV. Each finding shows earlier vs. now, Δ mm / Δ % / Δ volume, and asks “same nodule?” (Confident / Uncertain). |

Every number in the UI says where it came from (click segmentation, manual, edited). Nothing is labelled AI
unless a real model produced it.

## Data & privacy (verified on the live site, 20 Oct 2026)

- **Your scans never leave the browser.** There is no backend. DICOM files are decoded in web workers in the
  page; findings and outlines are saved in the browser's IndexedDB on that computer.
- **Enforced, not just promised:** the site sends a Content-Security-Policy (`connect-src 'self' blob: data:`,
  also present as a `<meta>` tag in the built page). The browser refuses any connection to another server.
  Precisely: the policy still allows requests to the page's *own* origin. On the public site that origin is a static
  host (Cloudflare Pages) with no endpoint that accepts data, and the app's code never sends scan data anywhere; but
  the policy alone is not proof against code that posts to its own origin. For hospital data, the lab can serve the
  built `dist/` folder from its own machine (any static server), so even the origin is local.
- **How this was checked** (built-in browser on the deployed site):
  1. A deliberate `fetch('https://example.com', {method: 'POST'})` from the page was blocked
     (“violates the following Content Security Policy directive: connect-src 'self' blob: data:”).
  2. Loading the sample: the network log contains only `GET` requests to this site (app files and the public
     sample) — no POST, no third-party host.
  3. Opening 41 DICOM files through **Open files…**, then segmenting, editing, approving and exporting:
     **zero** network requests after the files were chosen.
- The only data served by the site is the public sample scan (below).
- Patient name and birth date are never read from the DICOM headers. **Patient ID is read, shown and exported**,
  because it is the first column of the lab's sheet: use de-identified research IDs, in line with your IRB rules.
- **Retention:** findings, outlines, timing sessions and the earlier-scan summaries stay in this browser profile
  (IndexedDB) until the site's data is cleared; *Session summary → Start a new timed run* deletes one scan's findings.
  If the browser cannot save (storage blocked or full), the app says so: export the CSV before closing.
- **The AI (local Python):** downloads its model weights once from the internet; processing a scan is local.
  `scripts/run-ai.sh` turns TotalSegmentator's anonymous usage statistics off before each run. Whether the hospital's
  IT allows this Python install has not been established.

## Data sources & attribution

The sample and the evaluation use public data from The Cancer Imaging Archive (TCIA), under Creative Commons
Attribution (the IDC download metadata states **CC BY 4.0**; older TCIA wiki pages list CC BY 3.0):

- **RIDER Lung CT** — Zhao B, Schwartz LH, Kris MG. *Data From RIDER Lung CT* [Data set]. The Cancer Imaging
  Archive, 2015. <https://doi.org/10.7937/K9/TCIA.2015.U1X8A5NR>
- **RIDER-LungCT-Seg** (expert tumour segmentations, used for evaluation) — Wee L, Aerts H, Kalendralis P,
  Dekker A. *RIDER Lung CT Segmentation Labels from: Decoding tumour phenotype by noninvasive imaging using a
  quantitative radiomics approach* [Data set]. The Cancer Imaging Archive, 2020.
  <https://doi.org/10.7937/tcia.2020.jit9grk8>
- Clark K, et al. *The Cancer Imaging Archive (TCIA): maintaining and operating a public information
  repository.* J Digit Imaging 2013;26(6):1045–1057. <https://doi.org/10.1007/s10278-013-9622-7>

The sample is patient **RIDER-1129164940**, 2006-09-20 TEST scan (series 4, 236 slices, 1.25 mm), with its
RIDER-LungCT-Seg expert outline and a TotalSegmentator `lung_nodules` result computed offline — all downloaded via
the NCI Imaging Data Commons. DICOM files are **not** in this repository.

- **TotalSegmentator** — Wasserthal J, et al. *TotalSegmentator: robust segmentation of 104 anatomic structures in CT
  images.* Radiology: Artificial Intelligence 2023. <https://doi.org/10.1148/ryai.230024> (Apache-2.0).

---

## Use it on your own scans (AI included)

1. Export the CT series to a folder (DICOM files).
2. Run the AI once per scan, on the same computer (nothing is uploaded):
   ```bash
   pip install TotalSegmentator highdicom
   scripts/run-ai.sh /path/to/patient/scan-folder [/path/to/another/scan ...]
   ```
   This writes `<scan>_ai/ai-lung-nodules.dcm` and `ai-lung-lobes.dcm` next to each scan (~2–5 min per scan on an
   Apple Silicon Mac; `DEVICE=cpu` elsewhere).
3. In the app, **Open CT folder…** and choose the **patient folder** (the one containing the scans and their `_ai`
   folders). Every scan appears on the patient timeline; AI candidates and lobes load automatically.

## Run it locally

Needs **Node.js 20.19+** (22 LTS recommended): <https://nodejs.org>.

```bash
git clone https://github.com/yuvAIL/nodule-research-copilot.git
cd nodule-research-copilot
npm install
npm run dev          # → http://127.0.0.1:5173
```

Optional — the **Load sample CT** button locally needs the sample copied into `public/sample/` (gitignored):

```bash
npm run prepare:sample -- "/path/to/RIDER-1129164940/<study>/<series-folder>"
```

### Checks

```bash
npm run check        # TypeScript (strict) + ESLint + unit tests (vitest) + production build
```

Unit tests cover series grouping/ordering, DICOM header mapping, segmentation on synthetic phantoms (ellipse,
rotated anisotropic ellipse, sphere volume, vessel cut, cavity, chest-wall contact), measurement geometry,
the findings store (click / edit / undo / re-segment), CSV round-trip, and follow-up matching.

### Deploy (Cloudflare Pages, static)

```bash
npm run check
npx wrangler pages deploy dist --project-name nodule-research-copilot --branch main
```

`public/_headers` sets the security headers on Cloudflare; the CSP `<meta>` tag is injected at build time
(`vite.config.ts`), so any static host keeps the network restriction.

---

## How it works

- **Viewer:** Cornerstone3D 5.13.1 `StackViewport`; `@cornerstonejs/dicom-image-loader` decodes in web workers
  (rescale slope/intercept applied → Hounsfield units). All `@cornerstonejs/*` packages are pinned to one version.
- **Segmentation** (`src/measure/segment.ts`): threshold (−400 HU default, adjustable) → per-slice lung
  convex-hull constraint (keeps the chest wall out) → adaptive morphological opening (0–6 voxels, first setting
  that does not leak) → 60 mm search radius with leak check → slice-wise hole filling.
- **Measurement** (`src/measure/measure.ts`): long axis = longest in-plane diameter, measured on the axial slice
  where that diameter is largest (ties: larger area); short axis = longest diameter perpendicular to it on the same slice
  (edge-to-edge convention); volume = voxels × voxel volume (col × row spacing × slice spacing), shown in mm³ and mL
  (1 mL = 1000 mm³). Volume is reported only for outlines spanning ≥ 2 slices.
- **Agreement with an expert outline** (`src/reference/compare.ts`): the expert DICOM SEG / RTSTRUCT is rasterised onto
  the CT voxel grid in patient coordinates; Dice is **3-D** over the slices of both outlines, against the segment selected
  in *Expert reference* (the panel shows the file's creator and description, so a manual expert outline and an
  automated one stay distinguishable).
- **Findings** (`src/findings/`): one shared labelmap, per-stroke undo, provenance and review status, timestamps
  (used for the time analysis), saved per series in IndexedDB and restored on reopen.

```
src/
├─ cornerstone/   init, local file → imageId, HU volume builder
├─ dicom/         header parsing, series grouping/ordering (unit-tested)
├─ measure/       segmentation, labelmap, measurement, phantoms (unit-tested)
├─ findings/      store, CSV record/export/import, follow-up priors (unit-tested)
├─ session/       IndexedDB, folder handles, last-session restore, sample loader
├─ components/    viewport, toolbar, findings / follow-up / file panels
└─ App.tsx
```

## Known limitations

- **The AI misses ~1 tumour in 10** (53/59 scans with any overlap; **43/59 with Dice ≥ 0.5**; median Dice 0.76 over
  the 53, misses excluded) and some scans get many small
  unconfirmed candidates — every candidate is reviewed by the researcher, and missed ones are added with one click.
- **The AI does not find ground-glass nodules** (LIDC-IDRI: 0 of 5; part-solid 1 of 3) and outlines small solid
  nodules too small (every found nodule −26 % or worse in volume). See `docs/CHALLENGING_NODULE_EVALUATION.md`.
  The model was trained partly on LIDC-IDRI (subject list not public), so those LIDC detection rates may be
  optimistic; the ground-glass miss stands regardless.
- **When the AI or the click fails, the researcher does it by hand:** search the scan as today (the AI list is not a
  complete list, and hazy nodules are not on it), then outline with the brush (**B**, 3D on) slice by slice, or click
  (**S**) with a lower edge threshold for part-solid or hazy lesions. Check *Extent* and the volume line in the card: an
  outline on one slice gives diameters only, no volume.
- **Click segmentation is classical, not AI**, and is the fallback: about one click in three fails (Dice < 0.2) on the
  RIDER cohort, mostly on lesions touching the chest wall. It is tuned for solid nodules. On large masses touching the hilum
  the outline can follow hilar structures on some slices and needs manual erasing. Ground-glass nodules need a
  lower threshold (slider) and are less reliable. Accuracy vs. expert outlines: see `docs/EVALUATION.md`.
- **Follow-up “same nodule?” suggestion** uses closest patient-coordinate position — a hint, not registration.
  The researcher confirms every match. Tested on one public patient pair only. The sample's two scans use different
  reconstruction kernels (STANDARD vs LUNG); the panel says so, and a measured change is not a growth claim.
- **Link sheet** depends on the browser's File System Access permission (Chrome/Edge); it has not been verified
  end-to-end on a researcher's computer. Use Export CSV when in doubt.
- **Time saved is not measured yet.** The timing tools exist; no researcher session has been recorded.
- Single-frame DICOM Part 10 CT only; no NIfTI, no zip; one axial viewport (no MPR).
- A series is held in browser memory; Chrome/Edge needed for folder re-open after reload (File System Access API).
- Saved work lives in that browser profile on that computer; clearing site data deletes it. Export CSV to keep it.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Blank page, console mentions `events` / `Class extends value undefined` | `npm install`, delete `node_modules/.vite`, `npm run dev`. |
| Black viewport, `no pixel data in NATURALIZED` (dev only) | `npm run dev:clean` once (duplicate metadata registry; see `vite.config.ts`). |
| “Failed to initialise Cornerstone3D” | Use Chrome/Edge with graphics acceleration on (WebGL2). |
| “No displayable DICOM image series were found” | Open **Skipped files** to see why each file was rejected. |
