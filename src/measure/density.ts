import type { Labelmap } from './labelmap';

/**
 * Density summary of an outline, used to SUGGEST a nodule type. It is a rule of thumb on
 * HU values (solid tissue > −300 HU, calcium > 200 HU), not a classification model —
 * the researcher decides the type.
 */
export interface DensityHint {
  meanHu: number;
  /** Share of voxels above −300 HU. */
  solidFraction: number;
  /** Share of voxels above 200 HU. */
  calcifiedFraction: number;
  suggestion: 'solid' | 'part-solid' | 'ground-glass' | 'calcified';
}

export const SOLID_HU = -300;
export const CALCIFIED_HU = 200;

export function densityHint(hu: Int16Array, labelmap: Labelmap, label: number, kMin: number, kMax: number): DensityHint | undefined {
  let n = 0;
  let sum = 0;
  let solid = 0;
  let calc = 0;
  const from = Math.max(0, kMin) * labelmap.sliceSize;
  const to = (Math.min(labelmap.slices - 1, kMax) + 1) * labelmap.sliceSize;
  for (let p = from; p < to; p++) {
    if (labelmap.data[p] !== label) continue;
    const h = hu[p] as number;
    n++;
    sum += h;
    if (h > SOLID_HU) solid++;
    if (h > CALCIFIED_HU) calc++;
  }
  if (n === 0) return undefined;
  const solidFraction = solid / n;
  const calcifiedFraction = calc / n;
  const suggestion =
    calcifiedFraction > 0.5 ? 'calcified' : solidFraction >= 0.8 ? 'solid' : solidFraction <= 0.2 ? 'ground-glass' : 'part-solid';
  return { meanHu: sum / n, solidFraction, calcifiedFraction, suggestion };
}
