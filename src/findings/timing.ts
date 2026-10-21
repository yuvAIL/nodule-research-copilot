import type { Finding, TimelineEvent } from './types';

/**
 * Timed sessions: the evidence for "time saved".
 *
 * A session is one researcher doing one task on one scan, from Start to Finish. Explicit pauses (Pause/Resume) are
 * the only time left out, and they are reported. Nothing else is excluded silently: time spent looking at the scan
 * before the first click counts, as does a slow correction.
 *
 * Two kinds of session:
 *  - "assisted": run in this app; its phase breakdown comes from the app's own action timestamps.
 *  - "manual-observed": the researcher's usual method in another tool, timed by an observer and entered here.
 * Historical self-reported estimates are not sessions and are never stored here.
 *
 * Time saved is only computed for a scan that has at least one finished session of each kind:
 *   saved = manual − assisted (can be negative).
 * AI inference runs before the session, unattended, and is reported separately (never added to either side).
 */

export type SessionMode = 'assisted' | 'manual-observed';

export interface Pause {
  from: number;
  to?: number;
}

export interface ScanRef {
  patientId: string;
  studyDate: string;
  timepoint: string;
  seriesUid?: string;
  series?: string;
}

export interface PhaseMs {
  /** Accept / reject / reopen / match decisions, including the looking that led to them. */
  review: number;
  /** Brush, erase, undo, reset, re-segment. */
  correction: number;
  /** Adding findings the AI did not propose (click or brush). */
  adding: number;
  /** Type / lobe / notes and CSV export. */
  documentation: number;
  /** Loading AI results, opening scans, and time after the last action until Finish. */
  other: number;
}

export interface SessionCounts {
  aiCandidates: number;
  accepted: number;
  rejected: number;
  edited: number;
  addedByResearcher: number;
  exports: number;
}

export interface TimedSession {
  id: string;
  mode: SessionMode;
  scan?: ScanRef;
  startedAt: number;
  endedAt?: number;
  pauses: Pause[];
  /** True if the expert reference outline was visible at any time during an assisted session. */
  referenceShown: boolean;
  /** Assisted only, filled at Finish. */
  phases?: PhaseMs;
  counts?: SessionCounts;
  /** Task completed = at least one successful export (assisted) or the observer confirmed completion (manual). */
  completed: boolean;
  /** Manual-observed: duration entered by the observer, ms. */
  enteredMs?: number;
  /** Free text: who timed it, what was different, familiarity with the case (learning effects). */
  notes?: string;
}

export function pausedMs(s: Pick<TimedSession, 'pauses'>, now = Date.now()): number {
  return s.pauses.reduce((n, p) => n + Math.max(0, (p.to ?? now) - p.from), 0);
}

export function isPaused(s: Pick<TimedSession, 'pauses'>): boolean {
  const last = s.pauses[s.pauses.length - 1];
  return !!last && last.to === undefined;
}

/** Task time: Start → Finish minus explicit pauses (manual-observed: the entered duration). */
export function taskMs(s: TimedSession, now = Date.now()): number {
  if (s.mode === 'manual-observed') return s.enteredMs ?? 0;
  return Math.max(0, (s.endedAt ?? now) - s.startedAt - pausedMs(s, s.endedAt ?? now));
}

type Category = keyof PhaseMs;

function categoryOf(action: TimelineEvent['action'], f?: Finding): Category {
  switch (action) {
    case 'edited':
    case 'undo':
    case 'reset':
    case 'resegmented':
      return 'correction';
    case 'approved':
    case 'rejected':
    case 'reopened':
    case 'matched':
      return 'review';
    case 'fields':
    case 'exported':
      return 'documentation';
    case 'created':
      return f && f.source !== 'ai' ? 'adding' : 'other';
    default:
      return 'other';
  }
}

/** Active (unpaused) time between a and b. */
function activeBetween(a: number, b: number, pauses: Pause[], end: number): number {
  let ms = Math.max(0, b - a);
  for (const p of pauses) {
    const from = Math.max(a, p.from);
    const to = Math.min(b, p.to ?? end);
    if (to > from) ms -= to - from;
  }
  return Math.max(0, ms);
}

/**
 * Splits an assisted session's task time into phases. The active time before each action is credited to that
 * action's phase; time after the last action (until Finish) is "other". The phases add up exactly to the task time
 * (no overlap, nothing dropped).
 */
export function phaseBreakdown(
  session: Pick<TimedSession, 'startedAt' | 'endedAt' | 'pauses'>,
  findings: Finding[],
  exportTimes: number[],
  end = session.endedAt ?? Date.now(),
): PhaseMs {
  const out: PhaseMs = { review: 0, correction: 0, adding: 0, documentation: 0, other: 0 };
  const events: { t: number; cat: Category }[] = [];
  for (const f of findings) for (const e of f.timeline) if (e.t >= session.startedAt && e.t <= end) events.push({ t: e.t, cat: categoryOf(e.action, f) });
  for (const t of exportTimes) if (t >= session.startedAt && t <= end) events.push({ t, cat: 'documentation' });
  events.sort((a, b) => a.t - b.t);
  let prev = session.startedAt;
  for (const e of events) {
    out[e.cat] += activeBetween(prev, e.t, session.pauses, end);
    prev = e.t;
  }
  out.other += activeBetween(prev, end, session.pauses, end);
  return out;
}

export function sessionCounts(findings: Finding[], exportTimes: number[], session: Pick<TimedSession, 'startedAt' | 'endedAt'>): SessionCounts {
  const end = session.endedAt ?? Date.now();
  const inside = (t: number) => t >= session.startedAt && t <= end;
  return {
    aiCandidates: findings.filter((f) => f.source === 'ai').length,
    accepted: findings.filter((f) => f.status === 'approved').length,
    rejected: findings.filter((f) => f.status === 'rejected').length,
    edited: findings.filter((f) => f.timeline.some((e) => inside(e.t) && (e.action === 'edited' || e.action === 'undo' || e.action === 'reset' || e.action === 'resegmented'))).length,
    addedByResearcher: findings.filter((f) => f.source !== 'ai' && f.timeline.some((e) => e.action === 'created' && inside(e.t))).length,
    exports: exportTimes.filter(inside).length,
  };
}

export function scanKey(s?: ScanRef): string {
  if (!s) return '';
  return s.seriesUid || `${s.patientId}|${s.studyDate}|${s.timepoint}`;
}

export interface TimeSavedRow {
  key: string;
  scan: ScanRef;
  manualMs: number;
  assistedMs: number;
  savedMs: number;
  savedPct: number | undefined;
  manualSessions: number;
  assistedSessions: number;
  /** The assisted time comes from sessions that showed the expert reference: not ordinary use. */
  referenceAssisted: boolean;
  /** Reference-assisted sessions left out because ordinary sessions exist for this scan. */
  referenceAssistedExcluded: number;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Time saved per scan, only where both a finished manual-observed and a finished, completed assisted session exist.
 * Several sessions of a kind on the same scan are averaged (and their count is shown: repeats carry learning effects).
 */
export function timeSaved(sessions: TimedSession[]): TimeSavedRow[] {
  const byScan = new Map<string, TimedSession[]>();
  for (const s of sessions) {
    if (!s.scan) continue;
    if (s.mode === 'assisted' && (!s.endedAt || !s.completed)) continue;
    if (s.mode === 'manual-observed' && !(s.enteredMs && s.completed)) continue;
    const k = scanKey(s.scan);
    byScan.set(k, [...(byScan.get(k) ?? []), s]);
  }
  const rows: TimeSavedRow[] = [];
  for (const [key, list] of byScan) {
    const manual = list.filter((s) => s.mode === 'manual-observed');
    const allAssisted = list.filter((s) => s.mode === 'assisted');
    if (!manual.length || !allAssisted.length) continue;
    // Ordinary use = expert outline never shown. Reference-assisted sessions count only when there is nothing else,
    // and then the row is flagged as such.
    const ordinary = allAssisted.filter((s) => !s.referenceShown);
    const assisted = ordinary.length ? ordinary : allAssisted;
    const manualMs = mean(manual.map((s) => taskMs(s)));
    const assistedMs = mean(assisted.map((s) => taskMs(s)));
    const savedMs = manualMs - assistedMs;
    rows.push({
      key,
      scan: (assisted[0] as TimedSession).scan as ScanRef,
      manualMs,
      assistedMs,
      savedMs,
      savedPct: manualMs > 0 ? (savedMs / manualMs) * 100 : undefined,
      manualSessions: manual.length,
      assistedSessions: assisted.length,
      referenceAssisted: assisted.some((s) => s.referenceShown),
      referenceAssistedExcluded: allAssisted.length - assisted.length,
    });
  }
  return rows;
}

/**
 * Phase columns are estimates: the app does not observe what the researcher is doing between actions, it credits each
 * gap to the action that ends it. Task time, pauses and counts are direct measurements.
 */
export const TIMING_COLUMNS = [
  'Session',
  'Mode',
  'Patient ID',
  'Date',
  'Timepoint',
  'Series UID',
  'Started',
  'Finished',
  'Task minutes',
  'Paused minutes (excluded)',
  'Review minutes (est.)',
  'Correction minutes (est.)',
  'Adding minutes (est.)',
  'Documentation/export minutes (est.)',
  'Other minutes (est.)',
  'AI candidates',
  'Accepted',
  'Rejected',
  'Edited',
  'Added by researcher',
  'Exports',
  'Completed',
  'Expert reference shown',
  'Notes',
] as const;

const min = (ms: number | undefined) => (ms === undefined ? '' : (ms / 60000).toFixed(2));
const iso = (t: number | undefined) => (t === undefined ? '' : new Date(t).toISOString());

export function timingRow(s: TimedSession): Record<(typeof TIMING_COLUMNS)[number], string> {
  const assisted = s.mode === 'assisted';
  return {
    Session: s.id,
    Mode: assisted ? 'AI-assisted (measured in app)' : 'Manual (observed, entered)',
    'Patient ID': s.scan?.patientId ?? '',
    Date: s.scan?.studyDate ?? '',
    Timepoint: s.scan?.timepoint ?? '',
    'Series UID': s.scan?.seriesUid ?? '',
    Started: assisted ? iso(s.startedAt) : '',
    Finished: assisted ? iso(s.endedAt) : '',
    'Task minutes': min(taskMs(s)),
    'Paused minutes (excluded)': assisted ? min(pausedMs(s, s.endedAt)) : '',
    'Review minutes (est.)': min(s.phases?.review),
    'Correction minutes (est.)': min(s.phases?.correction),
    'Adding minutes (est.)': min(s.phases?.adding),
    'Documentation/export minutes (est.)': min(s.phases?.documentation),
    'Other minutes (est.)': min(s.phases?.other),
    'AI candidates': s.counts ? String(s.counts.aiCandidates) : '',
    Accepted: s.counts ? String(s.counts.accepted) : '',
    Rejected: s.counts ? String(s.counts.rejected) : '',
    Edited: s.counts ? String(s.counts.edited) : '',
    'Added by researcher': s.counts ? String(s.counts.addedByResearcher) : '',
    Exports: s.counts ? String(s.counts.exports) : '',
    Completed: s.completed ? 'yes' : 'no',
    'Expert reference shown': assisted ? (s.referenceShown ? 'yes (reference-assisted)' : 'no') : '',
    Notes: s.notes ?? '',
  };
}
