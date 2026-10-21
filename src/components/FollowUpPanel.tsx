import { useRef, useState } from 'react';
import { compare, describePrior, type Change, type MatchStatus, type PriorRecord } from '../findings/priors';
import { hasLesionVolume, type Finding } from '../findings/types';

export interface Recon {
  kernel?: string;
  sliceThicknessMm?: number;
}

/** Other scans of this patient in the open folder, for the "no earlier measurements" explanation. */
export interface OtherScan {
  uid: string;
  label: string;
  date: string;
  /** Accepted findings saved for it in this browser. */
  accepted: number;
}

interface Props {
  finding: Finding;
  priors: PriorRecord[];
  /** Closest prior by position, if any (a hint, not registration). */
  suggestion?: { prior: PriorRecord; distanceMm: number };
  patientId: string;
  onMatch: (prior: PriorRecord, status: MatchStatus) => void;
  onClearMatch: () => void;
  /** true = the researcher says this nodule has no earlier match (new, or not visible before). */
  onNoPrior: (noPrior: boolean) => void;
  onImport: (file: File) => void;
  onOpenScan?: (uid: string) => void;
  now: { date: string; timepoint: string; recon?: Recon };
  otherScans: OtherScan[];
  /** Earlier nodules already confirmed for another finding of this scan: prior key → finding name. */
  takenBy?: Map<string, string>;
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

const reconText = (r: Recon | undefined) =>
  [r?.kernel, r?.sliceThicknessMm !== undefined ? `${r.sliceThicknessMm} mm slices` : undefined].filter(Boolean).join(', ');

function ReconNote({ earlier, now }: { earlier: PriorRecord; now?: Recon }) {
  const a = { kernel: earlier.kernel, sliceThicknessMm: earlier.sliceThicknessMm };
  if (earlier.source === 'spreadsheet' || (!a.kernel && a.sliceThicknessMm === undefined)) {
    return <div className="hint recon-note">Reconstruction of the earlier scan unknown (not recorded). Check kernel and slice thickness before comparing.</div>;
  }
  const differs = (a.kernel ?? '') !== (now?.kernel ?? '') || a.sliceThicknessMm !== now?.sliceThicknessMm;
  return differs ? (
    <div className="hint recon-note recon-note--warn">
      Reconstructed differently: earlier {reconText(a) || 'unknown'}, now {reconText(now) || 'unknown'}. Kernel and slice thickness
      alone change measured size, so part of the change can be technical.
    </div>
  ) : (
    <div className="hint recon-note">Same reconstruction: {reconText(a)}.</div>
  );
}

export function FollowUpPanel({
  finding,
  priors,
  suggestion,
  patientId,
  onMatch,
  onClearMatch,
  onNoPrior,
  onImport,
  onOpenScan,
  onGoToPriorPosition,
  now,
  otherScans,
  takenBy,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const match = finding.match;
  const [pickedKey, setPickedKey] = useState<string>();
  // Never fall back to an arbitrary earlier nodule: without a suggestion the researcher picks one (or says "none").
  const candidate = match?.prior ?? priors.find((p) => p.key === (pickedKey ?? suggestion?.prior.key));
  const m = finding.measurement;
  const nowVolume = hasLesionVolume(m) ? m?.volumeMm3 : undefined;
  const pickedByYou = !match && pickedKey !== undefined && pickedKey !== suggestion?.prior.key;
  const earlierScans = otherScans.filter((o) => !now.date || !o.date || o.date < now.date);

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
      {finding.noPrior ? (
        <div className="match-row">
          <span className="chip chip--match-none">No earlier match (your decision)</span>
          <button type="button" className="link" onClick={() => onNoPrior(false)}>
            Change
          </button>
        </div>
      ) : priors.length === 0 && !match ? (
        <div className="hint empty-compare">
          <b>No earlier measurements to compare with.</b>{' '}
          {earlierScans.length === 0 && otherScans.length > 0 ? (
            <>This is the earliest scan: its accepted findings become the comparison for the later scans.</>
          ) : earlierScans.length === 0 ? (
            <>
              This browser has no earlier scan of {patientId || 'this patient'} (comparisons use only accepted findings of scans
              opened here, or an imported sheet). Open a folder that contains the earlier scan, or {importButton}
            </>
          ) : (
            <>
              Earlier measurements come only from <i>accepted</i> findings.
              <ul>
                {earlierScans.map((o) => (
                  <li key={o.uid}>
                    {o.label} ({o.date || 'no date'}): {o.accepted ? `${o.accepted} accepted, but none near this one` : 'nothing accepted yet'}
                    {onOpenScan && (
                      <>
                        {' '}
                        <button type="button" className="link" onClick={() => onOpenScan(o.uid)}>
                          Open it
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              Accept its nodule there (A), then come back here (<kbd>.</kbd> next scan). Or {importButton}
            </>
          )}
          {!(earlierScans.length === 0 && otherScans.length > 0) && (
          <div className="match-row">
            <button type="button" className="ghost small" onClick={() => onNoPrior(true)} title="Record that this nodule has no earlier match">
              New: no earlier match
            </button>
          </div>
          )}
        </div>
      ) : (
        <>
          {!match && (
            <label className="prior-select">
              Same nodule as
              <select value={candidate?.key ?? ''} onChange={(e) => setPickedKey(e.target.value || undefined)}>
                {!suggestion && <option value="">— pick an earlier nodule, if any —</option>}
                {priors.map((p) => (
                  <option key={p.key} value={p.key}>
                    {describePrior(p)}
                    {suggestion?.prior.key === p.key ? `  — closest (${suggestion.distanceMm.toFixed(0)} mm)` : ''}
                    {takenBy?.get(p.key) ? `  — already matched to ${takenBy.get(p.key)}` : ''}
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
                    <th>
                      {candidate.timepoint || 'Earlier'}
                      <div className="th-sub">{candidate.date || 'no date'}</div>
                    </th>
                    <th>
                      {now.timepoint || 'Now'}
                      <div className="th-sub">{now.date || 'no date'}</div>
                    </th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  <ChangeRow label="Long axis (mm)" unit="mm" c={compare(candidate, { longMm: m?.longMm }).long} />
                  <ChangeRow label="Short axis (mm)" unit="mm" c={compare(candidate, { shortMm: m?.shortMm }).short} />
                  <ChangeRow label="Volume (mm³)" unit="mm³" digits={0} c={compare(candidate, { volumeMm3: nowVolume }).volume} />
                </tbody>
              </table>
              {m && !hasLesionVolume(m) && <div className="hint">Volume not compared: the current outline is on one slice only.</div>}
              {candidate.volumeMm3 === undefined && <div className="hint">No earlier volume recorded (diameters only).</div>}
              <ReconNote earlier={candidate} now={now.recon} />
              <div className="hint">% = change ÷ earlier value. A measured change, not a statement about growth or response.</div>
              {candidate.notes && <div className="hint">Earlier note: {candidate.notes}</div>}
            </>
          )}

          {match ? (
            <div className="match-row">
              <span className={`chip chip--match-${match.status.toLowerCase()}`}>
                Same nodule as {match.prior.noduleId}: {match.status === 'Confident' ? 'confirmed by you' : 'uncertain (your call)'}
              </span>
              <button type="button" className="link" onClick={onClearMatch}>
                Change
              </button>
            </div>
          ) : !candidate ? (
            <div className="match-row">
              <span className="hint">No earlier nodule within 50 mm of this one.</span>
              <button type="button" className="ghost small" onClick={() => onNoPrior(true)}>
                Not in earlier scan
              </button>
            </div>
          ) : (
            candidate && (
              <>
                <div className="hint match-source">
                  {pickedByYou
                    ? 'Picked by you, not confirmed yet.'
                    : suggestion && suggestion.prior.key === candidate.key
                      ? `Suggested by position only (closest earlier nodule, ${suggestion.distanceMm.toFixed(0)} mm apart). Not confirmed: check the images.`
                      : 'Picked by you, not confirmed yet.'}
                </div>
                <div className="match-row">
                  <button type="button" className="primary" onClick={() => onMatch(candidate, 'Confident')}>
                    Same nodule <kbd>M</kbd>
                  </button>
                  <button type="button" onClick={() => onMatch(candidate, 'Uncertain')}>
                    Probably same (uncertain)
                  </button>
                  <button type="button" className="ghost" onClick={() => onNoPrior(true)}>
                    Not in earlier scan
                  </button>
                </div>
              </>
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
