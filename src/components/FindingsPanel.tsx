import { useRef, useState } from 'react';
import type { Finding, Lobe, NoduleType } from '../findings/types';
import { provenanceLabel } from '../findings/types';
import { missingFields, type ScanInfo } from '../findings/record';
import type { MatchStatus, PriorRecord } from '../findings/priors';
import { FollowUpPanel } from './FollowUpPanel';
import { activeMs } from '../findings/session';
import { DEFAULT_THRESHOLD_HU } from '../measure/segment';

export type VolumeStatus =
  | { kind: 'none' }
  | { kind: 'loading'; done: number; total: number }
  | { kind: 'ready'; restored: number }
  | { kind: 'error'; message: string };

export const TIMEPOINTS = ['Baseline', 'Follow-up 1', 'Follow-up 2', 'Follow-up 3', 'Follow-up 4'];

interface Props {
  scan?: ScanInfo;
  onTimepoint: (timepoint: string) => void;
  onExport: () => void;
  onScreenshot: (id: string) => void;
  volume: VolumeStatus;
  findings: Finding[];
  selected?: Finding;
  canUndo: boolean;
  onSelect: (id: string) => void;
  onGoTo: (f: Finding) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onReopen: (id: string) => void;
  onUndo: (id: string) => void;
  onReset: (id: string) => void;
  onDelete: (id: string) => void;
  onResegment: (id: string, thresholdHu: number) => void;
  onFields: (id: string, patch: Partial<Pick<Finding, 'type' | 'lobe' | 'notes'>>) => void;
  priors: PriorRecord[];
  suggestion?: { prior: PriorRecord; distanceMm: number };
  onMatch: (id: string, prior: PriorRecord, status: MatchStatus) => void;
  onClearMatch: (id: string) => void;
  onImport: (file: File) => void;
  onGoToPriorPosition: (prior: PriorRecord) => void;
  /** Loads an AI result (DICOM SEG) as candidates to review. */
  onLoadAi: (file: File) => void;
}

const TYPES: { value: NoduleType; label: string }[] = [
  { value: '', label: '—' },
  { value: 'solid', label: 'Solid' },
  { value: 'part-solid', label: 'Part-solid' },
  { value: 'ground-glass', label: 'Ground-glass' },
  { value: 'calcified', label: 'Calcified' },
  { value: 'other', label: 'Other' },
];
const LOBES: Lobe[] = ['', 'RUL', 'RML', 'RLL', 'LUL', 'Lingula', 'LLL'];

const STATUS_LABEL: Record<Finding['status'], string> = {
  unreviewed: '● To review',
  approved: '✓ Approved',
  rejected: '✕ Rejected',
};

function SourceChip({ f }: { f: Finding }) {
  if (f.source === 'ai') return <span className="chip chip--ai" title="Proposed by the AI model">AI</span>;
  return (
    <span className="chip chip--you" title={f.source === 'click' ? 'Added by you (click segmentation)' : 'Added by you (brush)'}>
      You
    </span>
  );
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Active time on this scan's findings, from the app's own timestamps (breaks > 2 min excluded). */
function timeOnScan(findings: Finding[]): number | undefined {
  return activeMs(findings.flatMap((f) => f.timeline.map((e) => e.t)));
}

function fmt(n: number | undefined, digits = 1): string {
  return n === undefined ? '—' : n.toFixed(digits);
}

function ThresholdControl({ finding, onResegment }: { finding: Finding; onResegment: Props['onResegment'] }) {
  const current = finding.segmentation?.thresholdHu ?? DEFAULT_THRESHOLD_HU;
  const [value, setValue] = useState(current);
  const [shownFor, setShownFor] = useState(`${finding.id}:${current}`);
  // Reset the slider when another finding is selected or the value changed elsewhere (undo).
  if (shownFor !== `${finding.id}:${current}`) {
    setShownFor(`${finding.id}:${current}`);
    setValue(current);
  }
  return (
    <div className="threshold">
      <label htmlFor="edge-threshold">
        Edge threshold <span className="mono">{value} HU</span>
      </label>
      <input
        id="edge-threshold"
        type="range"
        min={-800}
        max={0}
        step={25}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        onMouseUp={() => value !== current && onResegment(finding.id, value)}
        onKeyUp={() => value !== current && onResegment(finding.id, value)}
      />
      <div className="hint">Lower = include fainter edges (part-solid / ground-glass). Re-runs the click outline.</div>
    </div>
  );
}

export function FindingsPanel(props: Props) {
  const { volume, findings, selected, canUndo } = props;
  const toReview = findings.filter((f) => f.status === 'unreviewed').length;

  const approved = findings.filter((f) => f.status === 'approved');
  const incomplete = approved.filter((f) => missingFields(f).length > 0).length;
  const ai = findings.filter((f) => f.source === 'ai');
  const aiReviewed = ai.filter((f) => f.status !== 'unreviewed').length;
  const added = findings.length - ai.length;
  const elapsed = timeOnScan(findings);
  const aiInput = useRef<HTMLInputElement>(null);

  return (
    <aside className="copilot">
      {props.scan && (
        <section className="panel record">
          <h2>Research record</h2>
          <dl className="record-grid">
            <div>
              <dt>Patient ID</dt>
              <dd className="mono">{props.scan.patientId || '—'}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd className="mono">{props.scan.studyDate || '—'}</dd>
            </div>
            <div>
              <dt>Series</dt>
              <dd>{props.scan.series || '—'}</dd>
            </div>
            <div>
              <dt>Timepoint</dt>
              <dd>
                <select value={props.scan.timepoint} onChange={(e) => props.onTimepoint(e.target.value)} aria-label="Timepoint">
                  {TIMEPOINTS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </dd>
            </div>
          </dl>
          <div className="export-row">
            <button type="button" className="primary" disabled={approved.length === 0} onClick={props.onExport}>
              Export CSV ({approved.length})
            </button>
            <span className="hint">
              {approved.length === 0
                ? 'Approve findings to export them.'
                : `${approved.length} approved${toReview ? ` · ${toReview} not yet reviewed (not exported)` : ''}${
                    incomplete ? ` · ${incomplete} missing Type/Lobe` : ''
                  }`}
            </span>
          </div>
        </section>
      )}

      <section className="panel worklist">
        <div className="worklist-head">
          <h2>Worklist</h2>
          <button type="button" className="ghost small" disabled={volume.kind !== 'ready'} onClick={() => aiInput.current?.click()}>
            Load AI result…
          </button>
          <input
            ref={aiInput}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) props.onLoadAi(f);
            }}
          />
        </div>
        {volume.kind === 'loading' && (
          <div className="volume-status">
            Preparing 3D data… {volume.done}/{volume.total}
            <progress max={volume.total} value={volume.done} />
          </div>
        )}
        {volume.kind === 'error' && <div className="panel--error-text">{volume.message}</div>}
        {volume.kind === 'ready' && findings.length === 0 && (
          <div className="empty">
            <p>
              <b>No findings yet.</b> Load the AI result for this scan, or press <kbd>S</kbd> and click a nodule to
              outline and measure it.
            </p>
          </div>
        )}
        {volume.kind === 'ready' && volume.restored > 0 && (
          <p className="hint">Restored {volume.restored} saved finding(s) for this series.</p>
        )}
        {findings.length > 0 && (
          <>
            <div className="worklist-progress">
              {ai.length > 0 ? (
                <span>
                  <b>AI found {ai.length}</b> · {aiReviewed} of {ai.length} reviewed
                </span>
              ) : (
                <span>
                  {findings.length} finding{findings.length === 1 ? '' : 's'} · {toReview} to review
                </span>
              )}
              {ai.length > 0 && added > 0 && <span> · {added} added by you</span>}
              {elapsed !== undefined && elapsed >= 1000 && (
                <span className="muted" title="Active time from the app's own timestamps (breaks over 2 min excluded)">
                  {' '}
                  · {clock(elapsed)} on this scan
                </span>
              )}
              <div className="meter" aria-hidden="true">
                <div style={{ width: `${(100 * (findings.length - toReview)) / findings.length}%` }} />
              </div>
            </div>
            <ul className="finding-list">
              {findings.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className={`finding-row${f.id === selected?.id ? ' finding-row--selected' : ''} status-${f.status}`}
                    onClick={() => {
                      props.onSelect(f.id);
                      props.onGoTo(f);
                    }}
                  >
                    <SourceChip f={f} />
                    <span className="finding-name">{f.name}</span>
                    <span className="finding-dims mono">
                      {f.measurement ? `${fmt(f.measurement.longMm)} × ${fmt(f.measurement.shortMm)}` : '—'}
                    </span>
                    <span className={`chip chip--${f.status}`}>{STATUS_LABEL[f.status]}</span>
                    {f.positionEstimate && <span className="finding-where">{f.positionEstimate}</span>}
                    {f.status === 'approved' && missingFields(f).length > 0 && (
                      <span className="missing-note">missing {missingFields(f).join(', ')}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <div className="kbd-hint">
              <kbd>A</kbd> accept · <kbd>R</kbd> reject · <kbd>J</kbd>/<kbd>K</kbd> next/prev · <kbd>E</kbd> erase ·{' '}
              <kbd>B</kbd> brush · <kbd>S</kbd> add missed nodule
            </div>
          </>
        )}
      </section>

      {selected && (
        <section className="panel finding-card">
          <div className="finding-card-head">
            <h2>
              {selected.name} <span className={`chip chip--${selected.status}`}>{STATUS_LABEL[selected.status]}</span>
            </h2>
            <button type="button" className="link" onClick={() => props.onGoTo(selected)} title="Go to the measured slice">
              Go to slice {selected.measurement ? selected.measurement.sliceIndex + 1 : ''}
            </button>
          </div>

          {selected.measurement ? (
            <dl className="metrics">
              <div>
                <dt>Long axis</dt>
                <dd className="mono">{fmt(selected.measurement.longMm)} mm</dd>
              </div>
              <div>
                <dt>Short axis</dt>
                <dd className="mono">{fmt(selected.measurement.shortMm)} mm</dd>
              </div>
              <div>
                <dt>Volume</dt>
                <dd className="mono">
                  {fmt(selected.measurement.volumeMm3, 0)} mm³{' '}
                  <span className="muted">({fmt(selected.measurement.volumeMm3 / 1000, 2)} mL)</span>
                </dd>
              </div>
              <div className="metric--small">
                <dt>Extent</dt>
                <dd className="mono">
                  {selected.measurement.slicesSpanned} slices · axes on slice {selected.measurement.sliceIndex + 1}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="hint">No outline yet — paint with the brush.</p>
          )}

          {selected.positionEstimate && (
            <div className="position-estimate">
              <span className="muted">Position (estimate from AI lung mask):</span> {selected.positionEstimate}
            </div>
          )}
          <div className="provenance">
            <SourceChip f={selected} /> {provenanceLabel(selected)}
            {selected.segmentation && (
              <span className="muted">
                {' '}
                · threshold {selected.segmentation.thresholdHu} HU
                {selected.segmentation.lungConstrained ? ' · limited to lung' : ''}
                {selected.segmentation.erosion > 0 ? ` · thin attachments cut (${selected.segmentation.erosion})` : ''}
              </span>
            )}
          </div>
          {selected.segmentation?.leaked && !selected.edited && (
            <div className="warning-text">
              The outline may include neighbouring structures (it reached the search limit). Check the edges and
              erase extra parts.
            </div>
          )}
          {selected.status === 'approved' && selected.approved && (
            <div className="hint">Approved {new Date(selected.approved.at).toLocaleTimeString()}. Editing requires re-approval.</div>
          )}

          <div className="review-actions">
            {selected.status !== 'approved' ? (
              <button
                type="button"
                className="primary"
                disabled={!selected.measurement}
                onClick={() => props.onApprove(selected.id)}
                title="Approve (A)"
              >
                Approve <kbd>A</kbd>
              </button>
            ) : (
              <button type="button" onClick={() => props.onReopen(selected.id)}>
                Reopen
              </button>
            )}
            {selected.status !== 'rejected' ? (
              <button type="button" onClick={() => props.onReject(selected.id)} title="Reject as not a nodule (R)">
                Reject <kbd>R</kbd>
              </button>
            ) : (
              <button type="button" onClick={() => props.onReopen(selected.id)}>
                Restore
              </button>
            )}
            <button type="button" disabled={!canUndo} onClick={() => props.onUndo(selected.id)} title="Undo last edit (⌘Z)">
              Undo
            </button>
            <button type="button" disabled={!canUndo} onClick={() => props.onReset(selected.id)} title="Revert all edits">
              Reset
            </button>
          </div>

          {selected.seed && selected.status !== 'rejected' && (
            <ThresholdControl finding={selected} onResegment={props.onResegment} />
          )}

          <div className="fields">
            <label className={selected.type ? '' : 'missing'}>
              Type
              <select
                value={selected.type}
                onChange={(e) => props.onFields(selected.id, { type: e.target.value as NoduleType })}
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={selected.lobe ? '' : 'missing'}>
              Lobe
              <select value={selected.lobe} onChange={(e) => props.onFields(selected.id, { lobe: e.target.value as Lobe })}>
                {LOBES.map((l) => (
                  <option key={l} value={l}>
                    {l || '—'}
                  </option>
                ))}
              </select>
            </label>
            <label className="notes">
              Notes
              <textarea
                rows={2}
                value={selected.notes}
                onChange={(e) => props.onFields(selected.id, { notes: e.target.value })}
                placeholder="e.g. abuts pleura, spiculated"
              />
            </label>
          </div>

          {selected.status !== 'rejected' && selected.measurement && (
            <FollowUpPanel
              key={selected.id}
              finding={selected}
              priors={props.priors}
              suggestion={props.suggestion}
              patientId={props.scan?.patientId ?? ''}
              onMatch={(prior, status) => props.onMatch(selected.id, prior, status)}
              onClearMatch={() => props.onClearMatch(selected.id)}
              onImport={props.onImport}
              onGoToPriorPosition={props.onGoToPriorPosition}
            />
          )}

          {selected.thumbnail && !selected.match && (
            <img className="thumb" src={selected.thumbnail} alt={`${selected.name} on the measured slice`} />
          )}
          <div className="card-footer">
            <button type="button" className="link" disabled={!selected.measurement} onClick={() => props.onScreenshot(selected.id)}>
              Save screenshot (PNG)
            </button>
            <button type="button" className="danger-link" onClick={() => props.onDelete(selected.id)}>
              Delete finding
            </button>
          </div>
        </section>
      )}
    </aside>
  );
}
