import type { VolumeGeometry } from './volume';

/**
 * One label value per voxel (0 = background, 1..255 = finding). All findings of
 * a series share one labelmap, so overlapping edits are impossible by design.
 * Undo works per stroke by remembering the previous content of touched slices.
 */
export class Labelmap {
  readonly data: Uint8Array;
  readonly cols: number;
  readonly rows: number;
  readonly slices: number;

  constructor(g: Pick<VolumeGeometry, 'cols' | 'rows' | 'slices'>, data?: Uint8Array) {
    this.cols = g.cols;
    this.rows = g.rows;
    this.slices = g.slices;
    this.data = data ?? new Uint8Array(g.cols * g.rows * g.slices);
  }

  get sliceSize(): number {
    return this.cols * this.rows;
  }

  sliceView(k: number): Uint8Array {
    return this.data.subarray(k * this.sliceSize, (k + 1) * this.sliceSize);
  }

  /** Copies of the given slices, for undo. */
  snapshot(slices: Iterable<number>): Map<number, Uint8Array> {
    const out = new Map<number, Uint8Array>();
    for (const k of slices) if (!out.has(k)) out.set(k, this.sliceView(k).slice());
    return out;
  }

  restore(snapshot: Map<number, Uint8Array>): void {
    for (const [k, slice] of snapshot) this.sliceView(k).set(slice);
  }

  /** Removes every voxel of a label. Returns the touched slices' snapshot. */
  clearLabel(label: number): Map<number, Uint8Array> {
    const touched = this.slicesWithLabel(label);
    const snap = this.snapshot(touched);
    for (const k of touched) {
      const s = this.sliceView(k);
      for (let p = 0; p < s.length; p++) if (s[p] === label) s[p] = 0;
    }
    return snap;
  }

  slicesWithLabel(label: number): number[] {
    const out: number[] = [];
    for (let k = 0; k < this.slices; k++) {
      const s = this.sliceView(k);
      for (let p = 0; p < s.length; p++) {
        if (s[p] === label) {
          out.push(k);
          break;
        }
      }
    }
    return out;
  }

  countLabel(label: number): number {
    let n = 0;
    for (let p = 0; p < this.data.length; p++) if (this.data[p] === label) n++;
    return n;
  }

  /**
   * Paints (or erases) a filled disc on slice k. Painting never overwrites
   * another finding's voxels; erasing only removes `label`.
   */
  paintDisc(
    k: number,
    centerI: number,
    centerJ: number,
    radiusMm: number,
    colSpacing: number,
    rowSpacing: number,
    label: number,
    erase: boolean,
  ): void {
    const s = this.sliceView(k);
    const ri = radiusMm / colSpacing;
    const rj = radiusMm / rowSpacing;
    const i0 = Math.max(0, Math.floor(centerI - ri));
    const i1 = Math.min(this.cols - 1, Math.ceil(centerI + ri));
    const j0 = Math.max(0, Math.floor(centerJ - rj));
    const j1 = Math.min(this.rows - 1, Math.ceil(centerJ + rj));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = (i - centerI) * colSpacing;
        const dy = (j - centerJ) * rowSpacing;
        if (dx * dx + dy * dy > radiusMm * radiusMm) continue;
        const p = j * this.cols + i;
        if (erase) {
          if (s[p] === label) s[p] = 0;
        } else if (s[p] === 0) {
          s[p] = label;
        }
      }
    }
  }
}

/** Run-length encoding [value, runLength, value, runLength, ...] — compact for sparse labelmaps. */
export function encodeRle(data: Uint8Array): Uint32Array {
  const runs: number[] = [];
  let value = data[0] ?? 0;
  let length = 0;
  for (let p = 0; p < data.length; p++) {
    const v = data[p] as number;
    if (v === value) {
      length++;
    } else {
      runs.push(value, length);
      value = v;
      length = 1;
    }
  }
  if (data.length > 0) runs.push(value, length);
  return Uint32Array.from(runs);
}

export function decodeRle(runs: Uint32Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let p = 0;
  for (let r = 0; r + 1 < runs.length; r += 2) {
    const value = runs[r] as number;
    const n = runs[r + 1] as number;
    if (value !== 0) out.fill(value, p, Math.min(length, p + n));
    p += n;
  }
  if (p !== length) throw new Error(`Saved outline does not match this series (${p} vs ${length} voxels).`);
  return out;
}
