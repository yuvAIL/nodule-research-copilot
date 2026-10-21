import type { ScanInfo } from './record';
import { secondsToApproval, type Finding, type TimelineEvent } from './types';

/**
 * What happened on one scan, from the app's own timestamps and review states.
 * This is the "after" side of the time table: measured, not estimated.
 */
export interface SessionStats {
  aiCandidates: number;
  aiAccepted: number;
  aiRejected: number;
  /** Accepted AI candidates whose outline the researcher changed. */
  aiAcceptedEdited: number;
  /** Findings the researcher added (click or brush) — what the AI missed or was not asked about. */
  addedByResearcher: number;
  accepted: number;
  rejected: number;
  toReview: number;
  /** Active time from first finding to last action (review, edit, export), ms. Breaks > 2 min excluded. */
  timeOnScanMs?: number;
  /** Median creation → approval per accepted finding, seconds. */
  medianSecondsPerAccepted?: number;
  /** Outline corrections: brush/erase strokes, undo, reset, re-segment. */
  corrections: number;
  /** Findings whose outline was corrected at least once. */
  findingsCorrected: number;
  /** Active time that ended in a correction, ms (the gap before each correction, breaks excluded). */
  correctionMs: number;
  /** Median active time attributed to one decided (accepted or rejected) finding, seconds. */
  medianActiveSecondsPerDecided?: number;
  /** Breaks longer than the idle limit that were left out of the time. */
  pausesExcluded: number;
  pausedMs: number;
  /** CSV exports of this scan (Export CSV button). */
  exports: number;
  firstActionAt?: number;
  lastActionAt?: number;
}

/** Gaps longer than this between two actions count as a break, not as work. */
export const IDLE_GAP_MS = 2 * 60_000;

const CORRECTIONS = new Set<TimelineEvent['action']>(['edited', 'undo', 'reset', 'resegmented']);

/** Active working time from action timestamps: sum of gaps between consecutive actions, breaks excluded. */
export function activeMs(timestamps: number[], idleGapMs = IDLE_GAP_MS): number | undefined {
  if (timestamps.length < 2) return undefined;
  const t = [...timestamps].sort((a, b) => a - b);
  let total = 0;
  for (let n = 1; n < t.length; n++) {
    const gap = (t[n] as number) - (t[n - 1] as number);
    if (gap <= idleGapMs) total += gap;
  }
  return total;
}

function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

interface StreamEvent {
  t: number;
  finding?: string;
  action: TimelineEvent['action'] | 'exported';
}

/**
 * One stream of every action on the scan. The gap before an action is the work that led to it, so it is credited
 * to that action's finding (and counted as correction time when the action is a correction). Gaps longer than the
 * idle limit are breaks and are credited to nobody.
 */
function attribute(stream: StreamEvent[], idleGapMs: number) {
  const s = [...stream].sort((a, b) => a.t - b.t);
  const perFinding = new Map<string, number>();
  let correctionMs = 0;
  let pausesExcluded = 0;
  let pausedMs = 0;
  for (let n = 1; n < s.length; n++) {
    const e = s[n] as StreamEvent;
    const gap = e.t - (s[n - 1] as StreamEvent).t;
    if (gap > idleGapMs) {
      pausesExcluded++;
      pausedMs += gap;
      continue;
    }
    if (e.finding) perFinding.set(e.finding, (perFinding.get(e.finding) ?? 0) + gap);
    if (CORRECTIONS.has(e.action as TimelineEvent['action'])) correctionMs += gap;
  }
  return { perFinding, correctionMs, pausesExcluded, pausedMs };
}

export function sessionStats(findings: Finding[], exportTimes: number[] = [], idleGapMs = IDLE_GAP_MS): SessionStats {
  const ai = findings.filter((f) => f.source === 'ai');
  const stream: StreamEvent[] = [
    ...findings.flatMap((f) => f.timeline.map((e) => ({ t: e.t, finding: f.id, action: e.action }))),
    ...exportTimes.map((t) => ({ t, action: 'exported' as const })),
  ];
  const ts = stream.map((e) => e.t);
  const accepted = findings.filter((f) => f.status === 'approved');
  const decided = findings.filter((f) => f.status === 'approved' || f.status === 'rejected');
  const corrected = findings.filter((f) => f.timeline.some((e) => CORRECTIONS.has(e.action)));
  const att = attribute(stream, idleGapMs);
  return {
    aiCandidates: ai.length,
    aiAccepted: ai.filter((f) => f.status === 'approved').length,
    aiRejected: ai.filter((f) => f.status === 'rejected').length,
    aiAcceptedEdited: ai.filter((f) => f.status === 'approved' && f.edited).length,
    addedByResearcher: findings.length - ai.length,
    accepted: accepted.length,
    rejected: findings.filter((f) => f.status === 'rejected').length,
    toReview: findings.filter((f) => f.status === 'unreviewed').length,
    timeOnScanMs: activeMs(ts, idleGapMs),
    medianSecondsPerAccepted: median(accepted.map(secondsToApproval).filter((x): x is number => x !== undefined)),
    corrections: findings.reduce((n, f) => n + f.timeline.filter((e) => CORRECTIONS.has(e.action)).length, 0),
    findingsCorrected: corrected.length,
    correctionMs: att.correctionMs,
    medianActiveSecondsPerDecided: median(decided.map((f) => (att.perFinding.get(f.id) ?? 0) / 1000)),
    pausesExcluded: att.pausesExcluded,
    pausedMs: att.pausedMs,
    exports: exportTimes.length,
    firstActionAt: ts.length ? Math.min(...ts) : undefined,
    lastActionAt: ts.length ? Math.max(...ts) : undefined,
  };
}

export const SESSION_COLUMNS = [
  'Patient ID',
  'Date',
  'Timepoint',
  'Series',
  'AI candidates',
  'AI accepted',
  'AI rejected',
  'AI accepted after edit',
  'Added by researcher',
  'Accepted total',
  'Still to review',
  'Minutes on scan',
  'Median seconds per accepted finding',
  'Median active seconds per decided finding',
  'Outline corrections',
  'Findings corrected',
  'Correction minutes',
  'Pauses excluded',
  'Paused minutes (not counted)',
  'CSV exports',
  'Exported rows',
  'First action',
  'Last action',
  'Source',
] as const;

const minutes = (ms: number | undefined) => (ms === undefined ? '' : (ms / 60000).toFixed(1));
const iso = (t: number | undefined) => (t === undefined ? '' : new Date(t).toISOString());

export function sessionRow(scan: ScanInfo | undefined, s: SessionStats, exportedRows: number): Record<(typeof SESSION_COLUMNS)[number], string> {
  return {
    'Patient ID': scan?.patientId ?? '',
    Date: scan?.studyDate ?? '',
    Timepoint: scan?.timepoint ?? '',
    Series: scan?.series ?? '',
    'AI candidates': String(s.aiCandidates),
    'AI accepted': String(s.aiAccepted),
    'AI rejected': String(s.aiRejected),
    'AI accepted after edit': String(s.aiAcceptedEdited),
    'Added by researcher': String(s.addedByResearcher),
    'Accepted total': String(s.accepted),
    'Still to review': String(s.toReview),
    'Minutes on scan': minutes(s.timeOnScanMs),
    'Median seconds per accepted finding': s.medianSecondsPerAccepted === undefined ? '' : s.medianSecondsPerAccepted.toFixed(0),
    'Median active seconds per decided finding': s.medianActiveSecondsPerDecided === undefined ? '' : s.medianActiveSecondsPerDecided.toFixed(0),
    'Outline corrections': String(s.corrections),
    'Findings corrected': String(s.findingsCorrected),
    'Correction minutes': minutes(s.correctionMs),
    'Pauses excluded': String(s.pausesExcluded),
    'Paused minutes (not counted)': minutes(s.pausedMs),
    'CSV exports': String(s.exports),
    'Exported rows': String(exportedRows),
    'First action': iso(s.firstActionAt),
    'Last action': iso(s.lastActionAt),
    Source: 'measured from app timestamps',
  };
}
