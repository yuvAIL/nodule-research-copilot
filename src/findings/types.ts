import type { Measurement } from '../measure/measure';

export type FindingStatus = 'unreviewed' | 'approved' | 'rejected';

/** Where the outline came from. Edits by the researcher are tracked separately (`edited`). */
export type FindingSource = 'click' | 'manual';

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
    | 'fields';
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
  /** Values locked at approval time. */
  approved?: { measurement: Measurement; at: number };
  /** Slice range known to contain the outline (for fast re-measurement). */
  kMin: number;
  kMax: number;
  type: NoduleType;
  lobe: Lobe;
  notes: string;
  timeline: TimelineEvent[];
}

export function provenanceLabel(f: Finding): string {
  const base = f.source === 'click' ? 'Semi-automatic (click segmentation)' : 'Manual outline (brush)';
  return f.edited && f.source === 'click' ? `${base}, edited by researcher` : base;
}

/** Seconds from creation to approval, or undefined while not approved. */
export function secondsToApproval(f: Finding): number | undefined {
  const created = f.timeline.find((e) => e.action === 'created')?.t;
  const approved = [...f.timeline].reverse().find((e) => e.action === 'approved')?.t;
  return created !== undefined && approved !== undefined ? (approved - created) / 1000 : undefined;
}
