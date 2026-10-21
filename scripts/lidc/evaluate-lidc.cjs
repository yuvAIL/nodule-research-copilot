#!/usr/bin/env node
/**
 * AI candidates vs LIDC-IDRI radiologist outlines, per nodule.
 *
 *   npm run eval:lidc -- [data/lidc] [--out docs/eval]
 *
 * Input (written by scripts/lidc/prepare_lidc.py): ground-truth.json, ct-folders.json, ai/<SeriesUID>.dcm,
 * inference-times.json. Uses the SAME code as the app for rasterizing outlines, making candidates and measuring.
 *
 * Definitions (fixed before the AI results were looked at):
 *  - Reader outline: one LIDC annotation (all its contours; exclusion contours cut holes).
 *  - Reference nodule: outlined by >= 3 of the 4 readers. Reference outline = 50 % consensus (voxels inside at
 *    least half of that nodule's reader outlines).
 *  - Type: median reader texture (1 non-solid … 5 solid): <= 2.5 non-solid (ground-glass), < 4 part-solid, else solid.
 *  - Detected: at least one AI candidate shares >= 1 voxel with the consensus outline (same rule as the RIDER test);
 *    also reported at Dice >= 0.1 and >= 0.5. Dice / axes / volume: candidate that overlaps most.
 *  - AI candidate with no voxel inside ANY reader outline (any nodule, any number of readers) = unmatched
 *    (potential false positive). LIDC readers also marked nodules < 3 mm without outlines; those cannot be matched,
 *    so "unmatched" is an upper bound on false positives.
 */
const fs = require('node:fs');
const path = require('node:path');
const { header, loadCt } = require('../lib/dicom-node.cjs');

const BUILD = path.resolve(__dirname, '..', '..', '.eval-build');
fs.writeFileSync(path.join(BUILD, 'package.json'), '{ "type": "commonjs" }\n');
const { parseReference } = require(path.join(BUILD, 'reference/parseReference.js'));
const { rasterizeReference } = require(path.join(BUILD, 'reference/rasterize.js'));
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
const ONLY = take('--only', '');
const DATA = path.resolve(args[0] || 'data/lidc');
const gt = JSON.parse(fs.readFileSync(path.join(DATA, 'ground-truth.json'), 'utf8'));
const folders = JSON.parse(fs.readFileSync(path.join(DATA, 'ct-folders.json'), 'utf8'));
const timesFile = path.join(DATA, 'inference-times.json');
const times = fs.existsSync(timesFile) ? JSON.parse(fs.readFileSync(timesFile, 'utf8')) : {};
const CACHE = path.join(OUT, 'cache-lidc-v2');
fs.mkdirSync(CACHE, { recursive: true });

const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

/** LIDC contour (pixel x = column, y = row, z = slice position) → patient coordinates on this CT. */
function toWorld(v, x, y, z) {
  let k = 0;
  let best = Infinity;
  for (let n = 0; n < v.slices; n++) {
    const d = Math.abs(v.origins[n][2] - z);
    if (d < best) {
      best = d;
      k = n;
    }
  }
  const o = v.origins[k];
  return [0, 1, 2].map((a) => o[a] + x * v.colSpacing * v.rowCosines[a] + y * v.rowSpacing * v.colCosines[a]);
}

function annotationVoxels(v, ann, swap) {
  const contours = ann.contours
    .filter((c) => c.coords.length >= 3)
    .map((c) => ({ roiNumber: 1, points: c.coords.map(([x, y]) => (swap ? toWorld(v, y, x, c.z) : toWorld(v, x, y, c.z))) }));
  if (!contours.length) return new Int32Array(0);
  const ref = { kind: 'RTSTRUCT', sopInstanceUid: 'lidc', segments: [{ number: 1, name: 'reader' }], contours };
  return rasterizeReference(ref, v).segments[0].voxels;
}

// Two reusable labelmaps (a full CT-sized labelmap is ~80 MB; never one per candidate).
let scratch;
function scratchFor(v) {
  if (!scratch || scratch.v !== v) scratch = { v, a: new Labelmap(v), b: new Labelmap(v) };
  return scratch;
}
/** Runs fn with the voxel lists painted into the scratch labelmaps (label 1), then clears them. */
function withMaps(v, aVox, bVox, fn) {
  const s = scratchFor(v);
  for (const p of aVox) s.a.data[p] = 1;
  if (bVox) for (const p of bVox) s.b.data[p] = 1;
  try {
    return fn(s.a, s.b);
  } finally {
    for (const p of aVox) s.a.data[p] = 0;
    if (bVox) for (const p of bVox) s.b.data[p] = 0;
  }
}
const sliceSize = (v) => v.cols * v.rows;
const kRange = (v, ...sets) => {
  let kMin = Infinity;
  let kMax = -Infinity;
  for (const s of sets)
    for (const p of [s[0], s[s.length - 1]]) {
      if (p === undefined) continue;
      const k = Math.floor(p / sliceSize(v));
      kMin = Math.min(kMin, k);
      kMax = Math.max(kMax, k);
    }
  return { kMin, kMax };
};
const meanHu = (v, voxels) => {
  let s = 0;
  for (const p of voxels) s += v.hu[p];
  return voxels.length ? s / voxels.length : NaN;
};

const nodRows = [];
const candRows = [];
const scanRows = [];
for (const scan of gt.scans) {
  if (ONLY && !scan.patient.includes(ONLY)) continue;
  const cacheFile = path.join(CACHE, `${scan.series}.json`);
  if (fs.existsSync(cacheFile)) {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    nodRows.push(...c.nodRows);
    candRows.push(...c.candRows);
    scanRows.push(c.scanRow);
    continue;
  }
  // ct-folders.json holds absolute paths of the machine that downloaded the data; re-base them on DATA so the
  // evaluation also runs from another mount point of the same folder.
  const stored = folders[scan.series];
  const dir = stored && !fs.existsSync(stored) && stored.includes(`${path.sep}ct${path.sep}`)
    ? path.join(DATA, 'ct', stored.split(`${path.sep}ct${path.sep}`).pop())
    : stored;
  const aiFile = path.join(DATA, 'ai', `${scan.series}.dcm`);
  const t = times[scan.series] ?? {};
  const scanRow = { patient: scan.patient, series: scan.series, selectedFor: scan.selectedFor, thicknessMm: scan.thickness, inferenceSeconds: t.seconds ?? null, status: '' };
  if (!dir || !fs.existsSync(aiFile)) {
    scanRow.status = !dir ? 'CT not downloaded' : `no AI result${t.error ? ': ' + t.error.split('\n').slice(-2).join(' ') : ''}`;
    scanRows.push(scanRow);
    console.log(`${scan.patient}: ${scanRow.status}`);
    continue;
  }
  let v;
  try {
    v = loadCt(dir);
  } catch (e) {
    scanRow.status = `CT not readable: ${e.message}`;
    scanRows.push(scanRow);
    continue;
  }
  const h = header(fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => /\.dcm$/i.test(f)));
  Object.assign(scanRow, {
    manufacturer: (h.string('x00080070') || '').trim(),
    kernel: (h.string('x00181210') || '').trim(),
    kvp: (h.string('x00180060') || '').trim(),
    contrast: (h.string('x00180010') || '').trim() ? 'yes' : 'not recorded',
    slices: v.slices,
    pixelMm: r3(v.colSpacing),
    sliceSpacingMm: r3(v.sliceSpacing),
  });

  // Reader outlines → voxels. pylidc stores contour points as x = column, y = row; that convention is used for every
  // scan. (A first version picked the orientation per scan by "higher mean HU", which flipped 5 scans onto bone and
  // soft tissue and turned their nodules into false misses. The HU comparison is now only reported, never acted on.)
  const solid = scan.nodules.filter((n) => n.reference && n.type === 'solid').flatMap((n) => n.annotations).slice(0, 4);
  const swap = false;
  if (solid.length) {
    const a = median(solid.map((x) => meanHu(v, annotationVoxels(v, x, false))));
    const b = median(solid.map((x) => meanHu(v, annotationVoxels(v, x, true))));
    scanRow.orientationCheck = `mean HU in solid outlines ${Math.round(a)} (x=col, used) vs ${Math.round(b)} (swapped, not used)`;
  }
  const allAnnotated = new Uint8Array(v.hu.length);
  const nodules = scan.nodules.map((n) => {
    const per = n.annotations.map((a) => annotationVoxels(v, a, swap));
    const count = new Map();
    for (const vox of per) for (const p of vox) count.set(p, (count.get(p) ?? 0) + 1);
    for (const vox of per) for (const p of vox) allAnnotated[p] = 1;
    const consensus = Int32Array.from([...count].filter(([, c]) => c * 2 >= per.length).map(([p]) => p)).sort();
    return { n, per, consensus };
  });

  const aiRef = parseReference(new Uint8Array(fs.readFileSync(aiFile)));
  const set = candidatesFromSegments(rasterizeReference(aiRef, v).segments, v);
  const cands = set?.candidates ?? [];
  scanRow.aiCandidates = cands.length;
  scanRow.hiddenTiny = set?.hiddenTiny ?? 0;
  scanRow.model = [aiRef.manufacturer, aiRef.softwareVersion].filter(Boolean).join(' ');

  const myNod = [];
  for (const { n, per, consensus } of nodules) {
    const row = {
      patient: scan.patient, nodule: n.id, readers: n.readers, reference: n.reference, textures: n.textures.join('/'),
      textureMedian: n.textureMedian, type: n.type, calcification: median(n.annotations.map((a) => Number(a.characteristics?.calcification))),
    };
    if (!consensus.length) {
      myNod.push({ ...row, status: 'empty consensus' });
      continue;
    }
    const rk = kRange(v, consensus);
    const refM = withMaps(v, consensus, null, (lm) => measureLabel(lm, v, 1, rk));
    row.expertLongMm = r1(refM?.longMm);
    row.expertShortMm = r1(refM?.shortMm);
    row.expertVolumeMm3 = Math.round(refM?.volumeMm3 ?? NaN);
    row.meanHu = Math.round(meanHu(v, consensus));
    row.sizeGroup = !refM ? '' : refM.longMm < 6 ? '< 6 mm' : refM.longMm <= 10 ? '6–10 mm' : refM.longMm < 20 ? '10–20 mm' : '≥ 20 mm';
    // reader-vs-consensus agreement (context for the AI's Dice)
    row.readerDiceMedian = r3(median(per.map((vox) => {
      if (!vox.length) return NaN;
      return withMaps(v, vox, consensus, (a, b) => compareToReference(a, 1, b, 1, v, kRange(v, vox, consensus))?.dice);
    })));
    let best = -1;
    let bestO = 0;
    cands.forEach((c, i) => {
      const o = withMaps(v, consensus, null, (lm) => overlapCount(lm, 1, c.voxels));
      if (o > bestO) {
        bestO = o;
        best = i;
      }
    });
    row.detected = best >= 0;
    if (best >= 0) {
      const c = cands[best];
      const a = withMaps(v, c.voxels, consensus, (x, y) => compareToReference(x, 1, y, 1, v, kRange(v, c.voxels, consensus)));
      Object.assign(row, {
        candidate: c.component, dice: r3(a?.dice), aiLongMm: r1(a?.app.longMm), aiShortMm: r1(a?.app.shortMm),
        aiVolumeMm3: Math.round(a?.app.volumeMm3 ?? NaN), longErrMm: r1(a?.longDiffMm), shortErrMm: r1(a?.shortDiffMm), volumeErrPct: r1(a?.volumeDiffPct),
      });
    } else {
      // distance from the consensus centroid to the nearest candidate voxel centroid (mm), for the failure analysis
      row.nearestCandidateMm = r1(Math.min(...cands.map((c) => {
        const cen = (vox) => {
          let x = 0, y = 0, z = 0;
          for (const p of vox) {
            x += p % v.cols; y += Math.floor((p % sliceSize(v)) / v.cols); z += Math.floor(p / sliceSize(v));
          }
          return [x / vox.length * v.colSpacing, y / vox.length * v.rowSpacing, z / vox.length * v.sliceSpacing];
        };
        const a = cen(consensus), b = cen(c.voxels);
        return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      })));
    }
    myNod.push(row);
  }
  const myCand = cands.map((c, i) => {
    let inside = 0;
    for (const p of c.voxels) if (allAnnotated[p]) inside++;
    const m = withMaps(v, c.voxels, null, (lm) => measureLabel(lm, v, 1, { kMin: c.kMin, kMax: c.kMax }));
    const refHit = myNod.filter((r) => r.candidate === c.component).map((r) => `N${r.nodule}`).join(' ');
    return {
      patient: scan.patient, candidate: c.component, volumeMm3: Math.round(c.volumeMm3), longMm: r1(m?.longMm),
      meanHu: Math.round(meanHu(v, c.voxels)), matchesAnnotation: inside > 0, matchesReferenceNodule: refHit,
      slices: c.kMax - c.kMin + 1,
    };
  });
  scanRow.status = 'evaluated';
  scanRow.unmatchedCandidates = myCand.filter((c) => !c.matchesAnnotation).length;
  fs.writeFileSync(cacheFile, JSON.stringify({ nodRows: myNod, candRows: myCand, scanRow }));
  nodRows.push(...myNod);
  candRows.push(...myCand);
  scanRows.push(scanRow);
  const ref = myNod.filter((r) => r.reference);
  console.log(`${scan.patient.padEnd(15)} ${String(scan.selectedFor).padEnd(22)} ref nodules ${ref.length}, detected ${ref.filter((r) => r.detected).length} | candidates ${cands.length} (unmatched ${scanRow.unmatchedCandidates}) ${scanRow.orientationCheck ?? ''}`);
}

// ── summary ──
const ref = nodRows.filter((r) => r.reference && r.status !== 'empty consensus');
const group = (rs) => {
  const det = rs.filter((r) => r.detected);
  return {
    nodules: rs.length,
    detected: det.length,
    detectedDice01: det.filter((r) => r.dice >= 0.1).length,
    detectedDice05: det.filter((r) => r.dice >= 0.5).length,
    diceMedian: r3(median(det.map((r) => r.dice))),
    readerDiceMedian: r3(median(rs.map((r) => r.readerDiceMedian))),
    absLongErrMmMedian: r1(median(det.map((r) => Math.abs(r.longErrMm)))),
    absShortErrMmMedian: r1(median(det.map((r) => Math.abs(r.shortErrMm)))),
    volumeErrPctMedian: r1(median(det.map((r) => r.volumeErrPct))),
    absVolumeErrPctMedian: r1(median(det.map((r) => Math.abs(r.volumeErrPct)))),
    expertLongMmRange: rs.length ? [r1(Math.min(...rs.map((r) => r.expertLongMm))), r1(Math.max(...rs.map((r) => r.expertLongMm)))] : null,
  };
};
const by = (key) => Object.fromEntries([...new Set(ref.map((r) => r[key]))].sort().map((k) => [k, group(ref.filter((r) => r[key] === k))]));
const evaluated = scanRows.filter((s) => s.status === 'evaluated');
const summary = {
  generatedAt: new Date().toISOString(),
  data: 'LIDC-IDRI (TCIA, CC BY 3.0) via NCI Imaging Data Commons; radiologist outlines via pylidc database',
  scans: { selected: gt.scans.length, evaluated: evaluated.length, notEvaluated: scanRows.filter((s) => s.status !== 'evaluated').map((s) => `${s.patient}: ${s.status}`) },
  referenceNodules: group(ref),
  byType: by('type'),
  bySize: by('sizeGroup'),
  candidates: {
    total: candRows.length,
    matchingAnyAnnotation: candRows.filter((c) => c.matchesAnnotation).length,
    unmatched: candRows.filter((c) => !c.matchesAnnotation).length,
    unmatchedPerScanMedian: median(evaluated.map((s) => s.unmatchedCandidates)),
    unmatchedVolumeMm3Median: median(candRows.filter((c) => !c.matchesAnnotation).map((c) => c.volumeMm3)),
  },
  nonReferenceAnnotatedNodules: nodRows.filter((r) => !r.reference).length,
  inferenceSeconds: {
    n: evaluated.filter((s) => s.inferenceSeconds).length,
    median: r1(median(evaluated.map((s) => s.inferenceSeconds))),
    min: r1(Math.min(...evaluated.map((s) => s.inferenceSeconds ?? Infinity))),
    max: r1(Math.max(...evaluated.map((s) => s.inferenceSeconds ?? -Infinity))),
    machine: Object.values(times)[0] ? { chip: Object.values(times)[0].chip, device: Object.values(times)[0].device, totalsegmentator: Object.values(times)[0].totalsegmentator } : null,
  },
  misses: ref.filter((r) => !r.detected).map((r) => `${r.patient} N${r.nodule} (${r.type}, ${r.expertLongMm} mm, ${r.meanHu} HU, nearest candidate ${r.nearestCandidateMm ?? '–'} mm)`),
};
const csv = (rows) => {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.join(','), ...rows.map((r) => cols.map((c) => (r[c] === undefined || r[c] === null ? '' : JSON.stringify(r[c]))).join(','))].join('\n') + '\n';
};
fs.writeFileSync(path.join(OUT, 'lidc-nodules.csv'), csv(nodRows));
fs.writeFileSync(path.join(OUT, 'lidc-candidates.csv'), csv(candRows));
fs.writeFileSync(path.join(OUT, 'lidc-scans.csv'), csv(scanRows));
fs.writeFileSync(path.join(OUT, 'lidc-summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
