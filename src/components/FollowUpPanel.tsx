import { useRef, useState } from 'react';
import { compare, describePrior, type Change, type MatchStatus, type PriorRecord } from '../findings/priors';
import type { Finding } from '../findings/types';

interface Props {
  finding: Finding;
  priors: PriorRecord[];
  /** Closest prior by position, if any (a hint, not registration). */
  suggestion?: { prior: PriorRecord; distanceMm: number };
  patientId: string;
  onMatch: (prior: PriorRecord, status: MatchStatus) => void;
  onClearMatch: () => void;
  onImport: (file: File) => void;
  onGoToPriorPosition?: (prior: PriorRecord) => void;
}

function fmt(n: number | undefined, digits = 1, signed = false): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  const s = n.toFixed(digits);
  return signed && n > 0 ? `+${s}` : s;
}

function ChangeRow({ label, unit, c, digits = 1 }: { label: string; unit: string; c: Change; digits?: number }) {
  const cls = c.deltaPct === undefined ? '' : c.deltaPct > 0.5 ? 'up' : c.deltaPct < -0.5 ? 'down' : '';
  return (
    <tr>
      <th>{label}</th>
      <td className="mono">{fmt(c.priorMm, digits)}</td>
      <td className="mono">{fmt(c.currentMm, digits)}</td>
      <td className={`mono delta ${cls}`}>
        {fmt(c.deltaMm, digits, true)} {c.deltaMm !== undefined ? unit : ''}
        {c.deltaPct !== undefined ? ` (${fmt(c.deltaPct, 1, true)}%)` : ''}
      </td>
    </tr>
  );
}

export function FollowUpPanel({ finding, priors, suggestion, patientId, onMatch, onClearMatch, onImport, onGoToPriorPosition }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const match = finding.match;
  const [pickedKey, setPickedKey] = useState<string>();
  const candidate = match?.prior ?? priors.find((p) => p.key === (pickedKey ?? suggestion?.prior.key)) ?? priors[0];
  const m = finding.measurement;

  const importButton = (
    <>
      <button type="button" className="link" onClick={() => fileInput.current?.click()}>
        Import spreadsheet (CSV)…
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) onImport(file);
          e.currentTarget.value = '';
        }}
      />
    </>
  );

  return (
    <div className="followup">
      <h3>Compare with earlier scan</h3>
      {priors.length === 0 && !match ? (
        <p className="hint">
          No earlier measurements for {patientId || 'this patient'} yet. Measure the earlier scan here, or {importButton}
        </p>
      ) : (
        <>
          {!match && (
            <label className="prior-select">
              Same nodule as
              <select value={candidate?.key ?? ''} onChange={(e) => setPickedKey(e.target.value)}>
                {priors.map((p) => (
                  <option key={p.key} value={p.key}>
                    {describePrior(p)}
                    {suggestion?.prior.key === p.key ? `  — closest (${suggestion.distanceMm.toFixed(0)} mm)` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          {candidate && (
            <>
              <div className="prior-compare">
                {candidate.thumbnail ? (
                  <img src={candidate.thumbnail} alt={`${candidate.noduleId} on the earlier scan`} />
                ) : (
                  <div className="no-thumb">No earlier image{candidate.source === 'spreadsheet' ? ' (from spreadsheet)' : ''}</div>
                )}
                {finding.thumbnail ? <img src={finding.thumbnail} alt={`${finding.name} now`} /> : <div className="no-thumb">Approve to capture</div>}
              </div>
              <table className="change-table">
                <thead>
                  <tr>
                    <th />
                    <th>{candidate.timepoint || 'Earlier'}</th>
                    <th>Now</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  <ChangeRow label="Long axis" unit="mm" c={compare(candidate, { longMm: m?.longMm }).long} />
                  <ChangeRow label="Short axis" unit="mm" c={compare(candidate, { shortMm: m?.shortMm }).short} />
                  <ChangeRow label="Volume" unit="mm³" digits={0} c={compare(candidate, { volumeMm3: m?.volumeMm3 }).volume} />
                </tbody>
              </table>
              {candidate.notes && <div className="hint">Earlier note: {candidate.notes}</div>}
            </>
          )}

          {match ? (
            <div className="match-row">
              <span className={`chip chip--match-${match.status.toLowerCase()}`}>Match: {match.status}</span>
              <button type="button" className="link" onClick={onClearMatch}>
                Change
              </button>
            </div>
          ) : (
            candidate && (
              <div className="match-row">
                <button type="button" className="primary" onClick={() => onMatch(candidate, 'Confident')}>
                  Same nodule — Confident <kbd>M</kbd>
                </button>
                <button type="button" onClick={() => onMatch(candidate, 'Uncertain')}>
                  Uncertain
                </button>
              </div>
            )
          )}
          <div className="followup-footer">
            {candidate?.centroidWorld && onGoToPriorPosition && (
              <button type="button" className="link" onClick={() => onGoToPriorPosition(candidate)} title="Approximate: same position in patient coordinates">
                Go to its earlier position (approx.)
              </button>
            )}
            {importButton}
          </div>
        </>
      )}
    </div>
  );
}
