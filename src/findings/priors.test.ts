import { describe, expect, it } from 'vitest';
import { compare, importSpreadsheet, suggestMatch, type PriorRecord } from './priors';

const prior = (over: Partial<PriorRecord>): PriorRecord => ({
  key: 'k',
  source: 'app',
  patientId: 'P1',
  timepoint: 'Baseline',
  date: '2006-09-05',
  series: '100',
  noduleId: 'N1',
  ...over,
});

describe('follow-up comparison', () => {
  it('computes absolute and percentage change', () => {
    const c = compare(prior({ longMm: 20, shortMm: 10, volumeMm3: 1000 }), { longMm: 25, shortMm: 10, volumeMm3: 1500 });
    expect(c.long.deltaMm).toBe(5);
    expect(c.long.deltaPct).toBe(25);
    expect(c.short.deltaPct).toBe(0);
    expect(c.volume.deltaPct).toBe(50);
  });

  it('leaves change empty when a value is missing', () => {
    const c = compare(prior({ longMm: 20 }), { longMm: 22, volumeMm3: 900 });
    expect(c.volume.deltaMm).toBeUndefined();
  });

  it('suggests the closest prior by patient-coordinate position', () => {
    const near = prior({ key: 'near', centroidWorld: [10, 0, -100] });
    const far = prior({ key: 'far', centroidWorld: [-80, 20, -40] });
    const s = suggestMatch([far, near, prior({ key: 'sheet', source: 'spreadsheet' })], [12, 1, -98]);
    expect(s?.prior.key).toBe('near');
    expect((s?.distanceMm ?? 99) < 4).toBe(true);
  });
});

describe('spreadsheet import', () => {
  it('maps Daniel-style columns loosely and skips empty rows', () => {
    const csv = [
      'Patient ID,Date,Timepoint,Series,Nodule ID,Type,Lobe,Long Diameter,Short Diameter,Volume,Match Status,Minutes,Notes',
      'RIDER-1,2006-09-05,Baseline,100,N1,solid,RLL,"58,5",36.6,31495,,32,"abuts pleura, posterior"',
      ',,,,,,,,,,,,',
      'RIDER-2,2006-09-06,Baseline,2,N1,part-solid,LUL,12.0,8.0,,,25,',
    ].join('\n');
    const r = importSpreadsheet(csv, 'sheet.csv');
    expect(r.records).toHaveLength(2);
    expect(r.records[0]?.longMm).toBe(58.5);
    expect(r.records[0]?.notes).toBe('abuts pleura, posterior');
    expect(r.records[1]?.volumeMm3).toBeUndefined();
    expect(r.mapped.long).toBe('Long Diameter');
    expect(r.mapped.volume).toBe('Volume');
  });
});
