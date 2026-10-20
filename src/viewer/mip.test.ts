import { describe, expect, it } from 'vitest';
import { halfSlab, mipSlice } from './mip';

describe('mipSlice', () => {
  it('takes the maximum over the slab and clips at the series ends', () => {
    const cols = 2;
    const rows = 1;
    const slices = 4;
    // pixel 0: -800, -700, 50, -900 ; pixel 1: -100, -900, -900, 300
    const hu = Int16Array.from([-800, -100, -700, -900, 50, -900, -900, 300]);
    const v = { hu, cols, rows, slices };
    expect(Array.from(mipSlice(v, 1, 1))).toEqual([50, -100]);
    expect(Array.from(mipSlice(v, 0, 1))).toEqual([-700, -100]);
    expect(Array.from(mipSlice(v, 3, 0))).toEqual([-900, 300]);
  });

  it('converts slab thickness to slices per side', () => {
    expect(halfSlab(10, 1.25)).toBe(4);
    expect(halfSlab(0, 1.25)).toBe(0);
  });
});
