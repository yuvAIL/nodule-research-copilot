import { describe, expect, it } from 'vitest';
import { CSV_COLUMNS, missingFields, parseCsv, screenshotName, toCsv, toRow, type ScanInfo } from './record';
import type { Finding } from './types';

const scan: ScanInfo = { patientId: 'RIDER-1129164940', studyDate: '2006-09-05', timepoint: 'Baseline', series: '100' };

function finding(overrides: Partial<Finding> = {}): Finding {
  const measurement = {
    voxelCount: 1000,
    volumeMm3: 31495.4,
    sliceIndex: 100,
    longMm: 58.46,
    shortMm: 36.62,
    longAxis: [[0, 0], [1, 1]] as [[number, number], [number, number]],
    shortAxis: [[0, 1], [1, 0]] as [[number, number], [number, number]],
    centroid: { i: 1, j: 1, k: 100 },
    slicesSpanned: 41,
  };
  return {
    id: 'x',
    label: 1,
    name: 'N1',
    source: 'click',
    edited: true,
    status: 'approved',
    measurement,
    approved: { measurement, at: Date.UTC(2026, 9, 19, 18, 0, 0) },
    kMin: 80,
    kMax: 120,
    type: 'solid',
    lobe: 'RLL',
    notes: 'abuts pleura, "spiculated", 2 lesions',
    timeline: [
      { t: Date.UTC(2026, 9, 19, 17, 58, 30), action: 'created' },
      { t: Date.UTC(2026, 9, 19, 18, 0, 0), action: 'approved' },
    ],
    ...overrides,
  };
}

describe('research record', () => {
  it('fills a row in Daniel’s column order from scan + finding', () => {
    const row = toRow(scan, finding());
    expect(CSV_COLUMNS.slice(0, 13)).toEqual([
      'Patient ID', 'Date', 'Timepoint', 'Series', 'Nodule ID', 'Type', 'Lobe',
      'Long diameter (mm)', 'Short diameter (mm)', 'Volume (mm3)', 'Match status', 'Minutes', 'Notes',
    ]);
    expect(row['Long diameter (mm)']).toBe('58.5');
    expect(row['Short diameter (mm)']).toBe('36.6');
    expect(row['Volume (mm3)']).toBe('31495');
    expect(row.Minutes).toBe('1.5');
    expect(row['Measurement source']).toBe('semi-auto, edited');
    expect(row['Measured slice']).toBe('101');
    expect(row.Screenshot).toBe('RIDER-1129164940_Baseline_N1.png');
  });

  it('writes Excel-safe CSV that round-trips through the parser', () => {
    const csv = toCsv([toRow(scan, finding())]);
    expect(csv.charCodeAt(0) === 0xfeff).toBe(true);
    const parsed = parseCsv(csv);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual([...CSV_COLUMNS]);
    expect(parsed[1]?.[12]).toBe('abuts pleura, "spiculated", 2 lesions');
  });

  it('flags missing judgment fields', () => {
    expect(missingFields(finding({ type: '', lobe: '' }))).toEqual(['Type', 'Lobe']);
    expect(missingFields(finding())).toEqual([]);
  });

  it('sanitises screenshot file names', () => {
    expect(screenshotName({ ...scan, patientId: 'a/b c', timepoint: 'Follow-up 1' }, finding())).toBe('a-b-c_Follow-up-1_N1.png');
  });

  it('identifies the finding and series, and never writes a volume for a single-slice outline', () => {
    const one = finding();
    const flat = finding({ id: 'flat', source: 'manual', edited: false });
    flat.measurement = { ...(flat.measurement as NonNullable<Finding['measurement']>), slicesSpanned: 1 };
    flat.approved = { measurement: flat.measurement, at: 1 };
    const rows = [toRow({ ...scan, seriesUid: 'S1' }, one), toRow({ ...scan, seriesUid: 'S1' }, flat)];
    expect(rows[0]?.['Finding UID']).toBe('x');
    expect(rows[0]?.['Series UID']).toBe('S1');
    expect(rows[0]?.['Volume (mm3)']).toBe('31495');
    expect(rows[0]?.['Volume basis']).toBe('3-D outline, 41 slices');
    expect(rows[1]?.['Volume (mm3)']).toBe('');
    expect(rows[1]?.['Volume basis']).toContain('single slice');
  });

  it('exports the approved values, not later unapproved edits, and keeps the original proposal', () => {
    const f = finding({ source: 'ai' });
    f.proposal = { ...(f.measurement as NonNullable<Finding['measurement']>), longMm: 50, volumeMm3: 25000 };
    const row = toRow(scan, f);
    expect(row['Long diameter (mm)']).toBe('58.5');
    expect(row['Proposed long diameter (mm)']).toBe('50.0');
    expect(row['Proposed volume (mm3)']).toBe('25000');
  });

  it('records a researcher decision of "no earlier match"', () => {
    const row = toRow(scan, finding({ noPrior: { at: 1 } }));
    expect(row['Match status']).toBe('No earlier match');
  });
});

