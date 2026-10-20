import type { ScanInfo } from './record';
import { secondsToApproval, type Finding } from './types';

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
  /** Active time from first finding to last review action, ms (breaks > 2 min excluded). */
  timeOnScanMs?: number;
  /** Median creation → approval per accepted finding, seconds. */
  medianSecondsPerAccepted?: number;
}

/** Gaps longer than this between two actions count as a break, not as work. */
export const IDLE_GAP_MS = 2 * 60_000;

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

export function sessionStats(findings: Finding[]): SessionStats {
  const ai = findings.filter((f) => f.source === 'ai');
  const ts = findings.flatMap((f) => f.timeline.map((e) => e.t));
  const accepted = findings.filter((f) => f.status === 'approved');
  return {
    aiCandidates: ai.length,
    aiAccepted: ai.filter((f) => f.status === 'approved').length,
    aiRejected: ai.filter((f) => f.status === 'rejected').length,
    aiAcceptedEdited: ai.filter((f) => f.status === 'approved' && f.edited).length,
    addedByResearcher: findings.length - ai.length,
    accepted: accepted.length,
    rejected: findings.filter((f) => f.status === 'rejected').length,
    toReview: findings.filter((f) => f.status === 'unreviewed').length,
    timeOnScanMs: activeMs(ts),
    medianSecondsPerAccepted: median(accepted.map(secondsToApproval).filter((x): x is number => x !== undefined)),
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
  'Exported rows',
  'Source',
] as const;

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
    'Minutes on scan': s.timeOnScanMs === undefined ? '' : (s.timeOnScanMs / 60000).toFixed(1),
    'Median seconds per accepted finding': s.medianSecondsPerAccepted === undefined ? '' : s.medianSecondsPerAccepted.toFixed(0),
    'Exported rows': String(exportedRows),
    Source: 'measured from app timestamps',
  };
}
