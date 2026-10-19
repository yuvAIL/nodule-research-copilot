import { describe, expect, it } from 'vitest';
import { Labelmap, decodeRle, encodeRle } from './labelmap';
import { measureLabel, sliceAxes, type Point2 } from './measure';
import { makeGeometry } from './phantoms';

function ellipsePixels(a: number, b: number, angleDeg: number, cs: number, rs: number, cx: number, cy: number): Point2[] {
  const t = (angleDeg * Math.PI) / 180;
  const out: Point2[] = [];
  for (let j = 0; j < 200; j++) {
    for (let i = 0; i < 200; i++) {
      const x = i * cs - cx;
      const y = j * rs - cy;
      const u = x * Math.cos(t) + y * Math.sin(t);
      const v = -x * Math.sin(t) + y * Math.cos(t);
      if ((u / a) ** 2 + (v / b) ** 2 <= 1) out.push([i, j]);
    }
  }
  return out;
}

describe('sliceAxes (2D long/short axis)', () => {
  it('measures an axis-aligned ellipse 20 × 12 mm within one pixel', () => {
    const r = sliceAxes(ellipsePixels(10, 6, 0, 0.7, 0.7, 50, 50), 0.7, 0.7);
    expect(Math.abs((r?.longMm ?? 0) - 20) < 0.7).toBe(true);
    expect(Math.abs((r?.shortMm ?? 0) - 12) < 0.7).toBe(true);
  });

  it('measures a rotated ellipse (35°) with anisotropic pixels', () => {
    const r = sliceAxes(ellipsePixels(15, 8, 35, 0.6, 0.9, 60, 60), 0.6, 0.9);
    expect(Math.abs((r?.longMm ?? 0) - 30) < 1.0).toBe(true);
    expect(Math.abs((r?.shortMm ?? 0) - 16) < 1.0).toBe(true);
  });

  it('reports one pixel for a single-pixel mask', () => {
    const r = sliceAxes([[5, 5]], 0.8, 0.8);
    expect(r?.longMm).toBeCloseTo(0.8, 5);
  });
});

describe('measureLabel (3D)', () => {
  it('finds the largest slice of a sphere and its volume within 5%', () => {
    const g = makeGeometry(64, 64, 40, 0.8, 0.8, 1.25);
    const lm = new Labelmap(g);
    const c = [25.6, 25.6, 25];
    const r = 8;
    for (let k = 0; k < g.slices; k++)
      for (let j = 0; j < g.rows; j++)
        for (let i = 0; i < g.cols; i++) {
          const d2 = (i * 0.8 - c[0]!) ** 2 + (j * 0.8 - c[1]!) ** 2 + (k * 1.25 - c[2]!) ** 2;
          if (d2 <= r * r) lm.data[(k * g.rows + j) * g.cols + i] = 1;
        }
    const m = measureLabel(lm, g, 1);
    const expected = (4 / 3) * Math.PI * r ** 3;
    expect(Math.abs((m?.volumeMm3 ?? 0) - expected) / expected < 0.05).toBe(true);
    // Largest cross-section is at slice 20; pixel rounding may make a neighbour measure equal or 1 px longer.
    expect(Math.abs((m?.sliceIndex ?? 0) - 20) <= 1).toBe(true);
    // Diameters are accurate to one pixel (0.8 mm here).
    expect(Math.abs((m?.longMm ?? 0) - 16) <= 0.8 + 1e-9).toBe(true);
    expect(Math.abs((m?.shortMm ?? 0) - 16) <= 0.8 + 1e-9).toBe(true);
  });

  it('returns undefined for an absent label', () => {
    const g = makeGeometry(8, 8, 2, 1, 1, 1);
    expect(measureLabel(new Labelmap(g), g, 3)).toBeUndefined();
  });
});

describe('Labelmap editing', () => {
  it('paints and erases discs without touching other labels, and undoes', () => {
    const g = makeGeometry(40, 40, 3, 1, 1, 1);
    const lm = new Labelmap(g);
    lm.data[1 * 1600 + 20 * 40 + 20] = 2; // another finding's voxel
    const snap = lm.snapshot([1]);
    lm.paintDisc(1, 20, 20, 5, 1, 1, 1, false);
    expect(lm.data[1 * 1600 + 20 * 40 + 20]).toBe(2);
    const painted = lm.countLabel(1);
    expect(painted > 70 && painted < 85).toBe(true); // π·5² ≈ 78.5
    lm.paintDisc(1, 20, 20, 2, 1, 1, 1, true);
    expect(lm.countLabel(1) < painted).toBe(true);
    lm.restore(snap);
    expect(lm.countLabel(1)).toBe(0);
    expect(lm.countLabel(2)).toBe(1);
  });

  it('round-trips through run-length encoding', () => {
    const data = new Uint8Array(1000);
    data.fill(3, 100, 180);
    data.fill(1, 500, 501);
    const back = decodeRle(encodeRle(data), data.length);
    expect(Array.from(back)).toEqual(Array.from(data));
    expect(() => decodeRle(encodeRle(data), 999)).toThrow();
  });
});
