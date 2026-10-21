import { describe, expect, it } from 'vitest';
import { activeMs, sessionRow, sessionStats } from './session';
import type { Finding } from './types';

function f(over: Partial<Finding>): Finding {
  return {
    id: Math.random().toString(),
    label: 1,
    name: 'N1',
    source: 'ai',
    edited: false,
    status: 'unreviewed',
    kMin: 0,
    kMax: 0,
    type: '',
    lobe: '',
    notes: '',
    timeline: [{ t: 0, action: 'created' }],
    ...over,
  };
}

describe('sessionStats', () => {
  it('counts AI decisions, researcher additions and time from timestamps', () => {
    const s = sessionStats([
      f({ status: 'approved', edited: true, timeline: [{ t: 0, action: 'created' }, { t: 30_000, action: 'approved' }] }),
      f({ status: 'rejected', timeline: [{ t: 0, action: 'created' }, { t: 40_000, action: 'rejected' }] }),
      f({ source: 'click', status: 'approved', timeline: [{ t: 50_000, action: 'created' }, { t: 140_000, action: 'approved' }] }),
      f({}),
    ]);
    expect(s).toMatchObject({ aiCandidates: 3, aiAccepted: 1, aiRejected: 1, aiAcceptedEdited: 1, addedByResearcher: 1, accepted: 2, toReview: 1 });
    expect(s.timeOnScanMs).toBe(140_000);
    expect(s.medianSecondsPerAccepted).toBe(60); // (30 + 90) / 2
    expect(sessionRow(undefined, s, 2)['Minutes on scan']).toBe('2.3');
  });
});

describe('sessionStats: corrections, pauses, exports', () => {
  it('credits work to findings, counts corrections and leaves breaks out', () => {
    const a = f({
      id: 'a',
      status: 'approved',
      edited: true,
      timeline: [
        { t: 0, action: 'created' },
        { t: 20_000, action: 'edited' },
        { t: 30_000, action: 'edited' },
        { t: 40_000, action: 'approved' },
      ],
    });
    const b = f({ id: 'b', status: 'rejected', timeline: [{ t: 0, action: 'created' }, { t: 45_000, action: 'rejected' }] });
    // a 10-minute break, then one more finding and an export
    const c = f({ id: 'c', source: 'click', status: 'approved', timeline: [{ t: 645_000, action: 'created' }, { t: 665_000, action: 'approved' }] });
    const s = sessionStats([a, b, c], [675_000]);
    expect(s.corrections).toBe(2);
    expect(s.findingsCorrected).toBe(1);
    expect(s.correctionMs).toBe(30_000); // 0→20 s and 20→30 s
    expect(s.pausesExcluded).toBe(1);
    expect(s.pausedMs).toBe(600_000);
    expect(s.timeOnScanMs).toBe(45_000 + 20_000 + 10_000);
    expect(s.exports).toBe(1);
    expect(s.medianActiveSecondsPerDecided).toBe(20); // a 40 s, b 5 s, c 20 s
    const row = sessionRow(undefined, s, 2);
    expect(row['Outline corrections']).toBe('2');
    expect(row['Paused minutes (not counted)']).toBe('10.0');
  });
});

describe('activeMs', () => {
  it('excludes breaks longer than two minutes', () => {
    expect(activeMs([0, 30_000, 60_000, 60_000 + 10 * 60_000, 60_000 + 10 * 60_000 + 20_000])).toBe(80_000);
    expect(activeMs([5])).toBeUndefined();
  });
});
