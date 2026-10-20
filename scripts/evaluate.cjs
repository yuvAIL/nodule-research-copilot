#!/usr/bin/env node
/**
 * Offline accuracy & repeatability evaluation against public expert outlines.
 *
 *   npm run eval -- <folder with RIDER-LungCT-Seg SEGs + their CT series> [--out docs/eval]
 *
 * Uses the SAME segmentation / measurement / reference code as the app (compiled
 * from src/ by `tsc -p tsconfig.eval.json`), on the researcher's computer only.
 *
 * Protocol (fixed before looking at the multi-patient results):
 *  - Expert truth = the segment the RIDER-LungCT-Seg SEG labels MANUAL (SegmentAlgorithmType),
 *    TEST and RETEST scan. (The RTSTRUCT version names the two outlines differently; the SEG
 *    attribute is used because it is a coded field, not free text.)
 *  - Simulated researcher clicks: the outline's centre (snapped to the nearest voxel of the
 *    outline above the edge threshold) + 4 random voxels of the outline above the threshold
 *    (deterministic per series).
 *  - Default app settings only (threshold −400 HU, 60 mm search radius). No per-case tuning.
 *  - Split: patients sorted by ID; every 3rd (index % 3 === 0) is DEVELOPMENT (may be used to
 *    improve the algorithm), the rest is HELD-OUT (only reported).
 */
const fs = require('node:fs');
const path = require('node:path');
const dicomParser = require('dicom-parser');

const BUILD = path.resolve(__dirname, '..', '.eval-build');
// The project is "type": "module"; the compiled evaluation build is CommonJS.
fs.writeFileSync(path.join(BUILD, 'package.json'), '{ "type": "commonjs" }\n');
const { parseReference } = require(path.join(BUILD, 'reference/parseReference.js'));
const { rasterizeReference, segmentLabelmap, defaultSegment } = require(path.join(BUILD, 'reference/rasterize.js'));
const { compareToReference } = require(path.join(BUILD, 'reference/compare.js'));
const { segmentFromSeed, DEFAULT_THRESHOLD_HU } = require(path.join(BUILD, 'measure/segment.js'));
const { Labelmap } = require(path.join(BUILD, 'measure/labelmap.js'));
const { measureLabel } = require(path.join(BUILD, 'measure/measure.js'));

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = path.resolve(outIdx >= 0 ? args.splice(outIdx, 2)[1] : 'docs/eval');
// Long runs can be split: stop after N seconds; finished series are cached and skipped next time.
const budgetIdx = args.indexOf('--budget-sec');
const BUDGET_MS = budgetIdx >= 0 ? Number(args.splice(budgetIdx, 2)[1]) * 1000 : Infinity;
const CACHE = path.join(OUT, 'cache');
fs.mkdirSync(CACHE, { recursive: true });
const startedAt = Date.now();
let partial = false;
const ROOT = args[0];
if (!ROOT) {
  console.error('Usage: npm run eval -- <data folder> [--out docs/eval]');
  process.exit(1);
}
const SEEDS_PER_SERIES = 5;
const UNCOMPRESSED = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1']);

// ── data discovery ────────────────────────────────────────────────
function seriesDirs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...seriesDirs(p));
  }
  if (fs.readdirSync(dir).some((f) => f.toLowerCase().endsWith('.dcm'))) out.push(dir);
  return out;
}
const dcmFiles = (d) => fs.readdirSync(d).filter((f) => f.toLowerCase().endsWith('.dcm')).map((f) => path.join(d, f));
const header = (file) => dicomParser.parseDicom(new Uint8Array(fs.readFileSync(file)), { untilTag: 'x7fe00010' });

function loadCt(dir) {
  const slices = dcmFiles(dir).map((f) => {
    const b = new Uint8Array(fs.readFileSync(f));
    const ds = dicomParser.parseDicom(b);
    return { b, ds, ipp: ds.string('x00200032').split('\\').map(Number) };
  });
  const ds0 = slices[0].ds;
  const ts = ds0.string('x00020010');
  if (!UNCOMPRESSED.has(ts)) throw new Error(`compressed CT (${ts}) not supported by this script`);
  const iop = ds0.string('x00200037').split('\\').map(Number);
  const r = iop.slice(0, 3);
  const c = iop.slice(3, 6);
  const n = [r[1] * c[2] - r[2] * c[1], r[2] * c[0] - r[0] * c[2], r[0] * c[1] - r[1] * c[0]];
  const along = (s) => s.ipp[0] * n[0] + s.ipp[1] * n[1] + s.ipp[2] * n[2];
  slices.sort((a, b) => along(b) - along(a)); // same order as the app: head end first
  const rows = ds0.uint16('x00280010');
  const cols = ds0.uint16('x00280011');
  const ps = ds0.string('x00280030').split('\\').map(Number);
  const gaps = slices.slice(1).map((s, k) => Math.abs(along(s) - along(slices[k]))).sort((a, b) => a - b);
  const hu = new Int16Array(rows * cols * slices.length);
  slices.forEach((s, k) => {
    const el = s.ds.elements.x7fe00010;
    const signed = s.ds.uint16('x00280103') === 1;
    const slope = s.ds.floatString('x00281053') ?? 1;
    const icpt = s.ds.floatString('x00281052') ?? 0;
    const dv = new DataView(s.b.buffer, s.b.byteOffset + el.dataOffset, el.length);
    for (let p = 0; p < rows * cols; p++) {
      const v = signed ? dv.getInt16(p * 2, true) : dv.getUint16(p * 2, true);
      hu[k * rows * cols + p] = Math.max(-32768, Math.min(32767, Math.round(v * slope + icpt)));
    }
  });
  return {
    cols, rows, slices: slices.length, colSpacing: ps[1], rowSpacing: ps[0],
    sliceSpacing: gaps[Math.floor(gaps.length / 2)], origins: slices.map((s) => s.ipp), rowCosines: r, colCosines: c, hu,
  };
}

// ── helpers ───────────────────────────────────────────────────────
function rng(seedText) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => ((h = (Math.imul(h, 1103515245) + 12345) >>> 0) / 4294967296);
}
const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const q = (xs, f) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(f * (s.length - 1) + 0.5))] : NaN;
};

// ── main ──────────────────────────────────────────────────────────
const dirs = seriesDirs(path.resolve(ROOT));
const byUid = new Map();
const experts = [];
for (const d of dirs) {
  const f = dcmFiles(d)[0];
  let ds;
  try {
    ds = header(f);
  } catch {
    continue;
  }
  byUid.set(ds.string('x0020000e'), d);
  if (ds.string('x00080060') === 'SEG' && /^RIDER-.*_(TEST|RETEST)$/.test((ds.string('x0008103e') || '').trim())) experts.push(f);
}
console.log(`${experts.length} expert SEG files, ${byUid.size} series found under ${ROOT}`);

const rows = [];
for (const file of experts.sort()) {
  const cacheFile = path.join(CACHE, `${path.basename(path.dirname(file))}.json`);
  if (fs.existsSync(cacheFile)) {
    rows.push(...JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
    continue;
  }
  if (Date.now() - startedAt > BUDGET_MS) {
    partial = true;
    continue;
  }
  const before = rows.length;
  const ref = parseReference(new Uint8Array(fs.readFileSync(file)));
  const desc = ref.seriesDescription;
  const patient = desc.replace(/_\d{8}_(TEST|RETEST)$/, '');
  const timepoint = /RETEST$/.test(desc) ? 'RETEST' : 'TEST';
  const ctDir = byUid.get(ref.referencedSeriesUid);
  if (!ctDir) {
    rows.push({ patient, timepoint, error: 'CT series not downloaded' });
    fs.writeFileSync(cacheFile, JSON.stringify(rows.slice(before)));
    continue;
  }
  let v;
  try {
    v = loadCt(ctDir);
  } catch (e) {
    rows.push({ patient, timepoint, error: e.message });
    fs.writeFileSync(cacheFile, JSON.stringify(rows.slice(before)));
    continue;
  }
  const raster = rasterizeReference(ref, v);
  const manual = defaultSegment(raster.segments);
  const auto = raster.segments.find((s) => s !== manual && /AUTO/i.test(s.algorithmType ?? '') && s.voxelCount);
  if (!manual) {
    rows.push({ patient, timepoint, error: 'empty expert outline' });
    fs.writeFileSync(cacheFile, JSON.stringify(rows.slice(before)));
    continue;
  }
  const expertLm = segmentLabelmap(v, manual);
  const L = 1;
  const range = { kMin: manual.kMin, kMax: manual.kMax };
  const expertM = measureLabel(expertLm, v, L, range);
  const S = v.cols * v.rows;
  const inside = Array.from(manual.voxels);
  const dense = inside.filter((p) => v.hu[p] > DEFAULT_THRESHOLD_HU);
  let ci = 0, cj = 0, ck = 0;
  for (const p of inside) {
    ck += Math.floor(p / S);
    cj += Math.floor((p % S) / v.cols);
    ci += p % v.cols;
  }
  const c = [ci / inside.length, cj / inside.length, ck / inside.length];
  let centre = dense[0];
  let bestD = Infinity;
  for (const p of dense) {
    const d = (p % v.cols - c[0]) ** 2 + (Math.floor((p % S) / v.cols) - c[1]) ** 2 + ((Math.floor(p / S) - c[2]) * v.sliceSpacing / v.colSpacing) ** 2;
    if (d < bestD) {
      bestD = d;
      centre = p;
    }
  }
  const rand = rng(desc);
  const seedVoxels = [centre];
  while (seedVoxels.length < SEEDS_PER_SERIES && dense.length) seedVoxels.push(dense[Math.floor(rand() * dense.length)]);

  let autoAgreement;
  if (auto) {
    const both = { kMin: Math.min(auto.kMin, manual.kMin), kMax: Math.max(auto.kMax, manual.kMax) };
    autoAgreement = compareToReference(segmentLabelmap(v, auto), 1, expertLm, L, v, both);
  }

  seedVoxels.forEach((p, seedIndex) => {
    const seed = { i: p % v.cols, j: Math.floor((p % S) / v.cols), k: Math.floor(p / S) };
    const t0 = performance.now();
    const res = segmentFromSeed(v, seed, {});
    const ms = performance.now() - t0;
    const row = {
      patient, timepoint, seedIndex, seed: `${seed.i}/${seed.j}/${seed.k}`, ms: Math.round(ms),
      expertLongMm: expertM.longMm, expertShortMm: expertM.shortMm, expertVolMl: expertM.volumeMm3 / 1000,
      riderAutoDice: autoAgreement?.dice,
    };
    if (!res.ok) {
      rows.push({ ...row, error: res.reason });
      return;
    }
    const app = new Labelmap(v);
    let kMin = Infinity, kMax = -Infinity;
    for (const x of res.voxels) {
      app.data[x] = 1;
      const k = Math.floor(x / S);
      if (k < kMin) kMin = k;
      if (k > kMax) kMax = k;
    }
    const a = compareToReference(app, 1, expertLm, L, v, { kMin: Math.min(kMin, manual.kMin), kMax: Math.max(kMax, manual.kMax) });
    rows.push({
      ...row,
      dice: a?.dice ?? 0,
      longMm: a?.app.longMm, shortMm: a?.app.shortMm, volMl: a ? a.app.volumeMm3 / 1000 : res.voxels.length * v.colSpacing * v.rowSpacing * v.sliceSpacing / 1000,
      longDiffMm: a?.longDiffMm, shortDiffMm: a?.shortDiffMm, volDiffPct: a?.volumeDiffPct,
      leaked: res.leaked, erosion: res.erosion, lungConstrained: res.lungConstrained,
    });
  });
  const centreRow = rows[rows.length - SEEDS_PER_SERIES];
  console.log(
    `${patient} ${timepoint.padEnd(6)} expert ${expertM.longMm.toFixed(1)} mm ${(expertM.volumeMm3 / 1000).toFixed(1)} mL` +
      ` | ours(centre) Dice ${centreRow?.dice?.toFixed(2) ?? '–'} ${centreRow?.longMm?.toFixed(1) ?? '–'} mm ${centreRow?.volMl?.toFixed(1) ?? '–'} mL` +
      (autoAgreement ? ` | RIDER auto Dice ${autoAgreement.dice.toFixed(2)}` : ''),
  );
  fs.writeFileSync(cacheFile, JSON.stringify(rows.slice(before)));
}
if (partial) console.log(`\nPARTIAL RUN (time budget reached) — run the same command again to continue.`);

// ── summary ───────────────────────────────────────────────────────
const patients = [...new Set(rows.map((r) => r.patient))].sort();
const split = (p) => (patients.indexOf(p) % 3 === 0 ? 'development' : 'held-out');
for (const r of rows) r.split = split(r.patient);

function summarise(rs) {
  const centre = rs.filter((r) => r.seedIndex === 0 && r.dice !== undefined);
  const all = rs.filter((r) => r.seedIndex !== undefined);
  const ok = all.filter((r) => r.dice !== undefined);
  const byLesion = new Map();
  for (const r of ok) {
    const k = `${r.patient}|${r.timepoint}`;
    byLesion.set(k, [...(byLesion.get(k) ?? []), r.dice]);
  }
  const seedSpread = [...byLesion.values()].map((d) => Math.max(...d) - Math.min(...d));
  return {
    lesions: centre.length,
    centreClick: {
      diceMedian: median(centre.map((r) => r.dice)), diceQ1: q(centre.map((r) => r.dice), 0.25), diceQ3: q(centre.map((r) => r.dice), 0.75),
      diceAtLeast07: centre.filter((r) => r.dice >= 0.7).length,
      absLongDiffMmMedian: median(centre.map((r) => Math.abs(r.longDiffMm))),
      absVolDiffPctMedian: median(centre.map((r) => Math.abs(r.volDiffPct))),
      leaked: centre.filter((r) => r.leaked).length,
    },
    allClicks: {
      n: all.length, failed: all.filter((r) => r.error).length, diceMedian: median(ok.map((r) => r.dice)),
      diceBelow02: ok.filter((r) => r.dice < 0.2).length, medianSpreadPerLesion: median(seedSpread),
      msMedian: median(ok.map((r) => r.ms)), msMax: Math.max(...ok.map((r) => r.ms)),
    },
    riderAutoVsManualDiceMedian: median(centre.map((r) => r.riderAutoDice)),
  };
}

function repeatability(rs) {
  const out = [];
  for (const p of [...new Set(rs.map((r) => r.patient))]) {
    const t = rs.find((r) => r.patient === p && r.timepoint === 'TEST' && r.seedIndex === 0);
    const rt = rs.find((r) => r.patient === p && r.timepoint === 'RETEST' && r.seedIndex === 0);
    if (!t || !rt || t.volMl === undefined || rt.volMl === undefined) continue;
    const rel = (a, b) => (Math.abs(a - b) / ((a + b) / 2)) * 100;
    out.push({ patient: p, oursVolPct: rel(t.volMl, rt.volMl), expertVolPct: rel(t.expertVolMl, rt.expertVolMl), oursLongMm: Math.abs(t.longMm - rt.longMm), expertLongMm: Math.abs(t.expertLongMm - rt.expertLongMm) });
  }
  return {
    pairs: out.length,
    oursVolDiffPctMedian: median(out.map((x) => x.oursVolPct)), expertVolDiffPctMedian: median(out.map((x) => x.expertVolPct)),
    oursLongDiffMmMedian: median(out.map((x) => x.oursLongMm)), expertLongDiffMmMedian: median(out.map((x) => x.expertLongMm)),
  };
}

const summary = { generatedAt: new Date().toISOString(), complete: !partial, protocol: 'scripts/evaluate.cjs header', seedsPerSeries: SEEDS_PER_SERIES };
for (const s of ['development', 'held-out']) {
  const rs = rows.filter((r) => r.split === s);
  summary[s] = { patients: new Set(rs.map((r) => r.patient)).size, ...summarise(rs), repeatability: repeatability(rs) };
  for (const [name, f] of [['nodules (expert long axis ≤ 30 mm)', (r) => r.expertLongMm <= 30], ['masses (> 30 mm)', (r) => r.expertLongMm > 30]]) {
    summary[s][name] = summarise(rs.filter(f));
  }
}
summary.errors = rows.filter((r) => r.error && r.seedIndex === undefined).map((r) => `${r.patient} ${r.timepoint}: ${r.error}`);

fs.mkdirSync(OUT, { recursive: true });
const cols = ['split', 'patient', 'timepoint', 'seedIndex', 'seed', 'ms', 'expertLongMm', 'expertShortMm', 'expertVolMl', 'longMm', 'shortMm', 'volMl', 'dice', 'longDiffMm', 'shortDiffMm', 'volDiffPct', 'leaked', 'erosion', 'lungConstrained', 'riderAutoDice', 'error'];
const fmt = (x) => (typeof x === 'number' ? (Number.isInteger(x) ? String(x) : x.toFixed(3)) : x === undefined ? '' : `"${String(x).replace(/"/g, '""')}"`);
fs.writeFileSync(path.join(OUT, 'results.csv'), [cols.join(','), ...rows.map((r) => cols.map((c) => fmt(r[c])).join(','))].join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log('\n' + JSON.stringify(summary, null, 2));
console.log(`\nWrote ${path.join(OUT, 'results.csv')} and summary.json`);
