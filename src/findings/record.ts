import type { Finding } from './types';
import { secondsToApproval } from './types';
import { compare } from './priors';

/**
 * Research spreadsheet rows in Daniel's column order. Columns after "Notes"
 * are extra provenance the tool adds; they can be ignored when pasting into
 * the existing sheet.
 */

export interface ScanInfo {
  patientId: string;
  /** YYYY-MM-DD */
  studyDate: string;
  timepoint: string;
  /** e.g. "100 — CT 1.25 mm STANDARD" */
  series: string;
}

export const CSV_COLUMNS = [
  'Patient ID',
  'Date',
  'Timepoint',
  'Series',
  'Nodule ID',
  'Type',
  'Lobe',
  'Long diameter (mm)',
  'Short diameter (mm)',
  'Volume (mm3)',
  'Match status',
  'Minutes',
  'Notes',
  // ── added by the tool ──
  'Review status',
  'Measurement source',
  'Measured slice',
  'Approved at',
  'Screenshot',
  'Prior timepoint',
  'Prior long diameter (mm)',
  'Change long diameter (mm)',
  'Change long diameter (%)',
  'Prior volume (mm3)',
  'Change volume (%)',
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];
export type ResearchRow = Record<CsvColumn, string>;

/** Required fields the researcher must fill (everything else comes from the scan or the tool). */
export const JUDGMENT_FIELDS: (keyof Pick<Finding, 'type' | 'lobe'>)[] = ['type', 'lobe'];

export function missingFields(f: Finding): string[] {
  const missing: string[] = [];
  if (!f.type) missing.push('Type');
  if (!f.lobe) missing.push('Lobe');
  if (!f.measurement) missing.push('Outline');
  return missing;
}

export function screenshotName(scan: ScanInfo, f: Finding): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe(scan.patientId || 'patient')}_${safe(scan.timepoint || 'scan')}_${safe(f.name)}.png`;
}

function num(n: number | undefined, digits: number): string {
  return n === undefined || !Number.isFinite(n) ? '' : n.toFixed(digits);
}

export function toRow(scan: ScanInfo, f: Finding): ResearchRow {
  const m = f.status === 'approved' && f.approved ? f.approved.measurement : f.measurement;
  const prior = f.match?.prior;
  const delta = prior && m ? compare(prior, { longMm: m.longMm, shortMm: m.shortMm, volumeMm3: m.volumeMm3 }) : undefined;
  const seconds = secondsToApproval(f);
  const source = f.source === 'click' ? (f.edited ? 'semi-auto, edited' : 'semi-auto') : 'manual';
  return {
    'Patient ID': scan.patientId,
    Date: scan.studyDate,
    Timepoint: scan.timepoint,
    Series: scan.series,
    'Nodule ID': f.name,
    Type: f.type,
    Lobe: f.lobe,
    'Long diameter (mm)': num(m?.longMm, 1),
    'Short diameter (mm)': num(m?.shortMm, 1),
    'Volume (mm3)': num(m?.volumeMm3, 0),
    'Match status': f.match?.status ?? '',
    Minutes: seconds === undefined ? '' : num(seconds / 60, 1),
    Notes: f.notes,
    'Review status': f.status,
    'Measurement source': source,
    'Measured slice': m ? String(m.sliceIndex + 1) : '',
    'Approved at': f.approved ? new Date(f.approved.at).toISOString() : '',
    Screenshot: f.status === 'approved' ? screenshotName(scan, f) : '',
    'Prior timepoint': prior ? [prior.timepoint, prior.date].filter(Boolean).join(' ') : '',
    'Prior long diameter (mm)': num(prior?.longMm, 1),
    'Change long diameter (mm)': num(delta?.long.deltaMm, 1),
    'Change long diameter (%)': num(delta?.long.deltaPct, 1),
    'Prior volume (mm3)': num(prior?.volumeMm3, 0),
    'Change volume (%)': num(delta?.volume.deltaPct, 1),
  };
}

/** UTF-8 byte-order mark: makes Excel read the CSV as UTF-8. */
const BOM = String.fromCharCode(0xfeff);

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC 4180 CSV with a UTF-8 byte-order mark and CRLF line endings, so Excel opens it correctly. */
export function toCsv(rows: ResearchRow[]): string {
  const lines = [CSV_COLUMNS.map(csvCell).join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c] ?? '')).join(','))];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** Parses CSV (RFC 4180, quoted fields, any line endings). Returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  for (let p = 0; p < src.length; p++) {
    const ch = src[p] as string;
    if (quoted) {
      if (ch === '"') {
        if (src[p + 1] === '"') {
          cell += '"';
          p++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[p + 1] === '\n') p++;
      row.push(cell);
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (row.some((c) => c !== '')) rows.push(row);
  }
  return rows;
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadDataUrl(filename: string, dataUrl: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
