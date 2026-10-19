# Nodule Research Copilot — notes for Claude Code

Browser-based research prototype (React 19 + TypeScript + Vite 7 + Cornerstone3D 5.13.1).
Research use only; not a medical device.

## Commands
- `npm run dev` — dev server at http://127.0.0.1:5173 (hot reload on save)
- `npm run dev:clean` — same, but rebuilds Vite's dependency pre-bundle (use after dependency or `optimizeDeps` changes)
- `npm run check` — typecheck + lint + unit tests + production build. Run before every commit.

## Rules
- All DICOM processing stays local in the browser. No uploads, no backend.
- Never commit imaging data. Datasets live outside the repo or under `data/` (gitignored).
- Never read or display patient-identifying attributes (name, ID, birth date).
- Do not implement AI detection yet. Do not use mock images to claim DICOM support.
- Use built-in Cornerstone3D functionality wherever possible.
- Keep all `@cornerstonejs/*` packages on the same exact version.
- `@cornerstonejs/dicom-image-loader` must stay in `optimizeDeps.exclude`, and
  `@cornerstonejs/metadata` / `@cornerstonejs/utils` must stay in `optimizeDeps.include`
  (otherwise the dev server ends up with two metadata registries and renders black images).
