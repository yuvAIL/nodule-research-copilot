import type { Vec3, Volume, VolumeGeometry } from './volume';

/** Synthetic test volumes with known geometry (used by unit tests only). */
export function makeGeometry(cols: number, rows: number, slices: number, cs: number, rs: number, ss: number): VolumeGeometry {
  return {
    cols,
    rows,
    slices,
    colSpacing: cs,
    rowSpacing: rs,
    sliceSpacing: ss,
    origins: Array.from({ length: slices }, (_, k): Vec3 => [0, 0, -k * ss]),
    rowCosines: [1, 0, 0],
    colCosines: [0, 1, 0],
  };
}

export function makeVolume(g: VolumeGeometry, background: number): Volume {
  return { ...g, hu: new Int16Array(g.cols * g.rows * g.slices).fill(background) };
}

/** Sets every voxel whose centre (in mm) satisfies `inside` to `value`. */
export function paint(volume: Volume, inside: (x: number, y: number, z: number) => boolean, value: number): number {
  let n = 0;
  for (let k = 0; k < volume.slices; k++) {
    for (let j = 0; j < volume.rows; j++) {
      for (let i = 0; i < volume.cols; i++) {
        if (inside(i * volume.colSpacing, j * volume.rowSpacing, k * volume.sliceSpacing)) {
          volume.hu[(k * volume.rows + j) * volume.cols + i] = value;
          n++;
        }
      }
    }
  }
  return n;
}
