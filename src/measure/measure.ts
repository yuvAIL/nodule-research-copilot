import type { Labelmap } from './labelmap';
import { voxelVolumeMm3, type VolumeGeometry } from './volume';

/**
 * Physical measurements of one labelled finding, from DICOM geometry.
 *
 * Convention (RECIST-style, in-plane):
 *  - Long axis: the longest in-plane diameter, measured on the axial slice
 *    where it is largest.
 *  - Short axis: the longest diameter perpendicular to the long axis, on the
 *    same slice.
 *  - Diameters are edge-to-edge: centre-to-centre distance plus one pixel
 *    sampling step along that direction.
 *  - Volume: voxel count × voxel volume (colSpacing × rowSpacing × sliceSpacing).
 */

export type Point2 = [number, number]; // (i, j) in fractional voxel units

export interface Measurement {
  voxelCount: number;
  volumeMm3: number;
  /** Slice (display index) used for the diameters. */
  sliceIndex: number;
  longMm: number;
  shortMm: number;
  longAxis: [Point2, Point2];
  shortAxis: [Point2, Point2];
  /** Centre of mass in voxel units. */
  centroid: { i: number; j: number; k: number };
  slicesSpanned: number;
}

interface SliceAxes {
  longMm: number;
  shortMm: number;
  longAxis: [Point2, Point2];
  shortAxis: [Point2, Point2];
  area: number;
}

type MmPoint = [number, number];

function cross2(o: MmPoint, a: MmPoint, b: MmPoint): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function convexHull(points: MmPoint[]): MmPoint[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;
  const lower: MmPoint[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2] as MmPoint, lower[lower.length - 1] as MmPoint, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: MmPoint[] = [];
  for (let n = pts.length - 1; n >= 0; n--) {
    const p = pts[n] as MmPoint;
    while (upper.length >= 2 && cross2(upper[upper.length - 2] as MmPoint, upper[upper.length - 1] as MmPoint, p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Sampling step (mm) of the pixel grid along a unit direction: equals the
 * pixel size for square pixels at any angle, and interpolates for anisotropic
 * pixels. Added once to a centre-to-centre distance to get an edge-to-edge
 * diameter (using the pixel's corner-to-corner extent would overestimate
 * diagonal diameters).
 */
function pixelExtent(ux: number, uy: number, cs: number, rs: number): number {
  return 1 / Math.sqrt((ux / cs) ** 2 + (uy / rs) ** 2);
}

/** Long and short axis of a 2D mask (pixels given as (i, j)), spacing in mm. */
export function sliceAxes(pixels: Point2[], cs: number, rs: number): SliceAxes | undefined {
  if (pixels.length === 0) return undefined;
  const mm: MmPoint[] = pixels.map(([i, j]) => [i * cs, j * rs]);
  const hull = convexHull(mm);

  let a: MmPoint = mm[0] as MmPoint;
  let b: MmPoint = mm[0] as MmPoint;
  let best = -1;
  for (let p = 0; p < hull.length; p++) {
    for (let q = p + 1; q < hull.length; q++) {
      const P = hull[p] as MmPoint;
      const Q = hull[q] as MmPoint;
      const d = (P[0] - Q[0]) ** 2 + (P[1] - Q[1]) ** 2;
      if (d > best) {
        best = d;
        a = P;
        b = Q;
      }
    }
  }
  const centreDist = Math.sqrt(Math.max(0, best));
  const ux = centreDist > 0 ? (b[0] - a[0]) / centreDist : 1;
  const uy = centreDist > 0 ? (b[1] - a[1]) / centreDist : 0;
  const vx = -uy;
  const vy = ux;
  const extU = pixelExtent(ux, uy, cs, rs);
  const extV = pixelExtent(vx, vy, cs, rs);
  const longMm = centreDist + extU;

  // Perpendicular chords: bin pixels by position along the long axis.
  const binW = Math.min(cs, rs);
  const bins = new Map<number, { min: number; max: number }>();
  for (const p of mm) {
    const pu = (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
    const pv = (p[0] - a[0]) * vx + (p[1] - a[1]) * vy;
    const key = Math.round(pu / binW);
    const bin = bins.get(key);
    if (!bin) bins.set(key, { min: pv, max: pv });
    else {
      if (pv < bin.min) bin.min = pv;
      if (pv > bin.max) bin.max = pv;
    }
  }
  let shortKey = 0;
  let shortBin = { min: 0, max: 0 };
  let shortCentre = -1;
  for (const [key, bin] of bins) {
    if (bin.max - bin.min > shortCentre) {
      shortCentre = bin.max - bin.min;
      shortKey = key;
      shortBin = bin;
    }
  }
  const shortMm = shortCentre + extV;

  const toVoxel = (x: number, y: number): Point2 => [x / cs, y / rs];
  const halfU = extU / 2;
  const halfV = extV / 2;
  const longAxis: [Point2, Point2] = [
    toVoxel(a[0] - ux * halfU, a[1] - uy * halfU),
    toVoxel(b[0] + ux * halfU, b[1] + uy * halfU),
  ];
  const su = shortKey * binW;
  const sx = a[0] + ux * su;
  const sy = a[1] + uy * su;
  const shortAxis: [Point2, Point2] = [
    toVoxel(sx + vx * (shortBin.min - halfV), sy + vy * (shortBin.min - halfV)),
    toVoxel(sx + vx * (shortBin.max + halfV), sy + vy * (shortBin.max + halfV)),
  ];
  return { longMm, shortMm, longAxis, shortAxis, area: pixels.length };
}

/** Pixels on the edge of a 2D mask (4-neighbourhood). Interior pixels can't be hull vertices. */
function boundaryPixels(slice: Uint8Array, cols: number, rows: number, label: number): Point2[] {
  const out: Point2[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p = j * cols + i;
      if (slice[p] !== label) continue;
      const edge =
        i === 0 ||
        j === 0 ||
        i === cols - 1 ||
        j === rows - 1 ||
        slice[p - 1] !== label ||
        slice[p + 1] !== label ||
        slice[p - cols] !== label ||
        slice[p + cols] !== label;
      if (edge) out.push([i, j]);
    }
  }
  return out;
}

function allPixels(slice: Uint8Array, cols: number, label: number): Point2[] {
  const out: Point2[] = [];
  for (let p = 0; p < slice.length; p++) if (slice[p] === label) out.push([p % cols, Math.floor(p / cols)]);
  return out;
}

export function measureLabel(
  labelmap: Labelmap,
  g: VolumeGeometry,
  label: number,
  /** Optional slice range known to contain the whole label (speeds up large series). */
  range?: { kMin: number; kMax: number },
): Measurement | undefined {
  let voxelCount = 0;
  let si = 0;
  let sj = 0;
  let sk = 0;
  let best: (SliceAxes & { k: number }) | undefined;
  let slicesSpanned = 0;

  const kMin = Math.max(0, range?.kMin ?? 0);
  const kMax = Math.min(labelmap.slices - 1, range?.kMax ?? labelmap.slices - 1);
  for (let k = kMin; k <= kMax; k++) {
    const slice = labelmap.sliceView(k);
    let count = 0;
    for (let p = 0; p < slice.length; p++) {
      if (slice[p] !== label) continue;
      count++;
      si += p % labelmap.cols;
      sj += Math.floor(p / labelmap.cols);
      sk += k;
    }
    if (count === 0) continue;
    voxelCount += count;
    slicesSpanned++;
    // Hull candidates only need edge pixels; chords need all pixels.
    const edge = boundaryPixels(slice, labelmap.cols, labelmap.rows, label);
    const axesFromEdge = sliceAxes(edge, g.colSpacing, g.rowSpacing);
    if (!axesFromEdge) continue;
    if (best && axesFromEdge.longMm < best.longMm - 1e-6) continue;
    const axes = sliceAxes(allPixels(slice, labelmap.cols, label), g.colSpacing, g.rowSpacing);
    if (!axes) continue;
    if (!best || axes.longMm > best.longMm + 1e-6 || (Math.abs(axes.longMm - best.longMm) <= 1e-6 && axes.area > best.area)) {
      best = { ...axes, k };
    }
  }
  if (!best || voxelCount === 0) return undefined;
  return {
    voxelCount,
    volumeMm3: voxelCount * voxelVolumeMm3(g),
    sliceIndex: best.k,
    longMm: best.longMm,
    shortMm: best.shortMm,
    longAxis: best.longAxis,
    shortAxis: best.shortAxis,
    centroid: { i: si / voxelCount, j: sj / voxelCount, k: sk / voxelCount },
    slicesSpanned,
  };
}
