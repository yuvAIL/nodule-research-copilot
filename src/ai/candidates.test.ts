import { describe, expect, it } from 'vitest';
import { FindingsStore } from '../findings/store';
import { provenanceLabel } from '../findings/types';
import { makeGeometry, makeVolume } from '../measure/phantoms';
import type { RasterSegment } from '../reference/rasterize';
import { candidatesFromSegments, connectedComponents, positionEstimate } from './candidates';

const g = makeGeometry(40, 40, 20, 1, 1, 1); // slice k at z = -k mm, x = i mm
const S = 40 * 40;
const vox = (i: number, j: number, k: number) => k * S + j * 40 + i;

function cube(i0: number, j0: number, k0: number, n: number): number[] {
  const out: number[] = [];
  for (let k = k0; k < k0 + n; k++) for (let j = j0; j < j0 + n; j++) for (let i = i0; i < i0 + n; i++) out.push(vox(i, j, k));
  return out;
}

function segment(name: string, voxels: number[], label = 1): RasterSegment {
  const v = Int32Array.from([...voxels].sort((a, b) => a - b));
  return { label, number: label, name, voxelCount: v.length, kMin: 0, kMax: 19, voxels: v };
}

describe('connectedComponents', () => {
  it('separates two blobs and treats diagonal neighbours as connected', () => {
    const comps = connectedComponents(Int32Array.from([...cube(2, 2, 2, 3), ...cube(20, 20, 10, 2), vox(5, 5, 5)].sort((a, b) => a - b)), g);
    expect(comps.map((c) => c.length)).toEqual([28, 8]); // 27 + diagonal voxel (5,5,5) touches (4,4,4)
  });
});

describe('positionEstimate', () => {
  // "Lung" fills x 0..39, z 0..-19; +x = patient left, +z = head.
  const lung = Int32Array.from(cube(0, 0, 0, 20).concat(cube(20, 0, 0, 20)).sort((a, b) => a - b));
  it('reports side and third', () => {
    expect(positionEstimate(Int32Array.from(cube(30, 5, 1, 2)), lung, g)).toBe('Left lung · upper third');
    expect(positionEstimate(Int32Array.from(cube(3, 5, 16, 2)), lung, g)).toBe('Right lung · lower third');
  });
  it('gives no estimate without a lung mask', () => {
    expect(positionEstimate(Int32Array.from(cube(3, 5, 16, 2)), undefined, g)).toBeUndefined();
  });
});

describe('candidatesFromSegments', () => {
  it('splits the nodule segment, sorts by size and hides tiny pieces', () => {
    const set = candidatesFromSegments(
      [segment('lung', cube(0, 0, 0, 20), 1), segment('lung_nodules', [...cube(2, 2, 2, 3), ...cube(20, 20, 10, 2), vox(35, 35, 18)], 2)],
      g,
      5,
    );
    expect(set?.segment).toBe('lung_nodules');
    expect(set?.candidates.map((c) => c.volumeMm3)).toEqual([27, 8]);
    expect(set?.hiddenTiny).toBe(1);
    expect(set?.candidates[0]?.component).toBe(1);
  });
});

describe('FindingsStore.addAiCandidates', () => {
  it('adds candidates as AI findings to review, once per file', () => {
    const store = new FindingsStore(makeVolume(g, -850), 'series-ai');
    const cands = [{ component: 1, voxels: Int32Array.from(cube(5, 5, 5, 6)), position: 'Right lung · middle third' }];
    const ai = { model: 'TotalSegmentator', segment: 'lung_nodules', version: '2.18.0', fileUid: '1.2.3', runDate: '2026-10-20' };
    expect(store.addAiCandidates(cands, ai).added).toBe(1);
    const f = store.getSnapshot().findings[0];
    expect(f?.source).toBe('ai');
    expect(f?.status).toBe('unreviewed');
    expect(f?.measurement?.volumeMm3).toBe(216);
    expect(provenanceLabel(f!)).toBe('AI candidate (TotalSegmentator 2.18.0 · lung_nodules · run 2026-10-20)');
    expect(store.addAiCandidates(cands, ai)).toEqual({ added: 0, skipped: 1, firstId: undefined });
    store.dispose();
  });
});
