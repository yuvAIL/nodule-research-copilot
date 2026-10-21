import { useState } from 'react';
import { downloadText, toCsvTable, type ScanInfo } from '../findings/record';
import { SESSION_COLUMNS, sessionRow, sessionStats } from '../findings/session';
import type { Finding } from '../findings/types';

interface Props {
  findings: Finding[];
  exportedRows: number;
  /** Times Export CSV was used on this scan. */
  exportTimes: number[];
  scan?: ScanInfo;
  onClose: () => void;
  /** Deletes all findings of this scan and reloads its AI result, for a fresh timed run. */
  onStartOver: () => void;
}

function clock(ms: number | undefined): string {
  if (ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Naomi's view of one scan: what the AI proposed, what the researcher decided, and the time it took (measured). */
export function SessionSummary({ findings, exportedRows, exportTimes, scan, onClose, onStartOver }: Props) {
  const s = sessionStats(findings, exportTimes);
  const [confirming, setConfirming] = useState(false);
  const save = () => {
    const name = `session_${scan?.patientId || 'scan'}_${scan?.timepoint ?? ''}_${new Date().toISOString().slice(0, 16).replace(':', '')}.csv`.replace(/\s+/g, '-');
    downloadText(name, toCsvTable(SESSION_COLUMNS, [sessionRow(scan, s, exportedRows)]));
  };
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet summary" role="dialog" aria-modal="true" aria-label="Session summary" onClick={(e) => e.stopPropagation()}>
        <h2>Session summary</h2>
        <p className="muted">
          {scan ? `${scan.patientId} · ${scan.studyDate} · ${scan.timepoint}` : ''} — measured from this app's own timestamps.
        </p>
        <div className="summary-grid">
          <div>
            <span className="summary-num">{s.aiCandidates}</span>
            <span>AI candidates</span>
          </div>
          <div>
            <span className="summary-num ok">{s.aiAccepted}</span>
            <span>
              AI accepted{s.aiAcceptedEdited ? ` (${s.aiAcceptedEdited} after edit)` : ''}
            </span>
          </div>
          <div>
            <span className="summary-num">{s.aiRejected}</span>
            <span>AI rejected</span>
          </div>
          <div>
            <span className="summary-num">{s.addedByResearcher}</span>
            <span>added by researcher</span>
          </div>
          <div>
            <span className="summary-num">{clock(s.timeOnScanMs)}</span>
            <span>time on this scan</span>
          </div>
          <div>
            <span className="summary-num">{s.medianSecondsPerAccepted === undefined ? '—' : `${Math.round(s.medianSecondsPerAccepted)} s`}</span>
            <span>median per accepted finding</span>
          </div>
          <div>
            <span className="summary-num">{s.toReview}</span>
            <span>still to review</span>
          </div>
          <div>
            <span className="summary-num">{exportedRows}</span>
            <span>rows exported</span>
          </div>
          <div>
            <span className="summary-num">{s.corrections}</span>
            <span>
              outline corrections{s.findingsCorrected ? ` on ${s.findingsCorrected} finding${s.findingsCorrected === 1 ? '' : 's'}` : ''}
            </span>
          </div>
          <div>
            <span className="summary-num">{clock(s.correctionMs)}</span>
            <span>of it correcting outlines</span>
          </div>
          <div>
            <span className="summary-num">{s.medianActiveSecondsPerDecided === undefined ? '—' : `${Math.round(s.medianActiveSecondsPerDecided)} s`}</span>
            <span>median work per decided finding</span>
          </div>
          <div>
            <span className="summary-num">{s.pausesExcluded}</span>
            <span>pauses left out ({clock(s.pausedMs)})</span>
          </div>
        </div>
        <p className="hint">
          Time on scan = active time from the first finding to the last action (review, outline edit, CSV export); gaps over
          2 minutes count as pauses and are left out. Opening the scan and running the AI are not included. Work per finding =
          the time before each of its actions. Compare with your own time for the same scan without the tool.
        </p>
        <div className="button-row button-row--start">
          <button type="button" className="primary" onClick={save}>
            Save summary (CSV)
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className={confirming ? 'danger' : 'ghost'}
            onClick={() => (confirming ? onStartOver() : setConfirming(true))}
            title="Deletes all findings of this scan in this browser and reloads the AI result, so you can time a fresh review."
          >
            {confirming ? 'Click again: delete all findings and start over' : 'Start a new timed run…'}
          </button>
        </div>
      </div>
    </div>
  );
}
