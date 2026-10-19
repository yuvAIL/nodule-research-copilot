/**
 * CT window presets in Hounsfield units. Cornerstone3D applies the DICOM
 * Rescale Slope/Intercept when decoding, so pixel values are in HU and these
 * ranges can be used directly as the viewport VOI range.
 */
export interface WindowPreset {
  id: string;
  label: string;
  width: number;
  center: number;
}

export const WINDOW_PRESETS: readonly WindowPreset[] = [
  { id: 'lung', label: 'Lung', width: 1500, center: -600 },
  { id: 'mediastinum', label: 'Mediastinum', width: 350, center: 50 },
  { id: 'bone', label: 'Bone', width: 1800, center: 400 },
] as const;

export const DEFAULT_PRESET_ID = 'lung';

export interface VoiRange {
  lower: number;
  upper: number;
}

export function windowToRange(width: number, center: number): VoiRange {
  const w = Math.max(1, width);
  return { lower: center - w / 2, upper: center + w / 2 };
}

export function rangeToWindow(range: VoiRange): { width: number; center: number } {
  return { width: range.upper - range.lower, center: (range.upper + range.lower) / 2 };
}

export function getPreset(id: string): WindowPreset {
  const preset = WINDOW_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown window preset: ${id}`);
  return preset;
}

/** Name of the preset matching a range (within 1 HU), or undefined for a custom window. */
export function matchPreset(range: VoiRange): WindowPreset | undefined {
  const { width, center } = rangeToWindow(range);
  return WINDOW_PRESETS.find((p) => Math.abs(p.width - width) < 1 && Math.abs(p.center - center) < 1);
}
