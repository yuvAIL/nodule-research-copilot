import type { RasterSegment } from '../reference/rasterize';
import { voxelToWorld, type VolumeGeometry } from '../measure/volume';

/**
 * Turns an AI segmentation (e.g. TotalSegmentator `lung_nodules`, run offline and
 * loaded as a DICOM SEG) into separate nodule candidates for review. Nothing here
 * invents a score: the model gives a mask, so a candidate is a connected piece of
 * that mask, nothing more.
 */
export interface Candidate {
  /** 1-based, largest first. */
  component: number;
  voxels: Int32Array;
  kMin: number;
  kMax: number;
  volumeMm3: number;
  /** "Right lung · lower third" — from the AI lung mask; an estimate, not a lobe. */
  position?: string;
}

export interface CandidateSet {
  segment: string;
  candidates: Candidate[];
  /** Pieces smaller than the minimum volume (shown as a count, not as candidates). */
  hiddenTiny: number;
  minVolumeMm3: number;
}

/** Default: pieces under 5 mm³ (a few voxels) are noise, not reviewable nodules. */
export const MIN_CANDIDATE_MM3 = 5;

/** 26-connected components of a sparse voxel set, largest first. */
export function connectedComponents(voxels: Int32Array, g: Pick<VolumeGeometry, 'cols' | 'rows' | 'slices'>): Int32Array[] {
  const S = g.cols * g.rows;
  const index = new Map<number, number>();
  voxels.forEach((v, n) => index.set(v, n));
  const seen = new Uint8Array(voxels.length);
  const out: Int32Array[] = [];
  for (let start = 0; start < voxels.length; start++) {
    if (seen[start]) continue;
    seen[start] = 1;
    const stack = [voxels[start] as number];
    const comp: number[] = [];
    while (stack.length) {
      const v = stack.pop() as number;
      comp.push(v);
      const k = Math.floor(v / S);
      const j = Math.floor((v % S) / g.cols);
      const i = v % g.cols;
      for (let dk = -1; dk <= 1; dk++) {
        const kk = k + dk;
        if (kk < 0 || kk >= g.slices) continue;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= g.rows) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= g.cols) continue;
            const n = index.get(kk * S + jj * g.cols + ii);
            if (n !== undefined && !seen[n]) {
              seen[n] = 1;
              stack.push(voxels[n] as number);
            }
          }
        }
      }
    }
    out.push(Int32Array.from(comp.sort((a, b) => a - b)));
  }
  return out.sort((a, b) => b.length - a.length);
}

function centroidWorld(voxels: Int32Array, g: VolumeGeometry, step = 1): [number, number, number] {
  const S = g.cols * g.rows;
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (let t = 0; t < voxels.length; t += step) {
    const v = voxels[t] as number;
    const w = voxelToWorld(g, v % g.cols, Math.floor((v % S) / g.cols), Math.floor(v / S));
    x += w[0];
    y += w[1];
    z += w[2];
    n++;
  }
  return [x / n, y / n, z / n];
}

/**
 * Side (patient left/right) and height (upper/middle/lower third of that lung) from
 * the AI lung mask. DICOM patient coordinates: +x = patient's left, +z = head.
 */
export function positionEstimate(candidate: Int32Array, lung: Int32Array | undefined, g: VolumeGeometry): string | undefined {
  if (!lung || lung.length === 0 || candidate.length === 0) return undefined;
  const S = g.cols * g.rows;
  const c = centroidWorld(candidate, g);
  const step = Math.max(1, Math.floor(lung.length / 20000));
  const pts: [number, number][] = [];
  for (let t = 0; t < lung.length; t += step) {
    const v = lung[t] as number;
    const w = voxelToWorld(g, v % g.cols, Math.floor((v % S) / g.cols), Math.floor(v / S));
    pts.push([w[0], w[2]]);
  }
  const xs = pts.map((p) => p[0]);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const left = c[0] > mid;
  const sameSide = pts.filter((p) => (p[0] > mid) === left).map((p) => p[1]);
  if (sameSide.length === 0) return `${left ? 'Left' : 'Right'} side`;
  const zMin = Math.min(...sameSide);
  const zMax = Math.max(...sameSide);
  const f = (c[2] - zMin) / Math.max(1e-6, zMax - zMin);
  const third = f > 2 / 3 ? 'upper' : f > 1 / 3 ? 'middle' : 'lower';
  return `${left ? 'Left' : 'Right'} lung · ${third} third`;
}

/** Splits the nodule segment of an AI result into candidates. */
export function candidatesFromSegments(
  segments: RasterSegment[],
  g: VolumeGeometry,
  minVolumeMm3 = MIN_CANDIDATE_MM3,
): CandidateSet | undefined {
  const nodule = segments.find((s) => /nodule/i.test(s.name) && s.voxelCount > 0) ?? segments.find((s) => !/^lungs?$/i.test(s.name) && s.voxelCount > 0);
  if (!nodule) return undefined;
  const lung = segments.find((s) => /^lungs?$/i.test(s.name) && s.voxelCount > 0);
  const voxelMm3 = g.colSpacing * g.rowSpacing * g.sliceSpacing;
  const S = g.cols * g.rows;
  const comps = connectedComponents(nodule.voxels, g);
  const kept = comps.filter((c) => c.length * voxelMm3 >= minVolumeMm3);
  return {
    segment: nodule.name,
    minVolumeMm3,
    hiddenTiny: comps.length - kept.length,
    candidates: kept.map((voxels, n) => ({
      component: n + 1,
      voxels,
      kMin: Math.floor((voxels[0] as number) / S),
      kMax: Math.floor((voxels[voxels.length - 1] as number) / S),
      volumeMm3: voxels.length * voxelMm3,
      position: positionEstimate(voxels, lung?.voxels, g),
    })),
  };
}
