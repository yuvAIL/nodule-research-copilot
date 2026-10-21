#!/usr/bin/env node
/**
 * Context for the AI's Dice: other outlines of the same tumour vs the RIDER-LungCT-Seg MANUAL outline.
 *
 *   npm run eval:readers -- <folder with one RIDER patient (CT + all SEG series)> [--out docs/eval]
 *
 * Every SEG in the folder (QIBA CT 1B readers, QIN CT challenge algorithms, ...) is rasterized onto each CT scan
 * of the patient that has a RIDER-LungCT-Seg outline, and compared with its MANUAL segment using the app's code.
 * Some files carry no series reference; an outline counts for the scan where it overlaps the expert most
 * (on the other scan of the same day it only overlaps partly, Dice ≈ 0.3).
 */
const fs = require('node:fs');
const path = require('node:path');
const { seriesDirs, dcmFiles, header, loadCt } = require('./lib/dicom-node.cjs');

const BUILD = path.resolve(__dirname, '..', '.eval-build');
fs.writeFileSync(path.join(BUILD, 'package.json'), '{ "type": "commonjs" }\n');
const { parseReference } = require(path.join(BUILD, 'reference/parseReference.js'));
const { rasterizeReference, segmentLabelmap, defaultSegment } = require(path.join(BUILD, 'reference/rasterize.js'));
const { compareToReference } = require(path.join(BUILD, 'reference/compare.js'));

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const OUT = path.resolve(oi >= 0 ? args.splice(oi, 2)[1] : 'docs/eval');
const ROOT = args[0];
if (!ROOT) {
  console.error('Usage: npm run eval:readers -- <patient folder> [--out docs/eval]');
  process.exit(1);
}

const ct = new Map();
const segs = [];
for (const d of seriesDirs(path.resolve(ROOT))) {
  const f = dcmFiles(d)[0];
  if (!f) continue;
  const ds = header(f);
  const m = ds.string('x00080060');
  if (m === 'CT') ct.set(ds.string('x0020000e'), d);
  if (m === 'SEG') {
    const label = ((ds.string('x0008103e') || '').trim() || (ds.string('x00700084') || '').trim()).replace(/segmentation result$/, '').trim();
    segs.push({ file: f, label, ref: parseReference(new Uint8Array(fs.readFileSync(f))) });
  }
}
const experts = segs.filter((s) => /^RIDER-.*_(TEST|RETEST)$/.test(s.ref.seriesDescription || ''));
const results = [];
for (const ex of experts) {
  const scan = /RETEST$/.test(ex.ref.seriesDescription) ? 'RETEST' : 'TEST';
  const v = loadCt(ct.get(ex.ref.referencedSeriesUid));
  const exp = defaultSegment(rasterizeReference(ex.ref, v).segments);
  const expLm = segmentLabelmap(v, exp);
  for (const s of segs) {
    if (s === ex || experts.includes(s)) continue;
    if (s.ref.referencedSeriesUid && s.ref.referencedSeriesUid !== ex.ref.referencedSeriesUid) continue;
    for (const seg of rasterizeReference(s.ref, v).segments) {
      if (!seg.voxelCount || /^lung_/.test(seg.name)) continue;
      const a = compareToReference(segmentLabelmap(v, seg), 1, expLm, 1, v, { kMin: Math.min(seg.kMin, exp.kMin), kMax: Math.max(seg.kMax, exp.kMax) });
      results.push({ scan, source: s.label, file: path.basename(path.dirname(s.file)), algorithmType: seg.algorithmType ?? '', dice: +a.dice.toFixed(3) });
    }
  }
}
// One outline per (source, scan): readers' files without a series reference are assigned by best overlap.
const best = new Map();
for (const r of results) {
  const k = `${r.scan}|${r.source}`;
  if (!best.has(k) || best.get(k).dice < r.dice) best.set(k, r);
}
const rows = [...best.values()].sort((a, b) => a.scan.localeCompare(b.scan) || a.source.localeCompare(b.source));
for (const r of rows) console.log(`${r.scan.padEnd(6)} ${r.source.padEnd(46)} ${r.algorithmType.padEnd(14)} Dice ${r.dice.toFixed(3)}`);
fs.mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, 'readers-vs-expert.json');
fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), reference: 'RIDER-LungCT-Seg MANUAL segment', rows, allComparisons: results }, null, 1));
console.log(`→ ${outFile}`);
