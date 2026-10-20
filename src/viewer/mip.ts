import type { ViewMapper } from '../components/annotationRenderer';

/**
 * Thick-slab maximum intensity projection (MIP) of the open series, computed in the
 * browser from the HU volume. In a lung window, nodules stay round bright blobs across
 * the slab while vessels become branching lines — the classic way to search for
 * nodules faster than slice by slice. Display aid only: all measurements still use
 * the original slices.
 */
export interface SlabVolume {
  hu: Int16Array;
  cols: number;
  rows: number;
  slices: number;
}

/** Maximum HU over slices k−half … k+half (clipped to the series). */
export function mipSlice(v: SlabVolume, k: number, half: number): Int16Array {
  const size = v.cols * v.rows;
  const out = new Int16Array(size).fill(-32768);
  const k0 = Math.max(0, k - half);
  const k1 = Math.min(v.slices - 1, k + half);
  for (let kk = k0; kk <= k1; kk++) {
    const off = kk * size;
    for (let p = 0; p < size; p++) {
      const h = v.hu[off + p] as number;
      if (h > (out[p] as number)) out[p] = h;
    }
  }
  return out;
}

/** Number of slices on each side of the current slice for a slab of `thicknessMm`. */
export function halfSlab(thicknessMm: number, sliceSpacingMm: number): number {
  return Math.max(0, Math.round(thicknessMm / sliceSpacingMm / 2));
}

let cache: { key: string; mip: Int16Array } | undefined;
let rendered: { key: string; canvas: HTMLCanvasElement } | undefined;

/** Draws the slab MIP for the displayed slice, using the viewport's zoom/pan and window. */
export function drawMip(
  ctx: CanvasRenderingContext2D,
  view: ViewMapper,
  v: SlabVolume & { sliceSpacing: number },
  thicknessMm: number,
  voi: { lower: number; upper: number },
): void {
  const k = view.sliceIndex;
  if (k < 0 || k >= v.slices) return;
  const half = halfSlab(thicknessMm, v.sliceSpacing);
  const key = `${v.hu.length}|${k}|${half}`;
  if (cache?.key !== key) cache = { key, mip: mipSlice(v, k, half) };
  const rkey = `${key}|${voi.lower}|${voi.upper}`;
  if (rendered?.key !== rkey) {
    const canvas = rendered?.canvas ?? document.createElement('canvas');
    canvas.width = v.cols;
    canvas.height = v.rows;
    const c = canvas.getContext('2d');
    if (!c) return;
    const img = c.createImageData(v.cols, v.rows);
    const span = Math.max(1, voi.upper - voi.lower);
    const mip = cache.mip;
    for (let p = 0; p < mip.length; p++) {
      const g = Math.max(0, Math.min(255, (((mip[p] as number) - voi.lower) / span) * 255));
      const q = p * 4;
      img.data[q] = g;
      img.data[q + 1] = g;
      img.data[q + 2] = g;
      img.data[q + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    rendered = { key: rkey, canvas };
  }
  const o = view.voxelToCanvas(0, 0);
  const ex = view.voxelToCanvas(1, 0);
  const ey = view.voxelToCanvas(0, 1);
  const a = ex[0] - o[0];
  const b = ex[1] - o[1];
  const c2 = ey[0] - o[0];
  const d = ey[1] - o[1];
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.transform(a, b, c2, d, o[0] - 0.5 * (a + c2), o[1] - 0.5 * (b + d));
  ctx.drawImage(rendered.canvas, 0, 0);
  ctx.restore();
}
