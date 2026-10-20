import type { CtSeries } from '../dicom/types';
import { formatDicomDate } from '../dicom/headerMapping';

interface Props {
  patientId: string;
  scans: CtSeries[];
  currentUid?: string;
  timepointOf: (s: CtSeries) => string;
  onOpen: (uid: string) => void;
}

/** All scans of the open patient, oldest first — one click (or , / .) to jump between timepoints. */
export function PatientTimeline({ patientId, scans, currentUid, timepointOf, onOpen }: Props) {
  if (scans.length === 0) return null;
  return (
    <section className="panel timeline">
      <div className="timeline-head">
        <h2>Patient</h2>
        <span className="mono timeline-patient">{patientId || '—'}</span>
        {scans.length > 1 && (
          <span className="kbd-inline">
            <kbd>,</kbd>
            <kbd>.</kbd> switch scan
          </span>
        )}
      </div>
      <ol className="timeline-track">
        {scans.map((s) => {
          const h = s.instances[0];
          const current = s.seriesInstanceUid === currentUid;
          return (
            <li key={s.seriesInstanceUid}>
              <button
                type="button"
                className={`timeline-chip${current ? ' timeline-chip--current' : ''}`}
                aria-current={current ? 'true' : undefined}
                onClick={() => onOpen(s.seriesInstanceUid)}
                title={s.label}
              >
                <span className="timeline-dot" aria-hidden="true" />
                <span className="timeline-date mono">{formatDicomDate(h?.studyDate) ?? 'no date'}</span>
                <span className="timeline-tp">{timepointOf(s)}</span>
                <span className="timeline-meta">
                  #{h?.seriesNumber ?? '?'} · {s.instances.length} slices
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
