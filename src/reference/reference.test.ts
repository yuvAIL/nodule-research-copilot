import { describe, expect, it } from 'vitest';
import { Labelmap } from '../measure/labelmap';
import { makeGeometry } from '../measure/phantoms';
import type { Vec3 } from '../measure/volume';
import { bestReferenceLabel, compareToReference } from './compare';
import { defaultSegment, fillPolygon, rasterizeReference, segmentLabelmap } from './rasterize';
import type { RtStructReference, SegReference } from './types';

function circle(cx: number, cy: number, z: number, r: number, n = 64): Vec3[] {
  return Array.from({ length: n }, (_, t): Vec3 => [cx + r * Math.cos((2 * Math.PI * t) / n), cy + r * Math.sin((2 * Math.PI * t) / n), z]);
}

describe('fillPolygon', () => {
  it('fills voxel centres inside a square and XORs a hole', () => {
    const mask = new Uint8Array(20 * 20);
    fillPolygon(mask, 20, 20, [{ i: 1.5, j: 1.5 }, { i: 11.5, j: 1.5 }, { i: 11.5, j: 11.5 }, { i: 1.5, j: 11.5 }]);
    expect(mask.reduce((a, b) => a + b, 0)).toBe(100);
    fillPolygon(mask, 20, 20, [{ i: 4.5, j: 4.5 }, { i: 8.5, j: 4.5 }, { i: 8.5, j: 8.5 }, { i: 4.5, j: 8.5 }]);
    expect(mask.reduce((a, b) => a + b, 0)).toBe(84);
  });
});

describe('rasterizeReference', () => {
  const g = makeGeometry(100, 100, 20, 0.5, 0.5, 2); // slice k at z = -2k mm

  it('places RTSTRUCT circles on the right slices with the right area', () => {
    const ref: RtStructReference = {
      kind: 'RTSTRUCT',
      sopInstanceUid: 'x',
      segments: [{ number: 7, name: 'GTV-1' }],
      contours: [5, 6, 7].map((k) => ({ roiNumber: 7, points: circle(25, 25, -2 * k, 10) })),
    };
    const r = rasterizeReference(ref, g);
    expect(r.warnings).toEqual([]);
    const seg = r.segments[0]!;
    const lm = segmentLabelmap(g, seg);
    expect(lm.slicesWithLabel(1)).toEqual([5, 6, 7]);
    expect([seg.kMin, seg.kMax]).toEqual([5, 7]);
    const areaMm2 = lm.sliceView(6).reduce((a, b) => a + b, 0) * 0.25;
    expect(Math.abs(areaMm2 - Math.PI * 100) / (Math.PI * 100)).toBeLessThan(0.03);
  });

  it('places a contour on the nearest slice and skips one outside the series', () => {
    const ref: RtStructReference = {
      kind: 'RTSTRUCT',
      sopInstanceUid: 'x',
      segments: [{ number: 1, name: 'GTV' }],
      contours: [{ roiNumber: 1, points: circle(25, 25, -3.4, 5) }, { roiNumber: 1, points: circle(25, 25, -100, 5) }],
    };
    const r = rasterizeReference(ref, g);
    expect(segmentLabelmap(g, r.segments[0]!).slicesWithLabel(1)).toEqual([2]);
    expect(r.warnings.length).toBe(1);
  });

  it('places SEG frames by position, including a coarser grid', () => {
    const rows = 25;
    const cols = 25; // 1 mm pixels over a 0.5 mm CT grid
    const mask = new Uint8Array(rows * cols);
    for (let r = 10; r < 15; r++) for (let c = 5; c < 10; c++) mask[r * cols + c] = 1; // 5 × 5 mm square
    const seg: SegReference = {
      kind: 'SEG',
      sopInstanceUid: 'x',
      segments: [{ number: 1, name: 'Neoplasm' }],
      rows,
      cols,
      rowCosines: [1, 0, 0],
      colCosines: [0, 1, 0],
      pixelSpacing: [1, 1],
      frames: [{ segmentNumber: 1, position: [0, 0, -8], mask }],
    };
    const r = rasterizeReference(seg, g);
    const lm = segmentLabelmap(g, r.segments[0]!);
    expect(lm.slicesWithLabel(1)).toEqual([4]);
    const areaMm2 = lm.sliceView(4).reduce((a, b) => a + b, 0) * 0.25;
    expect(Math.abs(areaMm2 - 25)).toBeLessThanOrEqual(5); // nearest-neighbour edge effects
    expect(r.segments[0]?.voxelCount).toBe(lm.sliceView(4).reduce((a, b) => a + b, 0));
  });

  it('keeps overlapping segments separate and prefers the manual one', () => {
    // Regression: a manual and an automatic outline of the same tumour overlap almost completely.
    const ref: RtStructReference = {
      kind: 'RTSTRUCT',
      sopInstanceUid: 'x',
      segments: [
        { number: 1, name: 'GTV', algorithmType: 'MANUAL' },
        { number: 2, name: 'GTV', algorithmType: 'AUTOMATIC' },
      ],
      contours: [
        { roiNumber: 1, points: circle(25, 25, -12, 10) },
        { roiNumber: 2, points: circle(26, 25, -12, 10) },
      ],
    };
    const r = rasterizeReference(ref, g);
    const [manual, auto] = r.segments;
    expect(Math.abs(manual!.voxelCount - auto!.voxelCount)).toBeLessThanOrEqual(8);
    expect(manual!.voxelCount).toBeGreaterThan(1000);
    expect(defaultSegment(r.segments)?.algorithmType).toBe('MANUAL');
  });
});

describe('compareToReference', () => {
  const g = makeGeometry(60, 60, 10, 1, 1, 1);
  const square = (lm: Labelmap, label: number, x0: number, x1: number, k0: number, k1: number) => {
    for (let k = k0; k <= k1; k++) for (let j = 20; j < 30; j++) for (let i = x0; i < x1; i++) lm.data[k * 3600 + j * 60 + i] = label;
  };

  it('gives Dice 1 and zero differences for identical outlines', () => {
    const a = new Labelmap(g);
    const b = new Labelmap(g);
    square(a, 3, 20, 30, 2, 5);
    square(b, 1, 20, 30, 2, 5);
    const r = compareToReference(a, 3, b, 1, g);
    expect(r?.dice).toBe(1);
    expect(r?.volumeDiffPct).toBe(0);
    expect(r?.longDiffMm).toBe(0);
  });

  it('computes Dice and volume difference for a half-overlapping outline', () => {
    const a = new Labelmap(g);
    const b = new Labelmap(g);
    square(a, 1, 20, 30, 2, 5); // 400 voxels
    square(b, 2, 25, 35, 2, 5); // 400 voxels, 200 shared
    expect(bestReferenceLabel(a, 1, b)).toBe(2);
    const r = compareToReference(a, 1, b, 2, g, { kMin: 2, kMax: 5 });
    expect(r?.overlapVoxels).toBe(200);
    expect(r?.dice).toBeCloseTo(0.5, 6);
    expect(r?.volumeDiffPct).toBeCloseTo(0, 6);
  });

  it('returns undefined when the reference label is empty', () => {
    const a = new Labelmap(g);
    square(a, 1, 20, 30, 2, 5);
    expect(compareToReference(a, 1, new Labelmap(g), 1, g)).toBeUndefined();
  });
});
