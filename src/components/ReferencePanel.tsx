import { useRef } from 'react';
import type { Measurement } from '../measure/measure';
import type { Agreement } from '../reference/compare';
import type { RasterSegment } from '../reference/rasterize';

export interface LoadedReference {
  kind: 'SEG' | 'RTSTRUCT';
  fileName: string;
  description?: string;
  creator?: string;
  segments: (RasterSegment & { measurement?: Measurement })[];
  warnings: string[];
}

export type AgreementView =
  | { kind: 'ok'; finding: string; segment: string; agreement: Agreement }
  | { kind: 'no-overlap'; finding: string }
  | { kind: 'busy' };

interface Props {
  ready: boolean;
  reference?: LoadedReference;
  show: boolean;
  error?: string;
  agreement?: AgreementView;
  onLoad: (file: File) => void;
  onShow: (show: boolean) => void;
  /** Segment (1-based) shown on the image and used for the comparison. */
  selected?: number;
  onSelect: (label: number) => void;
  onClear: () => void;
  onGoTo: (sliceIndex: number) => void;
}

const signed = (v: number, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;

/** Expert outline (read-only) from a DICOM SEG / RTSTRUCT, and how the selected finding agrees with it. */
export function ReferencePanel({ ready, reference, show, error, agreement, onLoad, onShow, selected, onSelect, onClear, onGoTo }: Props) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <section className="panel reference">
      <h2>Expert reference</h2>
      {!reference && (
        <>
          <p className="hint">
            Load an expert outline (DICOM SEG or RTSTRUCT, e.g. RIDER-LungCT-Seg) drawn on this scan. It is shown
            read-only and compared with your findings. Read locally — never uploaded.
          </p>
          <button type="button" disabled={!ready} onClick={() => input.current?.click()}>
            Load expert outline…
          </button>
          {!ready && <p className="hint">Available once the 3D data of a scan is ready.</p>}
        </>
      )}
      <input
        ref={input}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onLoad(f);
        }}
      />
      {error && <p className="reference-error">{error}</p>}

      {reference && (
        <>
          <p className="reference-source">
            <span className="tag tag--expert">{reference.kind}</span> {reference.description ?? reference.fileName}
            {reference.creator && <span className="muted"> · {reference.creator}</span>}
          </p>
          <label className="check">
            <input type="checkbox" checked={show} onChange={(e) => onShow(e.target.checked)} /> Show the selected outline (dotted
            magenta)
          </label>
          <ul className="reference-segments">
            {reference.segments.map((s) => (
              <li key={s.label}>
                <input
                  type="radio"
                  name="reference-segment"
                  aria-label={`Compare with ${s.name}`}
                  disabled={s.voxelCount === 0}
                  checked={selected === s.label}
                  onChange={() => onSelect(s.label)}
                />
                <span>
                  {s.name}
                  {s.algorithmType && <span className="muted"> ({s.algorithmType.toLowerCase()})</span>}
                </span>
                <span className="muted">
                  {s.voxelCount === 0
                    ? 'not on this series'
                    : s.measurement
                      ? `${s.measurement.longMm.toFixed(1)} × ${s.measurement.shortMm.toFixed(1)} mm · ${(s.measurement.volumeMm3 / 1000).toFixed(2)} mL`
                      : ''}
                </span>
                {s.measurement && (
                  <button type="button" className="link" onClick={() => onGoTo(s.measurement?.sliceIndex ?? 0)}>
                    go to
                  </button>
                )}
              </li>
            ))}
          </ul>
          {reference.warnings.map((w) => (
            <p key={w} className="hint">
              ⚠ {w}
            </p>
          ))}

          <div className="agreement">
            <h3>Selected finding vs expert</h3>
            {!agreement && <p className="hint">Select a finding to compare it with the expert outline.</p>}
            {agreement?.kind === 'busy' && <p className="hint">Comparing…</p>}
            {agreement?.kind === 'no-overlap' && (
              <p className="hint">{agreement.finding} does not overlap any expert outline (a different lesion, or a miss).</p>
            )}
            {agreement?.kind === 'ok' && (
              <table className="agreement-table">
                <thead>
                  <tr>
                    <th />
                    <th>{agreement.finding}</th>
                    <th>Expert</th>
                    <th>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Long</td>
                    <td>{agreement.agreement.app.longMm.toFixed(1)}</td>
                    <td>{agreement.agreement.ref.longMm.toFixed(1)}</td>
                    <td>{signed(agreement.agreement.longDiffMm)} mm</td>
                  </tr>
                  <tr>
                    <td>Short</td>
                    <td>{agreement.agreement.app.shortMm.toFixed(1)}</td>
                    <td>{agreement.agreement.ref.shortMm.toFixed(1)}</td>
                    <td>{signed(agreement.agreement.shortDiffMm)} mm</td>
                  </tr>
                  <tr>
                    <td>Volume</td>
                    <td>{(agreement.agreement.app.volumeMm3 / 1000).toFixed(2)}</td>
                    <td>{(agreement.agreement.ref.volumeMm3 / 1000).toFixed(2)}</td>
                    <td>{signed(agreement.agreement.volumeDiffPct, 0)} %</td>
                  </tr>
                  <tr>
                    <td>Dice</td>
                    <td colSpan={3}>
                      <strong>{agreement.agreement.dice.toFixed(2)}</strong>{' '}
                      <span className="muted">(overlap with “{agreement.segment}”; 1 = identical)</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
          <button type="button" className="link" onClick={onClear}>
            Remove expert outline
          </button>
        </>
      )}
    </section>
  );
}
