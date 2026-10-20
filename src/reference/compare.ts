import type { Labelmap } from '../measure/labelmap';
import { measureLabel, type Measurement } from '../measure/measure';
import type { VolumeGeometry } from '../measure/volume';

/**
 * Agreement between one app finding and one expert segment on the same voxel grid.
 * Long/short axes use the same RECIST-style method for both, so differences come
 * from the outlines, not from the measuring convention.
 */
export interface Agreement {
  dice: number;
  appVoxels: number;
  refVoxels: number;
  overlapVoxels: number;
  app: Measurement;
  ref: Measurement;
  longDiffMm: number;
  shortDiffMm: number;
  /** (app − expert) / expert × 100. */
  volumeDiffPct: number;
}

export interface SliceRange {
  kMin: number;
  kMax: number;
}

function bounds(lm: Labelmap, range?: SliceRange): [number, number] {
  const kMin = Math.max(0, range?.kMin ?? 0);
  const kMax = Math.min(lm.slices - 1, range?.kMax ?? lm.slices - 1);
  return [kMin * lm.sliceSize, (kMax + 1) * lm.sliceSize];
}

/** Number of voxels of `voxels` (a reference segment) that carry `appLabel` in the app labelmap. */
export function overlapCount(app: Labelmap, appLabel: number, voxels: Int32Array): number {
  let n = 0;
  for (const p of voxels) if (app.data[p] === appLabel) n++;
  return n;
}

/** Number of overlapping voxels between an app label and every reference label. */
export function overlapByReferenceLabel(app: Labelmap, appLabel: number, ref: Labelmap, range?: SliceRange): Map<number, number> {
  const out = new Map<number, number>();
  const [from, to] = bounds(app, range);
  for (let p = from; p < to; p++) {
    if (app.data[p] !== appLabel) continue;
    const r = ref.data[p] as number;
    if (r) out.set(r, (out.get(r) ?? 0) + 1);
  }
  return out;
}

/** The reference label that overlaps the finding most (undefined when nothing overlaps). */
export function bestReferenceLabel(app: Labelmap, appLabel: number, ref: Labelmap, range?: SliceRange): number | undefined {
  let best: number | undefined;
  let bestCount = 0;
  for (const [label, count] of overlapByReferenceLabel(app, appLabel, ref, range)) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

export function compareToReference(
  app: Labelmap,
  appLabel: number,
  ref: Labelmap,
  refLabel: number,
  g: VolumeGeometry,
  /** Slices known to contain both outlines (speeds up large series). */
  range?: SliceRange,
): Agreement | undefined {
  let a = 0;
  let b = 0;
  let both = 0;
  const [from, to] = bounds(app, range);
  for (let p = from; p < to; p++) {
    const inA = app.data[p] === appLabel;
    const inB = ref.data[p] === refLabel;
    if (inA) a++;
    if (inB) b++;
    if (inA && inB) both++;
  }
  if (a === 0 || b === 0) return undefined;
  const appM = measureLabel(app, g, appLabel, range);
  const refM = measureLabel(ref, g, refLabel, range);
  if (!appM || !refM) return undefined;
  return {
    dice: (2 * both) / (a + b),
    appVoxels: a,
    refVoxels: b,
    overlapVoxels: both,
    app: appM,
    ref: refM,
    longDiffMm: appM.longMm - refM.longMm,
    shortDiffMm: appM.shortMm - refM.shortMm,
    volumeDiffPct: ((appM.volumeMm3 - refM.volumeMm3) / refM.volumeMm3) * 100,
  };
}
