import { describe, expect, it } from 'vitest';
import { formatDicomDate, headerFromSource, TAGS, type HeaderSource } from './headerMapping';

/** In-memory stand-in for a dicom-parser DataSet (strings, backslash-separated multi-values). */
function source(values: Record<string, string | number>): HeaderSource {
  return {
    has: (tag) => tag in values,
    string: (tag) => (typeof values[tag] === 'string' ? (values[tag] as string) : undefined),
    number: (tag, index = 0) => {
      const raw = values[tag];
      if (raw === undefined) return undefined;
      const part = String(raw).split('\\')[index];
      return part === undefined ? undefined : parseFloat(part);
    },
    uint16: (tag) => (typeof values[tag] === 'number' ? (values[tag] as number) : undefined),
  };
}

describe('headerFromSource', () => {
  it('extracts geometry and scan attributes', () => {
    const h = headerFromSource(
      source({
        [TAGS.sopInstanceUid]: '1.2.3.4',
        [TAGS.seriesInstanceUid]: '1.2.3 ',
        [TAGS.modality]: 'CT',
        [TAGS.instanceNumber]: '42',
        [TAGS.imagePositionPatient]: '-175.5\\-180\\-310.25',
        [TAGS.imageOrientationPatient]: '1\\0\\0\\0\\1\\0',
        [TAGS.pixelSpacing]: '0.68\\0.70',
        [TAGS.sliceThickness]: '1.0',
        [TAGS.rows]: 512,
        [TAGS.columns]: 512,
        [TAGS.pixelData]: 'x',
        [TAGS.convolutionKernel]: 'B70f\0',
      }),
      {} as File,
      'series/IM42',
    );
    expect(h.seriesInstanceUid).toBe('1.2.3');
    expect(h.instanceNumber).toBe(42);
    expect(h.imagePositionPatient).toEqual([-175.5, -180, -310.25]);
    expect(h.imageOrientationPatient).toEqual([1, 0, 0, 0, 1, 0]);
    expect(h.pixelSpacing).toEqual([0.68, 0.7]);
    expect(h.rows).toBe(512);
    expect(h.numberOfFrames).toBe(1);
    expect(h.hasPixelData).toBe(true);
    expect(h.convolutionKernel).toBe('B70f');
  });

  it('treats incomplete multi-value attributes as missing', () => {
    const h = headerFromSource(source({ [TAGS.imagePositionPatient]: '1\\2' }), {} as File, 'x');
    expect(h.imagePositionPatient).toBeUndefined();
    expect(h.hasPixelData).toBe(false);
  });
});

describe('formatDicomDate', () => {
  it('formats DA values', () => {
    expect(formatDicomDate('20240131')).toBe('2024-01-31');
    expect(formatDicomDate(undefined)).toBeUndefined();
  });
});
