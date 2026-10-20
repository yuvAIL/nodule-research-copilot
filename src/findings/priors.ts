import { parseCsv } from './record';

/**
 * Earlier measurements of the same patient, used for follow-up comparison.
 * They come either from scans already measured in this app (saved per series
 * in this browser) or from the lab's existing spreadsheet (CSV import).
 */

export type MatchStatus = 'Confident' | 'Uncertain';

export interface PriorRecord {
  /** Stable key, unique across sources. */
  key: string;
  source: 'app' | 'spreadsheet';
  patientId: string;
  timepoint: string;
  date: string;
  series: string;
  seriesUid?: string;
  noduleId: string;
  longMm?: number;
  shortMm?: number;
  volumeMm3?: number;
  type?: string;
  lobe?: string;
  notes?: string;
  thumbnail?: string;
  /** Centre of the nodule in patient coordinates (mm), when measured in this app. */
  centroidWorld?: [number, number, number];
}

export interface FindingMatch {
  status: MatchStatus;
  prior: PriorRecord;
  at: number;
}

export interface Change {
  priorMm?: number;
  currentMm?: number;
  deltaMm?: number;
  deltaPct?: number;
}

function change(prior: number | undefined, current: number | undefined): Change {
  if (prior === undefined || current === undefined || !Number.isFinite(prior) || !Number.isFinite(current)) {
    return { priorMm: prior, currentMm: current };
  }
  const deltaMm = current - prior;
  return { priorMm: prior, currentMm: current, deltaMm, deltaPct: prior !== 0 ? (deltaMm / prior) * 100 : undefined };
}

export function compare(
  prior: PriorRecord,
  current: { longMm?: number; shortMm?: number; volumeMm3?: number },
): { long: Change; short: Change; volume: Change } {
  return {
    long: change(prior.longMm, current.longMm),
    short: change(prior.shortMm, current.shortMm),
    volume: change(prior.volumeMm3, current.volumeMm3),
  };
}

/**
 * Suggests the prior finding closest to the current one in patient
 * coordinates (only possible for priors measured in this app). This is a
 * proximity hint for the researcher, not automatic registration.
 */
export function suggestMatch(
  priors: PriorRecord[],
  centroidWorld: [number, number, number] | undefined,
): { prior: PriorRecord; distanceMm: number } | undefined {
  if (!centroidWorld) return undefined;
  let best: { prior: PriorRecord; distanceMm: number } | undefined;
  for (const p of priors) {
    if (!p.centroidWorld) continue;
    const d = Math.hypot(
      p.centroidWorld[0] - centroidWorld[0],
      p.centroidWorld[1] - centroidWorld[1],
      p.centroidWorld[2] - centroidWorld[2],
    );
    if (!best || d < best.distanceMm) best = { prior: p, distanceMm: d };
  }
  return best;
}

/** Default: an earlier nodule further away than this (mm, patient coordinates) is not suggested. */
export const MAX_PAIR_DISTANCE_MM = 50;

/**
 * Pairs every current finding with its most likely earlier self, one-to-one, closest pairs first.
 * Only priors from an earlier date are used. Positions come from patient coordinates of two separate
 * scans (breathing / positioning shift), so a pair is a suggestion the researcher confirms.
 */
export function pairFindings(
  current: { id: string; centroidWorld?: [number, number, number] }[],
  priors: PriorRecord[],
  currentDate: string,
  maxDistanceMm = MAX_PAIR_DISTANCE_MM,
): Map<string, { prior: PriorRecord; distanceMm: number }> {
  const earlier = priors.filter((p) => p.centroidWorld && (!currentDate || !p.date || p.date < currentDate));
  const pairs: { id: string; prior: PriorRecord; distanceMm: number }[] = [];
  for (const c of current) {
    if (!c.centroidWorld) continue;
    for (const p of earlier) {
      const w = p.centroidWorld as [number, number, number];
      const d = Math.hypot(w[0] - c.centroidWorld[0], w[1] - c.centroidWorld[1], w[2] - c.centroidWorld[2]);
      if (d <= maxDistanceMm) pairs.push({ id: c.id, prior: p, distanceMm: d });
    }
  }
  pairs.sort((a, b) => a.distanceMm - b.distanceMm);
  const out = new Map<string, { prior: PriorRecord; distanceMm: number }>();
  const used = new Set<string>();
  for (const pr of pairs) {
    if (out.has(pr.id) || used.has(pr.prior.key)) continue;
    out.set(pr.id, { prior: pr.prior, distanceMm: pr.distanceMm });
    used.add(pr.prior.key);
  }
  return out;
}

/** "▼ 45%" style volume change (falls back to long axis), or undefined when not comparable. */
export function changeLabel(prior: PriorRecord, now: { volumeMm3?: number; longMm?: number }): { text: string; dir: 'up' | 'down' | 'same' } | undefined {
  const pair =
    prior.volumeMm3 && now.volumeMm3 ? [prior.volumeMm3, now.volumeMm3] : prior.longMm && now.longMm ? [prior.longMm, now.longMm] : undefined;
  if (!pair) return undefined;
  const [before, after] = pair as [number, number];
  const pct = ((after - before) / before) * 100;
  const dir = Math.abs(pct) < 0.5 ? 'same' : pct > 0 ? 'up' : 'down';
  return { text: `${dir === 'up' ? '▲' : dir === 'down' ? '▼' : '='}${Math.abs(pct).toFixed(0)}%`, dir };
}

// ── spreadsheet import ─────────────────────────────────────────

type Field = 'patientId' | 'date' | 'timepoint' | 'series' | 'noduleId' | 'type' | 'lobe' | 'long' | 'short' | 'volume' | 'notes';

/** Header patterns (lower-case) for each field; first match wins. */
const HEADER_PATTERNS: [Field, RegExp][] = [
  ['patientId', /patient/],
  ['date', /^(study )?date|scan date/],
  ['timepoint', /time ?point|visit/],
  ['series', /series/],
  ['noduleId', /nodule|lesion|tumou?r ?id/],
  ['type', /^type|nodule type/],
  ['lobe', /lobe/],
  ['long', /long|major|max.*diam/],
  ['short', /short|minor/],
  ['volume', /volume|vol\b/],
  ['notes', /note|comment/],
];

function toNumber(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number.parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

export interface ImportResult {
  records: PriorRecord[];
  mapped: Partial<Record<Field, string>>;
  skippedRows: number;
}

/** Reads the lab's measurement sheet (CSV). Column names are matched loosely. */
export function importSpreadsheet(text: string, fileName: string): ImportResult {
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  const index: Partial<Record<Field, number>> = {};
  const mapped: Partial<Record<Field, string>> = {};
  header.forEach((raw, col) => {
    const h = raw.trim().toLowerCase();
    for (const [field, re] of HEADER_PATTERNS) {
      if (index[field] === undefined && re.test(h)) {
        index[field] = col;
        mapped[field] = raw.trim();
        break;
      }
    }
  });
  const get = (row: string[], f: Field) => (index[f] === undefined ? undefined : row[index[f] as number]?.trim());
  const records: PriorRecord[] = [];
  let skippedRows = 0;
  rows.slice(1).forEach((row, n) => {
    const patientId = get(row, 'patientId') ?? '';
    const noduleId = get(row, 'noduleId') ?? '';
    const longMm = toNumber(get(row, 'long'));
    if (!patientId || (!noduleId && longMm === undefined)) {
      skippedRows++;
      return;
    }
    records.push({
      key: `sheet:${fileName}:${n + 2}`,
      source: 'spreadsheet',
      patientId,
      timepoint: get(row, 'timepoint') ?? '',
      date: get(row, 'date') ?? '',
      series: get(row, 'series') ?? '',
      noduleId: noduleId || `row ${n + 2}`,
      longMm,
      shortMm: toNumber(get(row, 'short')),
      volumeMm3: toNumber(get(row, 'volume')),
      type: get(row, 'type'),
      lobe: get(row, 'lobe'),
      notes: get(row, 'notes'),
    });
  });
  return { records, mapped, skippedRows };
}

export function describePrior(p: PriorRecord): string {
  const dims =
    p.longMm !== undefined ? `${p.longMm.toFixed(1)}${p.shortMm !== undefined ? ` × ${p.shortMm.toFixed(1)}` : ''} mm` : 'no diameters';
  const when = [p.timepoint, p.date].filter(Boolean).join(' ');
  return `${p.noduleId} · ${dims} · ${when || 'earlier scan'}${p.source === 'spreadsheet' ? ' (sheet)' : ''}`;
}
