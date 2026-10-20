import { describe, expect, it } from 'vitest';
import { Labelmap } from '../measure/labelmap';
import type { RasterSegment } from '../reference/rasterize';
import { lobeHint, lobeSegments } from './lobes';

const seg = (name: string, voxels: number[], label: number): RasterSegment => ({
  label,
  number: label,
  name,
  voxelCount: voxels.length,
  kMin: 0,
  kMax: 0,
  voxels: Int32Array.from(voxels),
});

describe('lobes', () => {
  it('recognises a TotalSegmentator lobe map and ignores other results', () => {
    expect(lobeSegments([seg('lung_nodules', [1], 1)])).toBeUndefined();
    expect(lobeSegments([seg('lung_upper_lobe_right', [1], 1), seg('lung_lower_lobe_left', [2], 2)])?.map((l) => l.lobe)).toEqual(['RUL', 'LLL']);
  });

  it('suggests the lobe holding most of the outline', () => {
    const lm = new Labelmap({ cols: 10, rows: 1, slices: 1 });
    [2, 3, 4, 5, 6].forEach((p) => (lm.data[p] = 7));
    const lobes = lobeSegments([seg('lung_upper_lobe_right', [0, 1, 2], 1), seg('lung_middle_lobe_right', [3, 4, 5, 6, 8], 2)])!;
    expect(lobeHint(lm, 7, 0, 0, lobes)).toEqual({ lobe: 'RML', fraction: 0.8 });
    expect(lobeHint(lm, 9, 0, 0, lobes)).toBeUndefined();
  });
});
