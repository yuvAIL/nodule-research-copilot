import type { CtSeries, DicomHeader, SkippedFile } from './types';

/**
 * Pure, framework-independent logic that turns a bag of parsed DICOM headers
 * into displayable series. Kept free of Cornerstone/browser APIs so it can be
 * unit-tested in Node.
 */

type Vec3 = [number, number, number];

const POSITION_EPSILON_MM = 0.01;

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Slice normal from ImageOrientationPatient (row cosines x column cosines). */
export function sliceNormal(iop: DicomHeader['imageOrientationPatient']): Vec3 | undefined {
  if (!iop) return undefined;
  const n = cross([iop[0], iop[1], iop[2]], [iop[3], iop[4], iop[5]]);
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-6) return undefined;
  return [n[0] / len, n[1] / len, n[2] / len];
}

/** Rough anatomical label of a slice plane, for display only. */
export function describeOrientation(iop: DicomHeader['imageOrientationPatient']): string {
  const n = sliceNormal(iop);
  if (!n) return 'unknown';
  const abs = n.map(Math.abs);
  const max = Math.max(...abs);
  if (max < 0.8) return 'oblique';
  if (abs[2] === max) return 'axial';
  if (abs[1] === max) return 'coronal';
  return 'sagittal';
}

function orientationKey(h: DicomHeader): string {
  return h.imageOrientationPatient ? h.imageOrientationPatient.map((v) => v.toFixed(3)).join(',') : 'none';
}

function geometryKey(h: DicomHeader): string {
  return `${h.rows}x${h.columns}|${orientationKey(h)}`;
}

/** Instances that the viewer can display in this milestone. */
export function isDisplayable(h: DicomHeader): { ok: true } | { ok: false; reason: string } {
  if (!h.hasPixelData) return { ok: false, reason: 'No pixel data (not an image instance).' };
  if (!h.rows || !h.columns) return { ok: false, reason: 'Missing Rows/Columns.' };
  if (h.numberOfFrames > 1) {
    return {
      ok: false,
      reason: `Multi-frame instance (${h.numberOfFrames} frames, e.g. Enhanced CT) — not supported in milestone 1.`,
    };
  }
  if (!h.seriesInstanceUid) return { ok: false, reason: 'Missing SeriesInstanceUID.' };
  return { ok: true };
}

interface SortResult {
  instances: DicomHeader[];
  method: CtSeries['sortMethod'];
  /** Position of each sorted instance along the slice normal (only for image-position sort). */
  positions?: number[];
}

/**
 * Orders slices. Preference: geometric position along the slice normal, then
 * InstanceNumber, then file name. For axial series, slice 1 is the most
 * superior (head-end) slice, matching common radiology viewers.
 */
export function sortSlices(instances: DicomHeader[]): SortResult {
  const first = instances[0];
  const normal = first ? sliceNormal(first.imageOrientationPatient) : undefined;
  const allHavePosition = instances.every((h) => h.imagePositionPatient);

  if (normal && allHavePosition) {
    const withPos = instances.map((h) => ({ h, d: dot(h.imagePositionPatient as Vec3, normal) }));
    // Descending projection: for axial (normal +Z in LPS, i.e. superior) this is head -> feet.
    withPos.sort((a, b) => b.d - a.d || (a.h.instanceNumber ?? 0) - (b.h.instanceNumber ?? 0));
    return { instances: withPos.map((x) => x.h), method: 'image-position', positions: withPos.map((x) => x.d) };
  }

  if (instances.every((h) => h.instanceNumber !== undefined)) {
    const sorted = [...instances].sort((a, b) => (a.instanceNumber as number) - (b.instanceNumber as number));
    return { instances: sorted, method: 'instance-number' };
  }

  const sorted = [...instances].sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }));
  return { instances: sorted, method: 'file-order' };
}

/** Spacing statistics and warnings from positions sorted along the normal. */
export function analyseSpacing(positions: number[]): { spacing?: number; warnings: string[] } {
  const warnings: string[] = [];
  if (positions.length < 2) return { warnings };

  const gaps: number[] = [];
  let duplicates = 0;
  for (let i = 1; i < positions.length; i++) {
    const gap = Math.abs((positions[i - 1] as number) - (positions[i] as number));
    if (gap < POSITION_EPSILON_MM) duplicates++;
    else gaps.push(gap);
  }

  if (duplicates > 0) {
    warnings.push(
      `${duplicates} slice(s) share a position with another slice. The series may contain several acquisitions or phases; scrolling will show them interleaved.`,
    );
  }

  const spacing = median(gaps);
  if (spacing !== undefined) {
    const missing = gaps.filter((g) => g > spacing * 1.5).length;
    if (missing > 0) {
      warnings.push(`${missing} gap(s) larger than 1.5× the median spacing (${spacing.toFixed(2)} mm) — slices may be missing.`);
    } else {
      const min = Math.min(...gaps);
      const max = Math.max(...gaps);
      if (max - min > Math.max(0.05, spacing * 0.1)) {
        warnings.push(`Slice spacing is not uniform (${min.toFixed(2)}–${max.toFixed(2)} mm).`);
      }
    }
  }
  return { spacing, warnings };
}

function buildLabel(first: DicomHeader, count: number): string {
  const parts: string[] = [];
  if (first.seriesNumber !== undefined) parts.push(`#${first.seriesNumber}`);
  parts.push(first.modality || '??');
  if (first.seriesDescription) parts.push(first.seriesDescription);
  if (first.sliceThickness) parts.push(`${first.sliceThickness} mm`);
  if (first.convolutionKernel) parts.push(first.convolutionKernel);
  return `${parts.join(' · ')} — ${count} slice${count === 1 ? '' : 's'}`;
}

export interface BuildResult {
  series: CtSeries[];
  skipped: SkippedFile[];
}

/** Groups headers into series, sorts their slices and collects warnings. */
export function buildSeries(headers: DicomHeader[]): BuildResult {
  const skipped: SkippedFile[] = [];
  const bySeries = new Map<string, DicomHeader[]>();

  for (const h of headers) {
    const check = isDisplayable(h);
    if (!check.ok) {
      skipped.push({ relativePath: h.relativePath, reason: check.reason });
      continue;
    }
    const list = bySeries.get(h.seriesInstanceUid) ?? [];
    list.push(h);
    bySeries.set(h.seriesInstanceUid, list);
  }

  const series: CtSeries[] = [];
  for (const [uid, all] of bySeries) {
    const warnings: string[] = [];

    // Drop exact duplicates (same SOP Instance UID selected twice).
    const seen = new Set<string>();
    const unique: DicomHeader[] = [];
    for (const h of all) {
      const key = h.sopInstanceUid || h.relativePath;
      if (seen.has(key)) {
        skipped.push({ relativePath: h.relativePath, reason: 'Duplicate SOPInstanceUID (same image selected twice).' });
        continue;
      }
      seen.add(key);
      unique.push(h);
    }

    // A stack must share image size and orientation. Keep the dominant geometry.
    const byGeometry = new Map<string, DicomHeader[]>();
    for (const h of unique) {
      const key = geometryKey(h);
      byGeometry.set(key, [...(byGeometry.get(key) ?? []), h]);
    }
    const groups = [...byGeometry.values()].sort((a, b) => b.length - a.length);
    const kept = groups[0] ?? [];
    for (const g of groups.slice(1)) {
      for (const h of g) {
        skipped.push({
          relativePath: h.relativePath,
          reason: 'Different image size or orientation from the rest of its series (e.g. a localizer).',
        });
      }
    }
    if (groups.length > 1) {
      warnings.push(`${unique.length - kept.length} image(s) with a different size/orientation were excluded from this series.`);
    }

    const first = kept[0];
    if (!first) continue;

    const sorted = sortSlices(kept);
    let spacing: number | undefined;
    if (sorted.positions) {
      const analysis = analyseSpacing(sorted.positions);
      spacing = analysis.spacing;
      warnings.push(...analysis.warnings);
    } else if (sorted.method === 'instance-number') {
      warnings.push('ImagePositionPatient/ImageOrientationPatient missing — slices ordered by InstanceNumber.');
    } else {
      warnings.push('No position or InstanceNumber information — slices ordered by file name. Order may be wrong.');
    }

    if (first.modality !== 'CT') {
      warnings.push(`Modality is "${first.modality || 'unknown'}", not CT. Hounsfield-unit window presets may not be meaningful.`);
    }
    const orientation = describeOrientation(first.imageOrientationPatient);
    if (orientation !== 'axial' && orientation !== 'unknown') {
      warnings.push(`Series is ${orientation}, not axial. Slice 1 is the end with the largest position along the slice normal.`);
    }
    if (kept.length < 2) warnings.push('Series contains a single image.');

    series.push({
      seriesInstanceUid: uid,
      instances: sorted.instances,
      label: buildLabel(first, sorted.instances.length),
      sortMethod: sorted.method,
      sliceSpacingMm: spacing,
      warnings,
    });
  }

  // CT first, then the largest series first: the most likely series of interest.
  series.sort((a, b) => {
    const ctA = a.instances[0]?.modality === 'CT' ? 0 : 1;
    const ctB = b.instances[0]?.modality === 'CT' ? 0 : 1;
    return ctA - ctB || b.instances.length - a.instances.length;
  });

  return { series, skipped };
}
