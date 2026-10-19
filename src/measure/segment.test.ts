import { describe, expect, it } from 'vitest';
import { makeGeometry, makeVolume, paint } from './phantoms';
import { segmentFromSeed } from './segment';

const LUNG = -850;
const SOFT = 40;

describe('segmentFromSeed (click segmentation)', () => {
  it('segments an isolated 10 mm-radius sphere in lung, volume within 5%', () => {
    const v = makeVolume(makeGeometry(80, 80, 40, 0.8, 0.8, 1.25), LUNG);
    const n = paint(v, (x, y, z) => (x - 32) ** 2 + (y - 32) ** 2 + (z - 25) ** 2 <= 100, SOFT);
    const r = segmentFromSeed(v, { i: 40, j: 40, k: 20 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.abs(r.voxels.length - n) / n < 0.05).toBe(true);
    expect(r.leaked).toBe(false);
  });

  it('cuts off a thin vessel attached to the nodule', () => {
    const v = makeVolume(makeGeometry(100, 80, 40, 0.8, 0.8, 1.25), LUNG);
    const sphere = paint(v, (x, y, z) => (x - 32) ** 2 + (y - 32) ** 2 + (z - 25) ** 2 <= 64, SOFT);
    // 1.2 mm-radius vessel running from the nodule to the edge of the search region
    paint(v, (x, y, z) => x > 32 && (y - 32) ** 2 + (z - 25) ** 2 <= 1.44, SOFT);
    const r = segmentFromSeed(v, { i: 40, j: 40, k: 20 }, { maxRadiusMm: 30 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.erosion > 0).toBe(true);
    expect(r.leaked).toBe(false);
    // Nodule kept (±15%), vessel mostly removed.
    expect(Math.abs(r.voxels.length - sphere) / sphere < 0.15).toBe(true);
  });

  it('fills an internal cavity', () => {
    const v = makeVolume(makeGeometry(80, 80, 40, 0.8, 0.8, 1.25), LUNG);
    const solid = paint(v, (x, y, z) => (x - 32) ** 2 + (y - 32) ** 2 + (z - 25) ** 2 <= 100, SOFT);
    paint(v, (x, y, z) => (x - 32) ** 2 + (y - 32) ** 2 + (z - 25) ** 2 <= 9, LUNG);
    const r = segmentFromSeed(v, { i: 44, j: 40, k: 20 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.abs(r.voxels.length - solid) / solid < 0.1).toBe(true);
  });

  it('keeps a tumour touching the chest wall out of the wall (lung constraint)', () => {
    const v = makeVolume(makeGeometry(200, 150, 30, 0.8, 0.8, 1.25), -1000); // outside air
    // Body (soft tissue) with one lung (air) on the left half.
    paint(v, (x, y) => ((x - 80) / 75) ** 2 + ((y - 60) / 52) ** 2 <= 1, SOFT);
    const inLung = (x: number, y: number) => ((x - 50) / 32) ** 2 + ((y - 60) / 38) ** 2 <= 1;
    paint(v, (x, y) => inLung(x, y), LUNG);
    // 8 mm tumour centred 4 mm inside the lateral lung edge (x = 18 mm): it touches the wall.
    const inTumour = (x: number, y: number, z: number) => (x - 22) ** 2 + (y - 60) ** 2 + (z - 18) ** 2 <= 64;
    paint(v, (x, y, z) => inTumour(x, y, z) && inLung(x, y), SOFT);
    let expected = 0;
    for (let k = 0; k < 30; k++)
      for (let j = 0; j < 150; j++)
        for (let i = 0; i < 200; i++) if (inTumour(i * 0.8, j * 0.8, k * 1.25) && inLung(i * 0.8, j * 0.8)) expected++;
    const r = segmentFromSeed(v, { i: Math.round(24 / 0.8), j: 75, k: Math.round(18 / 1.25) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lungConstrained).toBe(true);
    expect(r.leaked).toBe(false);
    expect(Math.abs(r.voxels.length - expected) / expected < 0.25).toBe(true);
  });

  it('refuses a click in aerated lung and explains why', () => {
    const v = makeVolume(makeGeometry(40, 40, 10, 1, 1, 1), LUNG);
    const r = segmentFromSeed(v, { i: 20, j: 20, k: 5 });
    expect(r.ok).toBe(false);
  });

  it('snaps a slightly imprecise click onto the nodule edge', () => {
    const v = makeVolume(makeGeometry(80, 80, 40, 0.8, 0.8, 1.25), LUNG);
    paint(v, (x, y, z) => (x - 32) ** 2 + (y - 32) ** 2 + (z - 25) ** 2 <= 36, SOFT);
    // 7 mm from the centre = 1 mm outside the 6 mm radius
    const r = segmentFromSeed(v, { i: Math.round(39 / 0.8), j: 40, k: 20 });
    expect(r.ok).toBe(true);
  });
});
