# Nodule Research Copilot — Milestone 1: Local CT Viewer

A browser-based research prototype for a thoracic oncology lab. This milestone is a
CT viewer that opens a **real DICOM CT series from your computer**, displays it with a
lung window, and lets you scroll, zoom and pan while showing the slice number and scan
metadata.

> **Research use only. Not a medical device. Not for diagnosis or clinical decisions.**

Built with React 19, TypeScript, Vite 7 and Cornerstone3D 5.x
(`@cornerstonejs/core`, `@cornerstonejs/tools`, `@cornerstonejs/dicom-image-loader`).

---

## 1. One-time setup

### 1.1 Install Node.js (includes `npm`)

You need **Node.js 20.19 or newer** (Node 22 LTS recommended). Vite 7 will not run on older versions.

- **Windows / macOS:** download the *LTS* installer from <https://nodejs.org> and run it.
- **macOS/Linux with nvm (optional):** `nvm install 22 && nvm use 22`
  (this repo contains an `.nvmrc`, so `nvm use` inside the folder also works).

Check it worked — open a **new** terminal (macOS: *Terminal*; Windows: *PowerShell*) and run:

```bash
node --version    # should print v20.19.x, v22.x or newer
npm --version     # should print 10.x or newer
```

### 1.2 Install the project's libraries

In the terminal, go into the project folder (the one containing `package.json`) and install:

```bash
cd path/to/nodule-research-copilot
npm install
```

This downloads all libraries into a `node_modules` folder (a few hundred MB — Cornerstone3D
includes the vtk.js rendering library and image codecs). It takes 1–3 minutes the first time.
Warnings such as `npm warn deprecated …` are normal; errors are not (see Troubleshooting).

---

## 2. Run the viewer

```bash
npm run dev
```

The terminal prints an address, normally **<http://127.0.0.1:5173/>**. Open it in **Chrome or
Edge** (recommended; Firefox also works). Leave the terminal running while you use the app —
press `Ctrl + C` in the terminal to stop it.

### Load a CT series

1. Click **Choose folder…** and select the folder that contains the series' DICOM files
   (sub-folders are scanned too), **or** drag the folder onto the drop zone, **or** use
   **Choose files…** to pick individual files.
2. The app reads the DICOM headers, groups files into series, and opens the largest CT series.
   If the folder contains several series, pick one from the **Series** list.
3. The image opens with the **lung window (W 1500 / L −600 HU)**.

Your browser may ask you to confirm uploading a folder — that wording is the browser's; the files
are only read locally by this page and are **never sent anywhere**.

### Controls

| Action | Mouse / keyboard |
| --- | --- |
| Next / previous slice | Mouse wheel, ↑ / ↓ (or ← / →), or the slider below the image |
| Jump 10 % of the stack | Page Up / Page Down |
| First / last slice | Home / End |
| Left-drag | Window/Level (default), or Pan / Zoom — chosen in the toolbar |
| Pan | Middle-button drag (always) |
| Zoom | Right-button drag (always) |
| Window presets | Toolbar: Lung (1500/−600), Mediastinum (350/50), Bone (1800/400) |
| Reset zoom and pan | **Reset view** |

Keyboard shortcuts work when the image has focus (click it once). Trackpad users: choose
**Pan** or **Zoom** for the left button in the toolbar.

**Slice order:** for axial series, *slice 1 is the most superior (head-end) slice*. Slices are
ordered by their 3-D position (ImagePositionPatient projected on the slice normal), falling back
to InstanceNumber, then file name. The method used is shown under **Geometry → Slice order**.

### What is shown

- **On the image:** slice *n / N*, InstanceNumber, SliceLocation, current window width/level,
  and zoom.
- **Scan panel:** modality, study date and description, series number/description, scanner,
  kVp, reconstruction kernel, contrast agent, image type.
- **Geometry panel:** number of slices, matrix, pixel spacing, slice thickness, measured slice
  spacing, orientation, slice-ordering method, transfer syntax (encoding), Series UID.
- **Current slice panel:** InstanceNumber, SliceLocation, ImagePositionPatient, file path.
- **Warnings:** e.g. missing slices (gaps), duplicated positions, non-uniform spacing, non-CT
  modality, images excluded because their size/orientation differs (localizers).
- **Skipped files:** every file that was not used, with the reason.

Patient name, patient ID and birth date are deliberately **not read into the app or displayed**.

---

### Day-to-day development

Leave `npm run dev` running. Saving any file under `src/` updates the open page automatically
(hot reload); saving `vite.config.ts` restarts the server by itself. Only after changing
dependencies or `optimizeDeps`, stop the server and start it once with `npm run dev:clean`.

Keep DICOM data outside this folder (for example `~/Data/RIDER`). If you keep it inside, put it
under `data/`, which Git and the dev-server file watcher both ignore.

## 3. Checks (run these before committing changes)

```bash
npm run typecheck   # TypeScript, strict mode
npm run lint        # ESLint
npm run test        # unit tests (series grouping, slice ordering, window presets)
npm run check       # all of the above + a production build
```

Production build and local preview of that build:

```bash
npm run build       # output in dist/
npm run preview     # serves dist/ at http://127.0.0.1:4173
```

---

## 4. Project structure

```
nodule-research-copilot/
├─ index.html
├─ package.json            scripts and pinned dependency ranges
├─ vite.config.ts          Vite settings required by Cornerstone3D (workers, codecs, dicom-parser)
├─ tsconfig*.json          TypeScript settings (strict)
├─ eslint.config.js
└─ src/
   ├─ main.tsx             React entry point
   ├─ App.tsx              layout and loading workflow
   ├─ styles.css
   ├─ cornerstone/
   │  ├─ initCornerstone.ts   one-time init of core, tools and DICOM image loader
   │  └─ localImageIds.ts     registers local File objects → `dicomfile:` imageIds
   ├─ dicom/                  framework-independent, unit-tested DICOM logic
   │  ├─ collectFiles.ts      folder / drag-and-drop traversal, obvious non-DICOM filtering
   │  ├─ parseHeader.ts       header-only parsing with dicom-parser (stops at PixelData)
   │  ├─ headerMapping.ts     DICOM tags → typed DicomHeader
   │  ├─ seriesBuilder.ts     grouping, de-duplication, slice ordering, spacing checks
   │  └─ types.ts
   ├─ viewer/windowPresets.ts HU window presets
   └─ components/
      ├─ CtViewport.tsx       Cornerstone3D stack viewport + tools (scroll, W/L, pan, zoom)
      ├─ Toolbar.tsx
      ├─ FileLoader.tsx
      └─ MetadataPanel.tsx
```

How it uses Cornerstone3D (no custom rendering or decoding):

- `@cornerstonejs/dicom-image-loader` decodes pixels in web workers. Local files are registered
  with `wadouri.fileManager.add(file)`, which yields `dicomfile:` imageIds. Rescale
  slope/intercept are applied by the loader, so window values are in Hounsfield units.
- A `StackViewport` (`Enums.ViewportType.STACK`) displays the slices.
- Interaction uses built-in tools: `StackScrollTool` (wheel), `WindowLevelTool`, `PanTool`,
  `ZoomTool`, managed by a `ToolGroup`.
- The app reads headers itself (with `dicom-parser`, which the loader also uses) only to group
  and sort files before handing them to Cornerstone.

---

## 5. Data handling

- All processing happens in your browser. There is no backend and no network upload.
- The dev server binds to `127.0.0.1` only, so other machines on your network cannot reach it.
- `.gitignore` excludes `data/` and `*.dcm` — keep imaging data outside the repository.
- The files themselves still contain whatever identifiers they were exported with. Use
  de-identified data in line with your lab's IRB/data-governance rules.

**Public test data:** LIDC-IDRI (thoracic CT with annotated lung nodules) is available from The
Cancer Imaging Archive (TCIA). Download one series and point the viewer at its folder.

---

## 6. Known limitations (milestone 1)

- **Pinned Cornerstone3D 5.13.1.** All `@cornerstonejs/*` packages must stay on the same exact
  version; upgrade them together and re-test loading a real series.
- **Single-frame DICOM only.** Enhanced/multi-frame CT (one file with many frames) is detected and
  skipped with a message.
- **DICOM Part 10 files only** (files with the 128-byte preamble and `DICM` marker). Raw data sets
  without a preamble are skipped.
- **No archives / NIfTI.** `.zip` files must be extracted first; NIfTI (`.nii`, `.nii.gz`) is not
  supported yet. `DICOMDIR` index files are ignored (the image files are scanned directly).
- **One series at a time, one axial-plane viewport.** No MPR (coronal/sagittal reformats), no 3-D.
- **No measurements, HU probe or annotations yet**, and no AI detection (by design).
- **Memory:** a series is held in browser memory. Very large series (thousands of slices) may be
  slow on machines with little RAM. Switching series releases the previous series' cached images.
- **Requires WebGL2** (any recent desktop browser with hardware acceleration enabled).
- Compressed transfer syntaxes (JPEG, JPEG-LS, JPEG 2000, HTJ2K, RLE) are decoded by
  Cornerstone's bundled codecs; unusual or broken encodings show an error instead of an image.
- Slice-order and spacing warnings are heuristics to help spot incomplete exports; they are not a
  validation of the data.

---

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `npm: command not found` / `'npm' is not recognized` | Node.js is not installed or the terminal was opened before installing — reopen the terminal. |
| `Unsupported engine` or Vite says Node is too old | Install Node 22 LTS (section 1.1). |
| `npm install` fails with `ERESOLVE` | Run `npm install --legacy-peer-deps` and report the original error message. |
| Blank white page; console shows `Module "events" has been externalized…` and `Class extends value undefined` | A dependency imports Node's `events` module. The project depends on the browser-compatible [`events`](https://www.npmjs.com/package/events) package and `vite.config.ts` routes `events`/`node:events` to it. Run `npm install`, delete `node_modules/.vite`, then `npm run dev`. `npm run diagnose:builtins` lists which installed packages import Node built-ins. |
| Black viewport; console shows `loadImageFromNaturalizedMetadata: no pixel data in NATURALIZED` | The dev server pre-bundled two copies of `@cornerstonejs/metadata`. Fixed in `vite.config.ts` (`optimizeDeps.include`). After changing that file, run `npm run dev:clean` once. |
| Page is blank / "Failed to initialise Cornerstone3D" | Use Chrome or Edge; enable *Use graphics acceleration* in browser settings. |
| "Failed to fetch dynamically imported module" after an update | Stop the server, delete `node_modules/.vite`, run `npm run dev` again. |
| Port 5173 already in use | Vite picks the next free port automatically — use the address it prints. |
| "No displayable DICOM image series were found" | Open **Skipped files** to see why each file was rejected. |
