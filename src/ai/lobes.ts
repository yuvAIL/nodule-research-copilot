import type { Lobe } from '../findings/types';
import type { Labelmap } from '../measure/labelmap';
import type { RasterSegment } from '../reference/rasterize';

/**
 * Lung lobes from an AI segmentation (TotalSegmentator task `total`, lobe classes), used to
 * SUGGEST the Lobe of a finding. TotalSegmentator does not separate the lingula (it is part of
 * the left upper lobe), so "Lingula" is never suggested.
 */
const LOBE_CODES: Record<string, Exclude<Lobe, ''>> = {
  lung_upper_lobe_right: 'RUL',
  lung_middle_lobe_right: 'RML',
  lung_lower_lobe_right: 'RLL',
  lung_upper_lobe_left: 'LUL',
  lung_lower_lobe_left: 'LLL',
};

export interface LobeSegment {
  lobe: Exclude<Lobe, ''>;
  /** Ascending global voxel indices. */
  voxels: Int32Array;
}

function code(name: string): Exclude<Lobe, ''> | undefined {
  return LOBE_CODES[name.trim().toLowerCase().replace(/\s+/g, '_')];
}

/** The lobe segments of an AI result, or undefined when it is not a lobe map (fewer than 2 lobes). */
export function lobeSegments(segments: RasterSegment[]): LobeSegment[] | undefined {
  const out = segments.flatMap((s) => {
    const lobe = code(s.name);
    return lobe && s.voxelCount > 0 ? [{ lobe, voxels: s.voxels }] : [];
  });
  return out.length >= 2 ? out : undefined;
}

function contains(sorted: Int32Array, v: number): boolean {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const x = sorted[mid] as number;
    if (x === v) return true;
    if (x < v) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

export interface LobeHint {
  lobe: Exclude<Lobe, ''>;
  /** Share of the finding's voxels inside that lobe. */
  fraction: number;
}

/** Lobe holding most of the finding's outline (undefined if the outline lies outside every lobe). */
export function lobeHint(labelmap: Labelmap, label: number, kMin: number, kMax: number, lobes: LobeSegment[]): LobeHint | undefined {
  const counts = new Map<string, number>();
  let n = 0;
  const from = Math.max(0, kMin) * labelmap.sliceSize;
  const to = (Math.min(labelmap.slices - 1, kMax) + 1) * labelmap.sliceSize;
  for (let p = from; p < to; p++) {
    if (labelmap.data[p] !== label) continue;
    n++;
    for (const l of lobes) {
      if (contains(l.voxels, p)) {
        counts.set(l.lobe, (counts.get(l.lobe) ?? 0) + 1);
        break;
      }
    }
  }
  let best: LobeHint | undefined;
  for (const [lobe, c] of counts) {
    if (!best || c > best.fraction * n) best = { lobe: lobe as LobeHint['lobe'], fraction: c / n };
  }
  return best;
}
