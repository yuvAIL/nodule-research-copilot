import type { Measurement } from '../measure/measure';
import type { FindingMatch } from './priors';

export type FindingStatus = 'unreviewed' | 'approved' | 'rejected';

/** Where the outline came from. Edits by the researcher are tracked separately (`edited`). */
export type FindingSource = 'click' | 'manual' | 'ai';

/** Which model proposed an AI candidate (read from the result file, never assumed). */
export interface AiProvenance {
  /** e.g. "TotalSegmentator" (DICOM Manufacturer / software of the SEG file). */
  model: string;
  /** Segment the candidate came from, e.g. "lung_nodules". */
  segment: string;
  version?: string;
  /** SOPInstanceUID of the AI result file (prevents importing it twice). */
  fileUid: string;
  /** Date the AI result file was created (DICOM ContentDate/SeriesDate), YYYY-MM-DD. */
  runDate?: string;
  /** 1-based index of the connected component, largest first. */
  component: number;
}

export type NoduleType = '' | 'solid' | 'part-solid' | 'ground-glass' | 'calcified' | 'other';
export type Lobe = '' | 'RUL' | 'RML' | 'RLL' | 'LUL' | 'Lingula' | 'LLL';

export interface TimelineEvent {
  t: number;
  action:
    | 'created'
    | 'resegmented'
    | 'edited'
    | 'undo'
    | 'reset'
    | 'approved'
    | 'rejected'
    | 'reopened'
    | 'matched'
    | 'fields'
    | 'exported';
}

export interface Finding {
  id: string;
  /** Value in the shared labelmap (1..255). */
  label: number;
  /** Display name, e.g. N1. */
  name: string;
  source: FindingSource;
  /** True once the researcher changed the outline with brush/eraser. */
  edited: boolean;
  status: FindingStatus;
  seed?: { i: number; j: number; k: number };
  segmentation?: { thresholdHu: number; maxRadiusMm: number; erosion: number; leaked: boolean; lungConstrained?: boolean };
  measurement?: Measurement;
  /** Values locked at approval time. Kept after a later edit (status goes back to "to review") as history. */
  approved?: { measurement: Measurement; at: number };
  /**
   * The outline's measurement as first proposed (AI candidate or click segmentation), before any researcher edit.
   * Kept separately so the record can show what the AI/algorithm proposed vs what was approved.
   */
  proposal?: Measurement;
  /** Slice range known to contain the outline (for fast re-measurement). */
  kMin: number;
  kMax: number;
  type: NoduleType;
  lobe: Lobe;
  notes: string;
  /** Small JPEG of the measured slice with the outline, captured at approval. */
  thumbnail?: string;
  /** Researcher-confirmed link to the same nodule on an earlier scan. */
  match?: FindingMatch;
  /** Researcher decided this nodule has no earlier counterpart (new, or not visible before). Excludes `match`. */
  noPrior?: { at: number };
  timeline: TimelineEvent[];
  /** Set for AI candidates. */
  ai?: AiProvenance;
  /** Rough location from the AI lung mask, e.g. "Right lung · lower third". Always an estimate. */
  positionEstimate?: string;
}

export function aiLabel(ai: AiProvenance): string {
  return `${ai.model}${ai.version ? ` ${ai.version}` : ''} · ${ai.segment}${ai.runDate ? ` · run ${ai.runDate}` : ''}`;
}

export function provenanceLabel(f: Finding): string {
  const base =
    f.source === 'ai' && f.ai
      ? `AI candidate (${aiLabel(f.ai)})`
      : f.source === 'click'
        ? 'Semi-automatic (click segmentation)'
        : 'Manual outline (brush)';
  return f.edited && f.source !== 'manual' ? `${base}, edited by researcher` : base;
}

/** Seconds from creation to approval, or undefined while not approved. */
export function secondsToApproval(f: Finding): number | undefined {
  const created = f.timeline.find((e) => e.action === 'created')?.t;
  const approved = [...f.timeline].reverse().find((e) => e.action === 'approved')?.t;
  return created !== undefined && approved !== undefined ? (approved - created) / 1000 : undefined;
}

/**
 * A volume is only meaningful when the outline covers the lesion in 3-D. An outline painted on a single slice
 * gives valid diameters on that slice, but its "volume" is just one slice thick and must not be read as the
 * lesion volume.
 */
export function hasLesionVolume(m: Measurement | undefined): boolean {
  return !!m && m.slicesSpanned >= 2;
}

/** The measurement that counts for the record: the approved one while approved, otherwise the current outline. */
export function recordMeasurement(f: Finding): Measurement | undefined {
  return f.status === 'approved' && f.approved ? f.approved.measurement : f.measurement;
}

/** True when the outline changed after it was approved (the finding needs approving again). */
export function changedSinceApproval(f: Finding): boolean {
  return f.status !== 'approved' && !!f.approved && f.timeline.some((e) => e.t > (f.approved as { at: number }).at && (e.action === 'edited' || e.action === 'undo' || e.action === 'reset' || e.action === 'resegmented'));
}
