import { describe, expect, it } from 'vitest';
import { densityHint } from './density';
import { Labelmap } from './labelmap';

function setup(values: number[]) {
  const g = { cols: values.length, rows: 1, slices: 1 };
  const lm = new Labelmap(g);
  lm.data.fill(1);
  return { hu: Int16Array.from(values), lm };
}

describe('densityHint', () => {
  it('suggests solid, part-solid, ground-glass and calcified from HU', () => {
    const solid = setup([20, 40, -10, 30, 50]);
    expect(densityHint(solid.hu, solid.lm, 1, 0, 0)?.suggestion).toBe('solid');
    const ggo = setup([-650, -600, -700, -550, -620]);
    expect(densityHint(ggo.hu, ggo.lm, 1, 0, 0)?.suggestion).toBe('ground-glass');
    const part = setup([-600, -650, 20, 30, -500]);
    expect(densityHint(part.hu, part.lm, 1, 0, 0)?.suggestion).toBe('part-solid');
    const calc = setup([400, 500, 600, 20, 300]);
    expect(densityHint(calc.hu, calc.lm, 1, 0, 0)?.suggestion).toBe('calcified');
  });

  it('returns undefined for an empty label', () => {
    const s = setup([0, 0]);
    expect(densityHint(s.hu, s.lm, 2, 0, 0)).toBeUndefined();
  });
});
