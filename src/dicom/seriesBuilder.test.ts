import { describe, expect, it } from 'vitest';
import { analyseSpacing, buildSeries, describeOrientation, sortSlices } from './seriesBuilder';
import type { DicomHeader } from './types';

const AXIAL: DicomHeader['imageOrientationPatient'] = [1, 0, 0, 0, 1, 0];

function header(overrides: Partial<DicomHeader>): DicomHeader {
  return {
    file: {} as File,
    relativePath: overrides.sopInstanceUid ?? 'file',
    sopInstanceUid: 'sop',
    seriesInstanceUid: 'series-1',
    studyInstanceUid: 'study-1',
    modality: 'CT',
    rows: 512,
    columns: 512,
    numberOfFrames: 1,
    hasPixelData: true,
    imageOrientationPatient: AXIAL,
    ...overrides,
  };
}

function axialSlice(i: number, z: number, extra: Partial<DicomHeader> = {}): DicomHeader {
  return header({ sopInstanceUid: `sop-${i}`, relativePath: `IM${i}`, instanceNumber: i, imagePositionPatient: [0, 0, z], ...extra });
}

describe('sortSlices', () => {
  it('orders axial slices superior to inferior by ImagePositionPatient, ignoring file order', () => {
    const shuffled = [axialSlice(2, -10), axialSlice(1, 0), axialSlice(3, -20)];
    const result = sortSlices(shuffled);
    expect(result.method).toBe('image-position');
    expect(result.instances.map((h) => h.imagePositionPatient?.[2])).toEqual([0, -10, -20]);
  });

  it('uses geometry even when InstanceNumber disagrees', () => {
    const result = sortSlices([axialSlice(1, -20), axialSlice(2, 0), axialSlice(3, -10)]);
    expect(result.instances.map((h) => h.instanceNumber)).toEqual([2, 3, 1]);
  });

  it('falls back to InstanceNumber when positions are missing', () => {
    const result = sortSlices([
      header({ sopInstanceUid: 'b', instanceNumber: 2 }),
      header({ sopInstanceUid: 'a', instanceNumber: 1 }),
    ]);
    expect(result.method).toBe('instance-number');
    expect(result.instances.map((h) => h.sopInstanceUid)).toEqual(['a', 'b']);
  });

  it('falls back to natural file-name order as a last resort', () => {
    const result = sortSlices([
      header({ relativePath: 'IM10', imageOrientationPatient: undefined }),
      header({ relativePath: 'IM2', imageOrientationPatient: undefined }),
    ]);
    expect(result.method).toBe('file-order');
    expect(result.instances.map((h) => h.relativePath)).toEqual(['IM2', 'IM10']);
  });
});

describe('analyseSpacing', () => {
  it('reports the median spacing with no warnings for a regular series', () => {
    const { spacing, warnings } = analyseSpacing([0, -1.25, -2.5, -3.75]);
    expect(spacing).toBeCloseTo(1.25);
    expect(warnings).toEqual([]);
  });

  it('flags gaps that suggest missing slices', () => {
    const { warnings } = analyseSpacing([0, -1, -2, -5, -6]);
    expect(warnings.some((w) => w.includes('missing'))).toBe(true);
  });

  it('flags duplicated positions', () => {
    const { warnings } = analyseSpacing([0, 0, -1, -2]);
    expect(warnings.some((w) => w.includes('share a position'))).toBe(true);
  });
});

describe('describeOrientation', () => {
  it('recognises standard planes', () => {
    expect(describeOrientation([1, 0, 0, 0, 1, 0])).toBe('axial');
    expect(describeOrientation([1, 0, 0, 0, 0, -1])).toBe('coronal');
    expect(describeOrientation([0, 1, 0, 0, 0, -1])).toBe('sagittal');
    expect(describeOrientation(undefined)).toBe('unknown');
  });
});

describe('buildSeries', () => {
  it('groups by SeriesInstanceUID and puts the largest CT series first', () => {
    const headers = [
      axialSlice(1, 0),
      axialSlice(2, -1),
      axialSlice(3, -2),
      axialSlice(10, 0, { seriesInstanceUid: 'series-2' }),
      header({ sopInstanceUid: 'pet', seriesInstanceUid: 'series-pt', modality: 'PT', imagePositionPatient: [0, 0, 0] }),
    ];
    const { series } = buildSeries(headers);
    expect(series.map((s) => s.seriesInstanceUid)).toEqual(['series-1', 'series-2', 'series-pt']);
    expect(series[0]?.sliceSpacingMm).toBeCloseTo(1);
    expect(series[2]?.warnings.some((w) => w.includes('not CT'))).toBe(true);
  });

  it('skips non-image and multi-frame instances with a reason', () => {
    const { series, skipped } = buildSeries([
      axialSlice(1, 0),
      header({ sopInstanceUid: 'sr', relativePath: 'SR1', hasPixelData: false }),
      header({ sopInstanceUid: 'mf', relativePath: 'MF1', numberOfFrames: 300 }),
    ]);
    expect(series).toHaveLength(1);
    expect(skipped.map((s) => s.relativePath).sort()).toEqual(['MF1', 'SR1']);
    expect(skipped.find((s) => s.relativePath === 'MF1')?.reason).toMatch(/Multi-frame/);
  });

  it('removes duplicate SOP instances and excludes images with different geometry', () => {
    const { series, skipped } = buildSeries([
      axialSlice(1, 0),
      axialSlice(1, 0, { relativePath: 'copy/IM1' }),
      axialSlice(2, -1),
      axialSlice(3, -2),
      header({ sopInstanceUid: 'scout', relativePath: 'SCOUT', rows: 256, columns: 1024, imagePositionPatient: [0, 0, 0] }),
    ]);
    expect(series[0]?.instances).toHaveLength(3);
    expect(skipped.map((s) => s.relativePath).sort()).toEqual(['SCOUT', 'copy/IM1']);
  });
});
