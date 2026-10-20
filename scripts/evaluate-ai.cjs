#!/usr/bin/env node
/**
 * AI candidates vs expert outlines (RIDER-LungCT-Seg), offline.
 *
 *   npm run eval:ai -- <expert data folder> <AI results folder> [--out docs/eval] [--budget-sec 140]
 *
 * AI results = DICOM SEG files from TotalSegmentator `lung_nodules`, one per CT, named CT_<SeriesInstanceUID>.dcm.
 * They are turned into candidates with the SAME code as the app (src/ai/candidates.ts).
 *
 * Definitions (fixed before looking at results):
 *  - Hit: at least one candidate overlaps the expert MANUAL outline (≥ 1 shared voxel).
 *  - Dice / long axis: of the candidate that overlaps the expert outline most.
 *  - Other candidates: do not overlap the expert outline. The dataset labels one primary tumour per patient,
 *    so these are "unconfirmed" (could be false positives or unlabelled real nodules) — not called false positives.
 */
const fs = require('node:fs');
const path = require('node:path');
const { seriesDirs, dcmFiles, header, loadCt } = require('./lib/dicom-node.cjs');

const BUILD = path.resolve(__dirname, '..', '.eval-build');
fs.writeFileSync(path.join(BUILD, 'package.json'), '{ "type": "commonjs" }\n');
const { parseReference } = require(path.join(BUILD, 'reference/parseReference.js'));
const { rasterizeReference, segmentLabelmap, defaultSegment } = require(path.join(BUILD, 'reference/rasterize.js'));
const { compareToReference, overlapCount } = require(path.join(BUILD, 'reference/compare.js'));
const { candidatesFromSegments } = require(path.join(BUILD, 'ai/candidates.js'));
const { Labelmap } = require(path.join(BUILD, 'measure/labelmap.js'));
const { measureLabel } = require(path.join(BUILD, 'measure/measure.js'));

const args = process.argv.slice(2);
const take = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const OUT = path.resolve(take('--out', 'docs/eval'));
const BUDGET_MS = Number(take('--budget-sec', 'Infinity')) * 1000;
const [ROOT, AI_DIR] = args;
if (!ROOT || !AI_DIR) {
  console.error('Usage: npm run eval:ai -- <expert data folder> <AI results folder> [--out docs/eval]');
  process.exit(1);
}
const CACHE = path.join(OUT, 'cache-ai');
fs.mkdirSync(CACHE, { recursive: true });
const startedAt = Date.now();
let partial = false;

const byUid = new Map();
const experts = [];
for (const d of seriesDirs(path.resolve(ROOT))) {
  let ds;
  try {
    ds = header(dcmFiles(d)[0]);
  } catch {
    continue;
  }
  byUid.set(ds.string('x0020000e'), d);
  if (ds.string('x00080060') === 'SEG' && /^RIDER-.*_(TEST|RETEST)$/.test((ds.string('x0008103e') || '').trim())) experts.push(dcmFiles(d)[0]);
}

const rows = [];
for (const file of experts.sort()) {
  const cacheFile = path.join(CACHE, `${path.basename(path.dirname(file))}.json`);
  if (fs.existsSync(cacheFile)) {
    rows.push(JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
    continue;
  }
  const ref = parseReference(new Uint8Array(fs.readFileSync(file)));
  const desc = ref.seriesDescription;
  const row = { patient: desc.replace(/_\d{8}_(TEST|RETEST)$/, ''), timepoint: /RETEST$/.test(desc) ? 'RETEST' : 'TEST' };
  const aiFile = path.join(AI_DIR, `CT_${ref.referencedSeriesUid}.dcm`);
  if (!fs.existsSync(aiFile)) {
    rows.push({ ...row, status: 'AI result not available yet' }); // not cached: retried next run
    continue;
  }
  if (Date.now() - startedAt > BUDGET_MS) {
    partial = true;
    continue;
  }
  const v = loadCt(byUid.get(ref.referencedSeriesUid));
  const expert = defaultSegment(rasterizeReference(ref, v).segments);
  const expertLm = segmentLabelmap(v, expert);
  // Expert size is needed for every scan (also misses), to group nodules vs masses.
  const expertM = measureLabel(expertLm, v, 1, { kMin: expert.kMin, kMax: expert.kMax });
  const ai = parseReference(new Uint8Array(fs.readFileSync(aiFile)));
  const set = candidatesFromSegments(rasterizeReference(ai, v).segments, v);
  const cands = set?.candidates ?? [];
  let best;
  let bestOverlap = 0;
  let unconfirmed = 0;
  for (const c of cands) {
    const o = overlapCount(expertLm, 1, c.voxels);
    if (o > bestOverlap) {
      bestOverlap = o;
      best = c;
    }
    if (o === 0) unconfirmed++;
  }
  let agreement;
  if (best) {
    const lm = new Labelmap(v);
    for (const p of best.voxels) lm.data[p] = 1;
    agreement = compareToReference(lm, 1, expertLm, 1, v, { kMin: Math.min(best.kMin, expert.kMin), kMax: Math.max(best.kMax, expert.kMax) });
  }
  const result = {
    ...row,
    status: 'evaluated',
    model: [ai.manufacturer, ai.softwareVersion].filter(Boolean).join(' '),
    candidates: cands.length,
    hiddenTiny: set?.hiddenTiny ?? 0,
    hit: !!best,
    unconfirmed,
    dice: agreement?.dice,
    aiLongMm: agreement?.app.longMm,
    expertLongMm: expertM?.longMm,
    longDiffMm: agreement?.longDiffMm,
    volDiffPct: agreement?.volumeDiffPct,
  };
  fs.writeFileSync(cacheFile, JSON.stringify(result));
  rows.push(result);
  console.log(`${row.patient} ${row.timepoint.padEnd(6)} candidates ${cands.length} | hit ${result.hit ? 'yes' : 'NO '} | Dice ${result.dice?.toFixed(2) ?? '–'} | unconfirmed ${unconfirmed}`);
}

const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const done = rows.filter((r) => r.status === 'evaluated');
const group = (rs) => ({
  scans: rs.length,
  hits: rs.filter((r) => r.hit).length,
  diceMedianOfHits: median(rs.filter((r) => r.hit).map((r) => r.dice)),
  diceAtLeast07: rs.filter((r) => (r.dice ?? 0) >= 0.7).length,
  absLongDiffMmMedian: median(rs.filter((r) => r.hit).map((r) => Math.abs(r.longDiffMm))),
  absVolDiffPctMedian: median(rs.filter((r) => r.hit).map((r) => Math.abs(r.volDiffPct))),
  candidatesPerScanMedian: median(rs.map((r) => r.candidates)),
  unconfirmedPerScanMedian: median(rs.map((r) => r.unconfirmed)),
});
const summary = {
  generatedAt: new Date().toISOString(),
  complete: !partial && done.length === rows.length,
  pending: rows.length - done.length,
  all: group(done),
  'nodules (expert long axis ≤ 30 mm)': group(done.filter((r) => (r.expertLongMm ?? Infinity) <= 30)),
  'masses (> 30 mm)': group(done.filter((r) => (r.expertLongMm ?? 0) > 30)),
  misses: done.filter((r) => !r.hit).map((r) => `${r.patient} ${r.timepoint}`),
};
const cols = ['patient', 'timepoint', 'status', 'model', 'candidates', 'hiddenTiny', 'hit', 'unconfirmed', 'dice', 'aiLongMm', 'expertLongMm', 'longDiffMm', 'volDiffPct'];
const fmt = (x) => (typeof x === 'number' ? (Number.isInteger(x) ? String(x) : x.toFixed(3)) : x === undefined ? '' : `"${String(x).replace(/"/g, '""')}"`);
fs.writeFileSync(path.join(OUT, 'ai-results.csv'), [cols.join(','), ...rows.map((r) => cols.map((c) => fmt(r[c])).join(','))].join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'ai-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log('\n' + JSON.stringify(summary, null, 2));
if (partial) console.log('\nPARTIAL RUN (time budget reached) — run the same command again to continue.');
