import { Labelmap } from '../measure/labelmap';
import { cross, dot, nearestSlice, voxelToWorld, worldToVoxelInSlice, type Vec3, type VolumeGeometry } from '../measure/volume';
import type { Contour, ReferenceObject, SegReference } from './types';

/**
 * Places an expert outline on the open CT series' voxel grid, using patient
 * coordinates only (no assumptions about file order). The result is a separate,
 * read-only labelmap: label n = the n-th segment of the reference object.
 */
export interface RasterSegment {
  label: number;
  /** SegmentNumber / ROINumber in the file. */
  number: number;
  name: string;
  voxelCount: number;
  /** Slice range containing the segment (kMin > kMax when it is empty). */
  kMin: number;
  kMax: number;
}

export interface RasterizedReference {
  labelmap: Labelmap;
  segments: RasterSegment[];
  warnings: string[];
}

/** Planes further than this fraction of the slice spacing from every CT slice are not placed. */
const MAX_PLANE_OFFSET = 0.5;

function planeOffset(g: VolumeGeometry, k: number, p: Vec3): number {
  const n = cross(g.rowCosines, g.colCosines);
  const o = g.origins[k] as Vec3;
  return Math.abs(dot([p[0] - o[0], p[1] - o[1], p[2] - o[2]], n));
}

export function rasterizeReference(ref: ReferenceObject, g: VolumeGeometry): RasterizedReference {
  const labelmap = new Labelmap(g);
  const warnings: string[] = [];
  const labelOf = new Map<number, number>();
  const segments: RasterSegment[] = [];
  ref.segments.slice(0, 255).forEach((s, idx) => {
    labelOf.set(s.number, idx + 1);
    segments.push({ label: idx + 1, number: s.number, name: s.name, voxelCount: 0, kMin: Infinity, kMax: -Infinity });
  });
  if (ref.segments.length > 255) warnings.push(`Only the first 255 of ${ref.segments.length} segments are shown.`);

  if (ref.kind === 'SEG') rasterizeSeg(ref, g, labelmap, labelOf, warnings);
  else rasterizeContours(ref.contours, g, labelmap, labelOf, warnings);

  for (let p = 0; p < labelmap.data.length; p++) {
    const l = labelmap.data[p] as number;
    if (!l) continue;
    const s = segments[l - 1];
    if (!s) continue;
    s.voxelCount++;
    const k = Math.floor(p / labelmap.sliceSize);
    if (k < s.kMin) s.kMin = k;
    if (k > s.kMax) s.kMax = k;
  }
  return { labelmap, segments, warnings };
}

function rasterizeSeg(
  ref: SegReference,
  g: VolumeGeometry,
  labelmap: Labelmap,
  labelOf: Map<number, number>,
  warnings: string[],
): void {
  const ctNormal = cross(g.rowCosines, g.colCosines);
  const segNormal = cross(ref.rowCosines, ref.colCosines);
  if (Math.abs(dot(ctNormal, segNormal)) < 0.999) {
    warnings.push('The outline was drawn on differently oriented planes; it was not placed.');
    return;
  }
  const [segRowSpacing, segColSpacing] = ref.pixelSpacing;
  let outside = 0;
  for (const frame of ref.frames) {
    const label = labelOf.get(frame.segmentNumber);
    if (!label) continue;
    if (!frame.mask.some((v) => v)) continue;
    const k = nearestSlice(g, frame.position);
    if (planeOffset(g, k, frame.position) > MAX_PLANE_OFFSET * g.sliceSpacing) {
      outside++;
      continue;
    }
    // Bounding box of the frame's foreground, mapped into CT voxels (handles different grids).
    let r0 = ref.rows;
    let r1 = -1;
    let c0 = ref.cols;
    let c1 = -1;
    for (let p = 0; p < frame.mask.length; p++) {
      if (!frame.mask[p]) continue;
      const r = Math.floor(p / ref.cols);
      const c = p % ref.cols;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
    }
    const corner = (r: number, c: number): Vec3 => [
      frame.position[0] + c * segColSpacing * ref.rowCosines[0] + r * segRowSpacing * ref.colCosines[0],
      frame.position[1] + c * segColSpacing * ref.rowCosines[1] + r * segRowSpacing * ref.colCosines[1],
      frame.position[2] + c * segColSpacing * ref.rowCosines[2] + r * segRowSpacing * ref.colCosines[2],
    ];
    const box = [corner(r0 - 1, c0 - 1), corner(r0 - 1, c1 + 1), corner(r1 + 1, c0 - 1), corner(r1 + 1, c1 + 1)].map((w) =>
      worldToVoxelInSlice(g, w, k),
    );
    const iMin = Math.max(0, Math.floor(Math.min(...box.map((b) => b.i))));
    const iMax = Math.min(g.cols - 1, Math.ceil(Math.max(...box.map((b) => b.i))));
    const jMin = Math.max(0, Math.floor(Math.min(...box.map((b) => b.j))));
    const jMax = Math.min(g.rows - 1, Math.ceil(Math.max(...box.map((b) => b.j))));
    const slice = labelmap.sliceView(k);
    for (let j = jMin; j <= jMax; j++) {
      for (let i = iMin; i <= iMax; i++) {
        const w = voxelToWorld(g, i, j, k);
        const d: Vec3 = [w[0] - frame.position[0], w[1] - frame.position[1], w[2] - frame.position[2]];
        const c = Math.round(dot(d, ref.rowCosines) / segColSpacing);
        const r = Math.round(dot(d, ref.colCosines) / segRowSpacing);
        if (r < 0 || c < 0 || r >= ref.rows || c >= ref.cols) continue;
        if (frame.mask[r * ref.cols + c]) slice[j * g.cols + i] = label;
      }
    }
  }
  if (outside) warnings.push(`${outside} outline plane(s) do not match any slice of this series and were not placed.`);
}

/** Even-odd fill of one polygon (fractional voxel coordinates) into a slice mask; XOR so holes stay empty. */
export function fillPolygon(mask: Uint8Array, cols: number, rows: number, poly: { i: number; j: number }[]): void {
  if (poly.length < 3) return;
  let jMin = Infinity;
  let jMax = -Infinity;
  for (const p of poly) {
    jMin = Math.min(jMin, p.j);
    jMax = Math.max(jMax, p.j);
  }
  const inside = new Uint8Array(cols);
  for (let j = Math.max(0, Math.ceil(jMin)); j <= Math.min(rows - 1, Math.floor(jMax)); j++) {
    const xs: number[] = [];
    for (let n = 0; n < poly.length; n++) {
      const a = poly[n] as { i: number; j: number };
      const b = poly[(n + 1) % poly.length] as { i: number; j: number };
      if ((a.j <= j && b.j > j) || (b.j <= j && a.j > j)) xs.push(a.i + ((j - a.j) * (b.i - a.i)) / (b.j - a.j));
    }
    xs.sort((x, y) => x - y);
    inside.fill(0);
    for (let n = 0; n + 1 < xs.length; n += 2) {
      const from = Math.max(0, Math.ceil(xs[n] as number));
      const to = Math.min(cols - 1, Math.floor(xs[n + 1] as number));
      for (let i = from; i <= to; i++) inside[i] = 1;
    }
    const row = j * cols;
    for (let i = 0; i < cols; i++) if (inside[i]) mask[row + i] = (mask[row + i] as number) ^ 1;
  }
}

function rasterizeContours(
  contours: Contour[],
  g: VolumeGeometry,
  labelmap: Labelmap,
  labelOf: Map<number, number>,
  warnings: string[],
): void {
  // Group contours of the same ROI on the same slice, so inner contours (holes) cancel out.
  const groups = new Map<string, { label: number; k: number; polys: { i: number; j: number }[][] }>();
  let outside = 0;
  for (const c of contours) {
    const label = labelOf.get(c.roiNumber);
    if (!label) continue;
    const centre: Vec3 = [0, 0, 0];
    for (const p of c.points) {
      centre[0] += p[0] / c.points.length;
      centre[1] += p[1] / c.points.length;
      centre[2] += p[2] / c.points.length;
    }
    const k = nearestSlice(g, centre);
    if (planeOffset(g, k, centre) > MAX_PLANE_OFFSET * g.sliceSpacing) {
      outside++;
      continue;
    }
    const key = `${label}:${k}`;
    const group = groups.get(key) ?? { label, k, polys: [] };
    group.polys.push(c.points.map((p) => worldToVoxelInSlice(g, p, k)));
    groups.set(key, group);
  }
  const tmp = new Uint8Array(g.cols * g.rows);
  for (const { label, k, polys } of groups.values()) {
    tmp.fill(0);
    for (const poly of polys) fillPolygon(tmp, g.cols, g.rows, poly);
    const slice = labelmap.sliceView(k);
    for (let p = 0; p < tmp.length; p++) if (tmp[p]) slice[p] = label;
  }
  if (outside) warnings.push(`${outside} contour(s) do not lie on a slice of this series and were not placed.`);
}
