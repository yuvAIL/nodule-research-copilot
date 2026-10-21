import { describe, expect, it } from 'vitest';
import { makeGeometry, makeVolume, paint } from '../measure/phantoms';
import { FindingsStore } from './store';

function setup() {
  const v = makeVolume(makeGeometry(80, 80, 40, 0.8, 0.8, 1.25), -850);
  paint(v, (x, y, z) => (x - 32) ** 2 + (y - 32) ** 2 + (z - 25) ** 2 <= 64, 40);
  return new FindingsStore(v, 'series-test');
}

describe('FindingsStore', () => {
  it('creates a measured finding from a click and selects it', () => {
    const s = setup();
    const r = s.clickSegment({ i: 40, j: 40, k: 20 }, {});
    expect(r.ok).toBe(true);
    const f = s.getSnapshot().findings[0];
    expect(f?.name).toBe('N1');
    expect(s.getSnapshot().selectedId).toBe(f?.id);
    expect(Math.abs((f?.measurement?.longMm ?? 0) - 16) <= 0.8 + 1e-9).toBe(true);
    // Clicking the same nodule again selects it instead of duplicating it.
    s.clickSegment({ i: 41, j: 40, k: 20 }, {});
    expect(s.getSnapshot().findings).toHaveLength(1);
    s.dispose();
  });

  it('brush edit changes the volume, marks it edited, and undo restores it', () => {
    const s = setup();
    s.clickSegment({ i: 40, j: 40, k: 20 }, {});
    const id = s.getSnapshot().selectedId as string;
    s.approve(id);
    expect(s.get(id)?.status).toBe('approved');
    const before = s.get(id)?.measurement?.volumeMm3 ?? 0;
    s.beginStroke(id, false);
    s.paint(20, 52, 40, 3, false); // add a bump outside the sphere edge
    s.endStroke();
    const after = s.get(id);
    expect((after?.measurement?.volumeMm3 ?? 0) > before).toBe(true);
    expect(after?.edited).toBe(true);
    expect(after?.status).toBe('unreviewed'); // edits require re-approval
    s.undoLast(id);
    expect(s.get(id)?.measurement?.volumeMm3).toBeCloseTo(before, 6);
    expect(s.get(id)?.status).toBe('approved');
    s.dispose();
  });

  it('re-segments with a different edge threshold and can reset', () => {
    const s = setup();
    s.clickSegment({ i: 40, j: 40, k: 20 }, {});
    const id = s.getSnapshot().selectedId as string;
    const original = s.get(id)?.measurement?.voxelCount;
    expect(s.resegment(id, { thresholdHu: 100 }).ok).toBe(false); // nothing above +100 HU
    expect(s.resegment(id, { thresholdHu: -700 }).ok).toBe(true);
    expect(s.get(id)?.segmentation?.thresholdHu).toBe(-700);
    s.resetEdits(id);
    expect(s.get(id)?.measurement?.voxelCount).toBe(original);
    s.dispose();
  });

  it('creates a manual finding with the brush when nothing is selected', () => {
    const s = setup();
    const id = s.beginStroke(undefined, false);
    s.paint(5, 10, 10, 2, false);
    s.endStroke();
    const f = s.get(id);
    expect(f?.source).toBe('manual');
    expect((f?.measurement?.voxelCount ?? 0) > 0).toBe(true);
    s.remove(id as string);
    expect(s.getSnapshot().findings).toHaveLength(0);
    s.dispose();
  });
});

describe('FindingsStore series identity', () => {
  it('exposes the series it belongs to and saves under a versioned key', () => {
    const s = setup();
    expect(s.seriesUid).toBe('series-test');
    s.dispose();
  });

  it('keeps the first proposal, needs re-approval after an edit, and undo restores outline and numbers', () => {
    const s = setup();
    s.clickSegment({ i: 40, j: 40, k: 20 }, {});
    const id = s.getSnapshot().selectedId as string;
    const proposal = s.get(id)?.proposal;
    expect(proposal?.volumeMm3).toBe(s.get(id)?.measurement?.volumeMm3);
    s.approve(id);
    const approvedVolume = s.get(id)?.approved?.measurement.volumeMm3;
    s.beginStroke(id, false);
    s.paint(20, 52, 40, 3, false);
    s.endStroke();
    const edited = s.get(id);
    expect(edited?.status).toBe('unreviewed');
    expect(edited?.proposal?.volumeMm3).toBe(proposal?.volumeMm3); // proposal unchanged by the edit
    expect(edited?.approved?.measurement.volumeMm3).toBe(approvedVolume); // history kept, but not the record
    s.undoLast(id);
    expect(s.get(id)?.measurement?.volumeMm3).toBe(approvedVolume);
    expect(s.get(id)?.status).toBe('approved');
    s.dispose();
  });

  it('a no-earlier-match decision and a match exclude each other', () => {
    const s = setup();
    s.clickSegment({ i: 40, j: 40, k: 20 }, {});
    const id = s.getSnapshot().selectedId as string;
    s.setNoPrior(id, true);
    expect(s.get(id)?.noPrior).toBeTruthy();
    s.setMatch(id, { status: 'Confident', prior: { key: 'k', source: 'app', patientId: 'P', timepoint: 'Baseline', date: '2006-09-05', series: '1', noduleId: 'N1' }, at: 1 });
    expect(s.get(id)?.noPrior).toBeUndefined();
    s.setNoPrior(id, true);
    expect(s.get(id)?.match).toBeUndefined();
    s.dispose();
  });

  it('records whether Type/Lobe were auto-filled or set by the researcher, and real screenshot files', () => {
    const s = setup();
    s.clickSegment({ i: 40, j: 40, k: 20 }, {});
    const id = s.getSnapshot().selectedId as string;
    s.setFields(id, { type: 'solid', lobe: 'RUL' }, 'auto');
    expect(s.get(id)?.fieldSource).toEqual({ type: 'auto', lobe: 'auto' });
    s.setFields(id, { lobe: 'RML' });
    expect(s.get(id)?.fieldSource).toEqual({ type: 'auto', lobe: 'researcher' });
    s.setFields(id, { type: '' });
    expect(s.get(id)?.fieldSource?.type).toBeUndefined();
    expect(s.get(id)?.screenshotFile).toBeUndefined();
    s.setScreenshotFile(id, 'P_Baseline_N1.png');
    expect(s.get(id)?.screenshotFile).toBe('P_Baseline_N1.png');
    s.dispose();
  });
});

