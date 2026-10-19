import { voxelIndex, type Volume } from './volume';

/**
 * Semi-automatic ("click") 3D segmentation of a solid lung nodule/tumour.
 *
 * This is a classical, deterministic image-processing method, not AI:
 *  1. Threshold: voxels denser than `thresholdHu` (default -400 HU) inside a
 *     sphere of `maxRadiusMm` around the click.
 *  2. Adaptive morphological opening: erode e voxels, keep the connected part
 *     that contains the click, grow it back e steps inside the threshold mask.
 *     This cuts thin attachments (vessels, bronchi) that touch the nodule. e
 *     is increased (0..6 voxels) until the result no longer reaches the edge
 *     of the search sphere ("leak"); the first e that does not leak is used,
 *     so small isolated nodules are not eroded.
 *  3. Fill internal holes slice by slice (cavities, air bronchograms).
 *
 * Lung constraint: tumours often touch the chest wall or mediastinum, which
 * have the same density. On each slice the lungs are found (air inside the
 * body) and their convex hulls are taken; the hull runs along the inner chest
 * wall, so a pleura-based tumour stays inside it while the wall is excluded.
 * If the click is outside that region (e.g. a mediastinal mass) the
 * constraint is not used.
 *
 * The researcher can always correct the result with the brush/eraser.
 */

export interface SegmentOptions {
  thresholdHu?: number;
  maxRadiusMm?: number;
}

export type SegmentResult =
  | {
      ok: true;
      /** Global voxel indices of the segmented region. */
      voxels: Int32Array;
      /** Erosion depth that was needed (0 = none). */
      erosion: number;
      /** True if even the strongest setting still reached the search limit. */
      leaked: boolean;
      thresholdHu: number;
      maxRadiusMm: number;
      /** True if the region was limited to the lung (convex hull per slice). */
      lungConstrained: boolean;
    }
  | { ok: false; reason: string };

const AIR_HU = -400;
/** Lung components smaller than this (mm²) on a slice are ignored (bowel gas, small airways). */
const MIN_LUNG_AREA_MM2 = 150;

export const DEFAULT_THRESHOLD_HU = -400;
export const DEFAULT_MAX_RADIUS_MM = 60;
const MAX_EROSION = 6;

interface Roi {
  i0: number;
  j0: number;
  k0: number;
  nx: number;
  ny: number;
  nz: number;
}

function neighbours6(n: number, roi: Roi, out: number[]): number {
  const { nx, ny, nz } = roi;
  const i = n % nx;
  const j = Math.floor(n / nx) % ny;
  const k = Math.floor(n / (nx * ny));
  let c = 0;
  if (i > 0) out[c++] = n - 1;
  if (i < nx - 1) out[c++] = n + 1;
  if (j > 0) out[c++] = n - nx;
  if (j < ny - 1) out[c++] = n + nx;
  if (k > 0) out[c++] = n - nx * ny;
  if (k < nz - 1) out[c++] = n + nx * ny;
  return c;
}

function erode(mask: Uint8Array, roi: Roi): Uint8Array {
  const out = new Uint8Array(mask.length);
  const nb: number[] = new Array(6);
  for (let n = 0; n < mask.length; n++) {
    if (!mask[n]) continue;
    const c = neighbours6(n, roi, nb);
    if (c < 6) continue; // ROI border counts as background
    let keep = 1;
    for (let q = 0; q < c; q++) {
      if (!mask[nb[q] as number]) {
        keep = 0;
        break;
      }
    }
    out[n] = keep;
  }
  return out;
}

/** Breadth-first flood from `start` through `allowed`, optionally limited to `maxSteps` layers. */
function flood(allowed: Uint8Array, starts: number[], roi: Roi, maxSteps = Infinity, preset?: Uint8Array): Uint8Array {
  const out = preset ? new Uint8Array(preset) : new Uint8Array(allowed.length);
  let frontier: number[] = [];
  for (const s of starts) {
    if (allowed[s] && !out[s]) out[s] = 1;
    frontier.push(s);
  }
  if (preset) {
    frontier = [];
    for (let n = 0; n < out.length; n++) if (out[n]) frontier.push(n);
  }
  const nb: number[] = new Array(6);
  let step = 0;
  while (frontier.length > 0 && step < maxSteps) {
    const next: number[] = [];
    for (const n of frontier) {
      const c = neighbours6(n, roi, nb);
      for (let q = 0; q < c; q++) {
        const m = nb[q] as number;
        if (allowed[m] && !out[m]) {
          out[m] = 1;
          next.push(m);
        }
      }
    }
    frontier = next;
    step++;
  }
  return out;
}

/** Nearest voxel (by flood distance through `through`) that is set in `target`. */
function nearestInTarget(target: Uint8Array, through: Uint8Array, start: number, roi: Roi, maxSteps: number): number {
  if (target[start]) return start;
  const seen = new Uint8Array(target.length);
  seen[start] = 1;
  let frontier = [start];
  const nb: number[] = new Array(6);
  for (let step = 0; step < maxSteps && frontier.length > 0; step++) {
    const next: number[] = [];
    for (const n of frontier) {
      const c = neighbours6(n, roi, nb);
      for (let q = 0; q < c; q++) {
        const m = nb[q] as number;
        if (seen[m] || !through[m]) continue;
        if (target[m]) return m;
        seen[m] = 1;
        next.push(m);
      }
    }
    frontier = next;
  }
  return -1;
}

function fillHolesPerSlice(region: Uint8Array, roi: Roi): void {
  const { nx, ny, nz } = roi;
  const sliceSize = nx * ny;
  const outside = new Uint8Array(sliceSize);
  const stack: number[] = [];
  for (let k = 0; k < nz; k++) {
    const base = k * sliceSize;
    outside.fill(0);
    const push = (p: number) => {
      if (!outside[p] && !region[base + p]) {
        outside[p] = 1;
        stack.push(p);
      }
    };
    for (let i = 0; i < nx; i++) {
      push(i);
      push((ny - 1) * nx + i);
    }
    for (let j = 0; j < ny; j++) {
      push(j * nx);
      push(j * nx + nx - 1);
    }
    while (stack.length > 0) {
      const p = stack.pop() as number;
      const i = p % nx;
      const j = (p - i) / nx;
      if (i > 0) push(p - 1);
      if (i < nx - 1) push(p + 1);
      if (j > 0) push(p - nx);
      if (j < ny - 1) push(p + nx);
    }
    for (let p = 0; p < sliceSize; p++) if (!outside[p]) region[base + p] = 1;
  }
}

type Pt = [number, number];

function hull2d(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as Pt, lower[lower.length - 1] as Pt, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let n = pts.length - 1; n >= 0; n--) {
    const p = pts[n] as Pt;
    while (upper.length >= 2 && cross(upper[upper.length - 2] as Pt, upper[upper.length - 1] as Pt, p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Fills a convex polygon (pixel-centre coordinates) into a cols×rows mask. */
function fillConvex(mask: Uint8Array, cols: number, rows: number, poly: Pt[]): void {
  if (poly.length === 0) return;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of poly) {
    yMin = Math.min(yMin, p[1]);
    yMax = Math.max(yMax, p[1]);
  }
  for (let j = Math.max(0, Math.ceil(yMin)); j <= Math.min(rows - 1, Math.floor(yMax)); j++) {
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let e = 0; e < poly.length; e++) {
      const a = poly[e] as Pt;
      const b = poly[(e + 1) % poly.length] as Pt;
      if ((a[1] <= j && b[1] >= j) || (b[1] <= j && a[1] >= j)) {
        const x = a[1] === b[1] ? Math.min(a[0], b[0]) : a[0] + ((j - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
        const x2 = a[1] === b[1] ? Math.max(a[0], b[0]) : x;
        xMin = Math.min(xMin, x, x2);
        xMax = Math.max(xMax, x, x2);
      }
    }
    for (let i = Math.max(0, Math.ceil(xMin)); i <= Math.min(cols - 1, Math.floor(xMax)); i++) mask[j * cols + i] = 1;
  }
}

/**
 * Lung region of one axial slice: convex hull of each sizeable air component
 * inside the body. Pixels inside any hull are 1.
 */
export function lungRegionSlice(hu: Int16Array, offset: number, cols: number, rows: number, pixelAreaMm2: number): Uint8Array {
  const size = cols * rows;
  const air = new Uint8Array(size);
  for (let p = 0; p < size; p++) if ((hu[offset + p] as number) < AIR_HU) air[p] = 1;

  // Air connected to the image border is outside the body.
  const visited = new Uint8Array(size);
  const stack: number[] = [];
  const pushIfAir = (p: number) => {
    if (air[p] && !visited[p]) {
      visited[p] = 1;
      stack.push(p);
    }
  };
  const drain = () => {
    while (stack.length > 0) {
      const p = stack.pop() as number;
      const i = p % cols;
      const j = (p - i) / cols;
      if (i > 0) pushIfAir(p - 1);
      if (i < cols - 1) pushIfAir(p + 1);
      if (j > 0) pushIfAir(p - cols);
      if (j < rows - 1) pushIfAir(p + cols);
    }
  };
  for (let i = 0; i < cols; i++) {
    pushIfAir(i);
    pushIfAir((rows - 1) * cols + i);
  }
  for (let j = 0; j < rows; j++) {
    pushIfAir(j * cols);
    pushIfAir(j * cols + cols - 1);
  }
  drain();

  const region = new Uint8Array(size);
  const minPixels = MIN_LUNG_AREA_MM2 / pixelAreaMm2;
  for (let start = 0; start < size; start++) {
    if (!air[start] || visited[start]) continue;
    // Collect one internal air component; keep only its edge pixels for the hull.
    const edge: Pt[] = [];
    let count = 0;
    visited[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const p = stack.pop() as number;
      count++;
      const i = p % cols;
      const j = (p - i) / cols;
      let isEdge = false;
      const visit = (q: number, inBounds: boolean) => {
        if (!inBounds || !air[q]) {
          isEdge = true;
          return;
        }
        if (!visited[q]) {
          visited[q] = 1;
          stack.push(q);
        }
      };
      visit(p - 1, i > 0);
      visit(p + 1, i < cols - 1);
      visit(p - cols, j > 0);
      visit(p + cols, j < rows - 1);
      if (isEdge) edge.push([i, j]);
    }
    if (count >= minPixels) fillConvex(region, cols, rows, hull2d(edge));
  }
  return region;
}

/** Per-volume cache of lung regions by slice (they don't depend on the click or threshold). */
const lungCache = new WeakMap<Int16Array, Map<number, Uint8Array>>();

export function segmentFromSeed(
  volume: Volume,
  seed: { i: number; j: number; k: number },
  options: SegmentOptions = {},
): SegmentResult {
  const thresholdHu = options.thresholdHu ?? DEFAULT_THRESHOLD_HU;
  const maxRadiusMm = options.maxRadiusMm ?? DEFAULT_MAX_RADIUS_MM;
  const si = Math.round(seed.i);
  const sj = Math.round(seed.j);
  const sk = Math.round(seed.k);
  if (si < 0 || sj < 0 || sk < 0 || si >= volume.cols || sj >= volume.rows || sk >= volume.slices) {
    return { ok: false, reason: 'The click is outside the image.' };
  }

  const ri = Math.ceil(maxRadiusMm / volume.colSpacing);
  const rj = Math.ceil(maxRadiusMm / volume.rowSpacing);
  const rk = Math.ceil(maxRadiusMm / volume.sliceSpacing);
  const i0 = Math.max(0, si - ri);
  const j0 = Math.max(0, sj - rj);
  const k0 = Math.max(0, sk - rk);
  const roi: Roi = {
    i0,
    j0,
    k0,
    nx: Math.min(volume.cols - 1, si + ri) - i0 + 1,
    ny: Math.min(volume.rows - 1, sj + rj) - j0 + 1,
    nz: Math.min(volume.slices - 1, sk + rk) - k0 + 1,
  };
  const size = roi.nx * roi.ny * roi.nz;
  const denseAll = new Uint8Array(size);
  const nearLimit = new Uint8Array(size);
  const lung = new Uint8Array(size);
  const pixelArea = volume.colSpacing * volume.rowSpacing;
  let cache = lungCache.get(volume.hu);
  if (!cache) {
    cache = new Map();
    lungCache.set(volume.hu, cache);
  }
  for (let k = 0; k < roi.nz; k++) {
    let region = cache.get(k + k0);
    if (!region) {
      region = lungRegionSlice(volume.hu, (k + k0) * volume.cols * volume.rows, volume.cols, volume.rows, pixelArea);
      cache.set(k + k0, region);
    }
    for (let j = 0; j < roi.ny; j++) {
      for (let i = 0; i < roi.nx; i++) {
        if (region[(j + j0) * volume.cols + (i + i0)]) lung[(k * roi.ny + j) * roi.nx + i] = 1;
      }
    }
  }
  const r2 = maxRadiusMm * maxRadiusMm;
  const limit2 = (0.9 * maxRadiusMm) ** 2;

  for (let k = 0; k < roi.nz; k++) {
    const dz = (k + k0 - sk) * volume.sliceSpacing;
    for (let j = 0; j < roi.ny; j++) {
      const dy = (j + j0 - sj) * volume.rowSpacing;
      for (let i = 0; i < roi.nx; i++) {
        const dx = (i + i0 - si) * volume.colSpacing;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const n = (k * roi.ny + j) * roi.nx + i;
        if ((volume.hu[voxelIndex(volume, i + i0, j + j0, k + k0)] as number) > thresholdHu) denseAll[n] = 1;
        if (d2 > limit2) nearLimit[n] = 1;
      }
    }
  }

  let seedLocal = ((sk - k0) * roi.ny + (sj - j0)) * roi.nx + (si - i0);
  // Limit to the lung region when the click is inside it.
  const lungConstrained = lung[seedLocal] === 1;
  let dense = denseAll;
  if (lungConstrained) {
    dense = new Uint8Array(size);
    for (let n = 0; n < size; n++) if (denseAll[n] && lung[n]) dense[n] = 1;
  }
  if (!dense[seedLocal]) {
    // Allow a slightly imprecise click: snap to dense tissue within ~3 mm.
    const everywhere = new Uint8Array(size).fill(1);
    const snapSteps = Math.max(1, Math.round(3 / Math.min(volume.colSpacing, volume.rowSpacing)));
    seedLocal = nearestInTarget(dense, everywhere, seedLocal, roi, snapSteps);
    if (seedLocal < 0) {
      return {
        ok: false,
        reason: `No dense tissue (> ${thresholdHu} HU) at the click. Click inside the nodule, or lower the edge threshold.`,
      };
    }
  }

  let best: Uint8Array | undefined;
  let bestErosion = 0;
  let leaked = true;
  let core: Uint8Array = dense;
  for (let e = 0; e <= MAX_EROSION; e++) {
    if (e > 0) core = erode(core, roi);
    const start = nearestInTarget(core, dense, seedLocal, roi, e + 3);
    if (start < 0) break; // the nodule itself is thinner than this erosion
    let region = flood(core, [start], roi);
    if (e > 0) region = flood(dense, [], roi, e, region); // grow back inside the threshold mask
    best = region;
    bestErosion = e;
    let touches = false;
    for (let n = 0; n < size; n++) {
      if (region[n] && nearLimit[n]) {
        touches = true;
        break;
      }
    }
    if (!touches) {
      leaked = false;
      break;
    }
  }
  if (!best) return { ok: false, reason: 'Could not separate a region at the click.' };

  fillHolesPerSlice(best, roi);

  const voxels: number[] = [];
  for (let k = 0; k < roi.nz; k++) {
    for (let j = 0; j < roi.ny; j++) {
      for (let i = 0; i < roi.nx; i++) {
        if (best[(k * roi.ny + j) * roi.nx + i]) voxels.push(voxelIndex(volume, i + i0, j + j0, k + k0));
      }
    }
  }
  return { ok: true, voxels: Int32Array.from(voxels), erosion: bestErosion, leaked, thresholdHu, maxRadiusMm, lungConstrained };
}
