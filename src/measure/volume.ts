/**
 * A CT series as a 3D voxel grid in Hounsfield units, plus the DICOM geometry
 * needed to convert between voxel indices and patient coordinates (LPS, mm).
 *
 * Index convention: i = column (along the DICOM row direction), j = row
 * (along the column direction), k = slice index in display order.
 * Voxel (i, j, k) is stored at  k * cols * rows + j * cols + i.
 */
export type Vec3 = [number, number, number];

export interface VolumeGeometry {
  cols: number;
  rows: number;
  slices: number;
  /** mm between adjacent columns (DICOM PixelSpacing[1]). */
  colSpacing: number;
  /** mm between adjacent rows (DICOM PixelSpacing[0]). */
  rowSpacing: number;
  /** mm between adjacent slice centres (median along the slice normal). */
  sliceSpacing: number;
  /** ImagePositionPatient of each slice, in display order. */
  origins: Vec3[];
  /** Direction of increasing column index (ImageOrientationPatient[0..2]). */
  rowCosines: Vec3;
  /** Direction of increasing row index (ImageOrientationPatient[3..5]). */
  colCosines: Vec3;
}

export interface Volume extends VolumeGeometry {
  /** Hounsfield units, length cols * rows * slices. */
  hu: Int16Array;
}

export function voxelIndex(g: Pick<VolumeGeometry, 'cols' | 'rows'>, i: number, j: number, k: number): number {
  return k * g.cols * g.rows + j * g.cols + i;
}

export function voxelVolumeMm3(g: VolumeGeometry): number {
  return g.colSpacing * g.rowSpacing * g.sliceSpacing;
}

/** Patient coordinate (mm) of a (possibly fractional) voxel position. */
export function voxelToWorld(g: VolumeGeometry, i: number, j: number, k: number): Vec3 {
  const o = g.origins[Math.max(0, Math.min(g.slices - 1, Math.round(k)))] as Vec3;
  const r = g.rowCosines;
  const c = g.colCosines;
  const di = i * g.colSpacing;
  const dj = j * g.rowSpacing;
  return [o[0] + di * r[0] + dj * c[0], o[1] + di * r[1] + dj * c[1], o[2] + di * r[2] + dj * c[2]];
}

/** In-plane voxel position (fractional i, j) of a world point projected onto slice k. */
export function worldToVoxelInSlice(g: VolumeGeometry, world: Vec3, k: number): { i: number; j: number } {
  const o = g.origins[k] as Vec3;
  const d: Vec3 = [world[0] - o[0], world[1] - o[1], world[2] - o[2]];
  const r = g.rowCosines;
  const c = g.colCosines;
  return {
    i: (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / g.colSpacing,
    j: (d[0] * c[0] + d[1] * c[1] + d[2] * c[2]) / g.rowSpacing,
  };
}

/** Slice index whose plane is closest to a world point. */
export function nearestSlice(g: VolumeGeometry, world: Vec3): number {
  const n = cross(g.rowCosines, g.colCosines);
  const p = dot(world, n);
  let best = 0;
  let bestDist = Infinity;
  g.origins.forEach((o, k) => {
    const d = Math.abs(dot(o, n) - p);
    if (d < bestDist) {
      bestDist = d;
      best = k;
    }
  });
  return best;
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
