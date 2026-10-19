import { describe, expect, it } from 'vitest';
import { getPreset, matchPreset, rangeToWindow, windowToRange } from './windowPresets';

describe('window presets', () => {
  it('lung window W1500/L-600 maps to HU range [-1350, 150]', () => {
    const lung = getPreset('lung');
    expect(windowToRange(lung.width, lung.center)).toEqual({ lower: -1350, upper: 150 });
  });

  it('round-trips between window and range', () => {
    expect(rangeToWindow(windowToRange(350, 50))).toEqual({ width: 350, center: 50 });
  });

  it('identifies a preset from a range and returns undefined for custom windows', () => {
    expect(matchPreset({ lower: -1350, upper: 150 })?.id).toBe('lung');
    expect(matchPreset({ lower: -1000, upper: 200 })).toBeUndefined();
  });

  it('rejects unknown presets', () => {
    expect(() => getPreset('nope')).toThrow();
  });
});
