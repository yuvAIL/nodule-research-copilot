# Nodule Research Copilot

A browser tool for a thoracic oncology research lab: open a chest CT, click a nodule, get a 3-D outline with
long axis, short axis and volume in millimetres, correct it with a brush, approve it, and export the lab's
spreadsheet row, with earlier measurements of the same patient shown next to the new ones.

> **Research prototype. Not a medical device. Not for diagnosis or clinical decisions.**

**Live:** <https://nodule-research-copilot.pages.dev> (Chrome or Edge recommended). Click **Load sample CT**
to try it on a public, de-identified scan.

---

## What it does

| Step | In the app |
| --- | --- |
| Open a scan | **Open CT folder…** / **Open files…** / drag a folder in, or **Load sample CT**. Series are grouped and ordered by 3-D position; gaps and duplicates are flagged. After a reload (⌘R) the last scan reopens at the same slice. |
| Measure | **Click nodule (S)** → click inside the nodule. A classical (non-AI) region-grow builds a 3-D outline and computes RECIST-style long/short axes on the slice where the nodule is largest, plus volume. |
| Correct | **Brush (B)** / **Erase (E)**, size `[` `]`, optional 3-D sphere brush, **Undo (⌘Z)**, **Reset**, threshold slider + re-segment. Edited findings are labelled “edited by researcher”. |
| Review | **Approve (A)** / **Reject (R)**, **N** = next unreviewed. Type, lobe and notes per finding; missing fields are highlighted. |
| Document | **Export CSV**: the lab's columns + provenance (measurement source, measured slice, approval time) + follow-up columns. Opens directly in Excel (UTF-8 BOM, CRLF). PNG screenshot per finding. |
| Follow-up | Earlier measurements come from scans measured in this app or from an imported lab CSV. Each finding shows earlier vs. now, Δ mm / Δ % / Δ volume, and asks “same nodule?” (Confident / Uncertain). |

Every number in the UI says where it came from (click segmentation, manual, edited). Nothing is labelled AI
unless a real model produced it.

## Data & privacy (verified on the live site, 20 Oct 2026)

- **Your scans never leave the browser.** There is no backend. DICOM files are decoded in web workers in the
  page; findings and outlines are saved in the browser's IndexedDB on that computer.
- **Enforced, not just promised:** the site sends a Content-Security-Policy (`connect-src 'self' blob: data:`,
  also present as a `<meta>` tag in the built page). The browser refuses any connection to another server.
- **How this was checked** (built-in browser on the deployed site):
  1. A deliberate `fetch('https://example.com', {method: 'POST'})` from the page was blocked
     (“violates the following Content Security Policy directive: connect-src 'self' blob: data:”).
  2. Loading the sample: the network log contains only `GET` requests to this site (app files and the public
     sample) — no POST, no third-party host.
  3. Opening 41 DICOM files through **Open files…**, then segmenting, editing, approving and exporting:
     **zero** network requests after the files were chosen.
- The only data served by the site is the public sample scan (below).
- Patient name, patient ID and birth date are not displayed. Use de-identified data in line with your IRB rules.

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

The sample is patient **RIDER-1129164940**, 2006-09-05, series 100 (262 slices, 1.25 mm), downloaded via the
NCI Imaging Data Commons. DICOM files are **not** in this repository.

---

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
- **Measurement** (`src/measure/measure.ts`): long axis = largest in-plane extent on the slice with the largest
  area, short axis = largest extent perpendicular to it (edge-to-edge convention), volume = voxels × voxel volume.
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

- **Segmentation is classical, not AI**, and is tuned for solid nodules. On large masses touching the hilum
  the outline can follow hilar structures on some slices and needs manual erasing. Ground-glass nodules need a
  lower threshold (slider) and are less reliable. Accuracy vs. expert outlines: see `docs/EVALUATION.md`.
- **Follow-up “same nodule?” suggestion** uses closest patient-coordinate position — a hint, not registration.
  The researcher confirms every match.
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
