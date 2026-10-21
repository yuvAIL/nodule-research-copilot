import { describe, expect, it } from 'vitest';
import { phaseBreakdown, sessionCounts, taskMs, timeSaved, type TimedSession } from './timing';
import type { Finding } from './types';

const T0 = 1_000_000;
const s = (sec: number) => T0 + sec * 1000;

function f(id: string, source: Finding['source'], events: [number, Finding['timeline'][number]['action']][], status: Finding['status'] = 'approved'): Finding {
  return {
    id,
    label: 1,
    name: id,
    source,
    edited: events.some(([, a]) => a === 'edited'),
    status,
    kMin: 0,
    kMax: 0,
    type: '',
    lobe: '',
    notes: '',
    timeline: events.map(([sec, action]) => ({ t: s(sec), action })),
  };
}

function session(over: Partial<TimedSession> = {}): TimedSession {
  return { id: 'a', mode: 'assisted', startedAt: s(0), endedAt: s(100), pauses: [], referenceShown: false, completed: true, ...over };
}

describe('timed sessions', () => {
  it('task time is Start → Finish minus explicit pauses only', () => {
    expect(taskMs(session())).toBe(100_000);
    expect(taskMs(session({ pauses: [{ from: s(10), to: s(40) }] }))).toBe(70_000);
    // An open pause at Finish counts up to Finish.
    expect(taskMs(session({ pauses: [{ from: s(90) }] }))).toBe(90_000);
  });

  it('phases add up exactly to the task time, pauses excluded, nothing dropped', () => {
    const findings = [
      f('N1', 'ai', [[-30, 'created'], [20, 'approved']]), // created before Start: not in the session
      f('N2', 'ai', [[-30, 'created'], [30, 'edited'], [50, 'edited'], [55, 'approved']]),
      f('N3', 'click', [[70, 'created'], [80, 'fields'], [85, 'approved']]),
    ];
    const sess = session({ pauses: [{ from: s(60), to: s(65) }] });
    const p = phaseBreakdown(sess, findings, [s(95)]);
    expect(p.review).toBe(20_000 + 5_000 + 5_000); // 0→20, 50→55, 80→85
    expect(p.correction).toBe(10_000 + 20_000); // 20→30, 30→50
    expect(p.adding).toBe(15_000 - 5_000); // 55→70 minus the 5 s pause
    expect(p.documentation).toBe(10_000 + 10_000); // 70→80 fields, 85→95 export
    expect(p.other).toBe(5_000); // 95→100 after the last action
    const total = p.review + p.correction + p.adding + p.documentation + p.other;
    expect(total).toBe(taskMs(sess));
  });

  it('counts only work done inside the session window', () => {
    const findings = [f('N1', 'ai', [[-5, 'created'], [-2, 'edited'], [10, 'approved']]), f('N2', 'manual', [[20, 'created'], [21, 'edited']], 'unreviewed')];
    const c = sessionCounts(findings, [s(-50), s(90)], session());
    expect(c).toMatchObject({ aiCandidates: 1, accepted: 1, edited: 1, addedByResearcher: 1, exports: 1 });
  });

  it('time saved only for scans with both a manual and a completed assisted session; negative allowed', () => {
    const scanA = { patientId: 'P', studyDate: '2006-09-05', timepoint: 'Baseline', seriesUid: 'A' };
    const scanB = { patientId: 'P', studyDate: '2006-09-20', timepoint: 'Follow-up 1', seriesUid: 'B' };
    const rows = timeSaved([
      session({ id: '1', scan: scanA, startedAt: s(0), endedAt: s(600) }), // 10 min assisted
      { id: '2', mode: 'manual-observed', scan: scanA, startedAt: 0, pauses: [], referenceShown: false, completed: true, enteredMs: 1_500_000 }, // 25 min
      session({ id: '3', scan: scanB, startedAt: s(0), endedAt: s(1800) }), // 30 min assisted
      { id: '4', mode: 'manual-observed', scan: scanB, startedAt: 0, pauses: [], referenceShown: false, completed: true, enteredMs: 1_200_000 }, // 20 min
      session({ id: '5', scan: { ...scanA, seriesUid: 'C' }, startedAt: s(0), endedAt: s(60) }), // no manual: excluded
      session({ id: '6', scan: scanA, completed: false, startedAt: s(0), endedAt: s(5) }), // not completed: excluded
    ]);
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.key === 'A');
    const b = rows.find((r) => r.key === 'B');
    expect(a?.savedMs).toBe(900_000);
    expect(Math.round(a?.savedPct ?? 0)).toBe(60);
    expect(b?.savedMs).toBe(-600_000); // slower with the tool: reported, not hidden
  });

  it('flags reference-assisted sessions', () => {
    const scan = { patientId: 'P', studyDate: 'd', timepoint: 't', seriesUid: 'A' };
    const rows = timeSaved([
      session({ scan, referenceShown: true }),
      { id: 'm', mode: 'manual-observed', scan, startedAt: 0, pauses: [], referenceShown: false, completed: true, enteredMs: 200_000 },
    ]);
    expect(rows[0]?.referenceAssisted).toBe(true);
  });
});
