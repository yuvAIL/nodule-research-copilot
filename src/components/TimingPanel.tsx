import { useEffect, useState } from 'react';
import { downloadText, toCsvTable } from '../findings/record';
import {
  TIMING_COLUMNS,
  isPaused,
  pausedMs,
  taskMs,
  timeSaved,
  timingRow,
  type ScanRef,
  type TimedSession,
} from '../findings/timing';

function clock(ms: number | undefined): string {
  if (ms === undefined) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function signedMin(ms: number): string {
  const v = ms / 60000;
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} min`;
}

const scanLabel = (s?: ScanRef) => (s ? `${s.patientId || '—'} · ${s.studyDate || '—'} · ${s.timepoint}` : '—');

/** Re-renders once a second while `on`. */
function useTick(on: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setN((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [on]);
}

interface BarProps {
  active?: TimedSession;
  canStart: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onOpen: () => void;
}

/** Header control: Start / Pause / Resume / Finish of an explicitly timed task. */
export function TimingBar({ active, canStart, onStart, onPause, onResume, onFinish, onOpen }: BarProps) {
  const paused = !!active && isPaused(active);
  useTick(!!active && !paused);
  if (!active) {
    return (
      <span className="timing-bar">
        <button
          type="button"
          className="ghost small"
          disabled={!canStart}
          onClick={onStart}
          title="Starts the clock for one full task on this scan (review, correct, add, approve, export). The expert outline is hidden while timing."
        >
          ▶ Start timed task
        </button>
        <button type="button" className="ghost small" onClick={onOpen} title="Timed sessions, observed manual times, time saved">
          Timing
        </button>
      </span>
    );
  }
  return (
    <span className={`timing-bar timing-bar--on${paused ? ' timing-bar--paused' : ''}`} role="timer" aria-live="off">
      <span className="timing-dot" aria-hidden="true" />
      <span className="timing-clock" title="Task time: Start → now, pauses excluded">
        {paused ? 'Paused' : 'Timing'} {clock(taskMs(active))}
      </span>
      {active.referenceShown && (
        <span className="timing-flag" title="The expert outline was shown during this session">
          reference-assisted
        </span>
      )}
      {paused ? (
        <button type="button" className="ghost small" onClick={onResume}>
          Resume
        </button>
      ) : (
        <button type="button" className="ghost small" onClick={onPause}>
          Pause
        </button>
      )}
      <button type="button" className="small primary" onClick={onFinish} title="Stops the clock. The task counts as completed if a CSV was exported during it.">
        Finish
      </button>
      <button type="button" className="ghost small" onClick={onOpen}>
        Timing
      </button>
    </span>
  );
}

interface DialogProps {
  sessions: TimedSession[];
  currentScan?: ScanRef;
  onAddManual: (s: TimedSession) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

/** Timed sessions, observed manual sessions and the time-saved table (only from comparable measured sessions). */
export function TimingDialog({ sessions, currentScan, onAddManual, onRemove, onClose }: DialogProps) {
  const [minutes, setMinutes] = useState('');
  const [completed, setCompleted] = useState(true);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  const rows = timeSaved(sessions);
  const sorted = [...sessions].sort((a, b) => b.startedAt - a.startedAt);

  const add = () => {
    const m = Number(minutes.replace(',', '.'));
    if (!currentScan) return setError('Open the scan the manual session was done on first.');
    if (!Number.isFinite(m) || m <= 0 || m > 600) return setError('Enter the observed duration in minutes (for example 32.5).');
    onAddManual({
      id: `manual-${Date.now().toString(36)}`,
      mode: 'manual-observed',
      scan: currentScan,
      startedAt: Date.now(),
      pauses: [],
      referenceShown: false,
      completed,
      enteredMs: Math.round(m * 60000),
      notes: notes.trim() || undefined,
    });
    setMinutes('');
    setNotes('');
    setError(undefined);
  };

  const save = () => {
    const name = `timing_${new Date().toISOString().slice(0, 16).replace(':', '')}.csv`;
    downloadText(name, toCsvTable(TIMING_COLUMNS, sorted.map(timingRow)));
  };

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet summary timing-sheet" role="dialog" aria-modal="true" aria-label="Timing" onClick={(e) => e.stopPropagation()}>
        <h2>Timing</h2>
        <p className="hint">
          Only explicitly timed tasks count. <b>AI-assisted</b>: Start → Finish in this app, pauses excluded and listed; the AI
          ran before the session (unattended, not included). <b>Manual (observed)</b>: the same task in your usual tool, timed
          by an observer and entered below. Self-reported estimates are not entered here. Time saved = manual − assisted, only
          for a scan with both; it can be negative.
        </p>

        <h3>Time saved (comparable sessions only)</h3>
        {rows.length === 0 ? (
          <p className="muted">No scan has both a finished AI-assisted session (with an export) and an observed manual session yet.</p>
        ) : (
          <table className="compare timing-table">
            <thead>
              <tr>
                <th>Scan</th>
                <th>Manual</th>
                <th>AI-assisted</th>
                <th>Saved</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    {scanLabel(r.scan)}
                    {(r.manualSessions > 1 || r.assistedSessions > 1) && (
                      <div className="hint">
                        mean of {r.manualSessions} manual / {r.assistedSessions} assisted (repeats: learning effects)
                      </div>
                    )}
                    {r.referenceAssisted && <div className="timing-flag">reference-assisted: not ordinary use</div>}
                  </td>
                  <td>{clock(r.manualMs)}</td>
                  <td>{clock(r.assistedMs)}</td>
                  <td className={r.savedMs < 0 ? 'worse' : undefined}>{signedMin(r.savedMs)}</td>
                  <td>{r.savedPct === undefined ? '—' : `${r.savedPct >= 0 ? '+' : '−'}${Math.abs(r.savedPct).toFixed(0)} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3>Add an observed manual session</h3>
        <p className="hint">For the scan open now: {scanLabel(currentScan)}. Same task and quality standard as the assisted session.</p>
        <div className="timing-form">
          <label>
            Minutes
            <input type="text" inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="e.g. 32.5" />
          </label>
          <label className="check">
            <input type="checkbox" checked={completed} onChange={(e) => setCompleted(e.target.checked)} /> Task completed
          </label>
          <label className="grow">
            Notes
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="tool used, who timed it, seen this scan before?" />
          </label>
          <button type="button" onClick={add} disabled={!currentScan}>
            Add
          </button>
        </div>
        {error && <p className="error">{error}</p>}

        <h3>All sessions ({sessions.length})</h3>
        {sorted.length === 0 ? (
          <p className="muted">None yet. Press ▶ Start timed task in the header.</p>
        ) : (
          <table className="compare timing-table">
            <thead>
              <tr>
                <th>Mode</th>
                <th>Scan</th>
                <th>Task</th>
                <th>Paused</th>
                <th>Review / correct / add / document / other</th>
                <th>Acc / rej / edited / added / exports</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.mode === 'assisted' ? 'AI-assisted' : 'Manual (observed)'}
                    {!s.completed && <div className="hint">{s.mode === 'assisted' && !s.endedAt ? 'running' : 'not completed'}</div>}
                    {s.referenceShown && <div className="timing-flag">reference-assisted</div>}
                  </td>
                  <td>{scanLabel(s.scan)}</td>
                  <td>{clock(taskMs(s))}</td>
                  <td>{s.mode === 'assisted' ? clock(pausedMs(s, s.endedAt)) : ''}</td>
                  <td>
                    {s.phases
                      ? [s.phases.review, s.phases.correction, s.phases.adding, s.phases.documentation, s.phases.other].map(clock).join(' / ')
                      : s.notes ?? ''}
                  </td>
                  <td>
                    {s.counts
                      ? [s.counts.accepted, s.counts.rejected, s.counts.edited, s.counts.addedByResearcher, s.counts.exports].join(' / ')
                      : ''}
                  </td>
                  <td>
                    {s.endedAt || s.mode === 'manual-observed' ? (
                      <button
                        type="button"
                        className={removing === s.id ? 'danger small' : 'ghost small'}
                        onClick={() => (removing === s.id ? onRemove(s.id) : setRemoving(s.id))}
                      >
                        {removing === s.id ? 'Click again to remove' : 'Remove'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">
          Phases: the active time before each action is credited to that action (accept/reject/match = review; brush, erase,
          undo, re-segment = correction; a finding you added = adding; type/lobe/notes and export = document). Time after the
          last action until Finish is “other”. Phases add up to the task time. Stored in this browser only.
        </p>
        <div className="button-row button-row--start">
          <button type="button" className="primary" onClick={save} disabled={!sessions.length}>
            Download timing CSV
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
