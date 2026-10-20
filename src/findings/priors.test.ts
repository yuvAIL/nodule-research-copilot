import { describe, expect, it } from 'vitest';
import { changeLabel, compare, importSpreadsheet, pairFindings, suggestMatch, type PriorRecord } from './priors';

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

describe('pairFindings', () => {
  const at = (key: string, at: [number, number, number], date = '2006-09-05', volumeMm3 = 1000): PriorRecord => ({
    key,
    source: 'app',
    patientId: 'P',
    timepoint: 'Baseline',
    date,
    series: '1',
    noduleId: key,
    centroidWorld: at,
    volumeMm3,
  });

  it('pairs one-to-one, closest first, earlier dates only, within the distance limit', () => {
    const priors = [at('A', [0, 0, 0]), at('B', [30, 0, 0]), at('LATER', [1, 0, 0], '2006-10-01')];
    const pairs = pairFindings(
      [
        { id: 'n1', centroidWorld: [2, 0, 0] },
        { id: 'n2', centroidWorld: [5, 0, 0] },
        { id: 'far', centroidWorld: [200, 0, 0] },
      ],
      priors,
      '2006-09-20',
    );
    expect(pairs.get('n1')?.prior.key).toBe('A');
    expect(pairs.get('n2')?.prior.key).toBe('B');
    expect(pairs.has('far')).toBe(false);
  });

  it('labels the change with an arrow', () => {
    expect(changeLabel(at('A', [0, 0, 0]), { volumeMm3: 550 })).toEqual({ text: '▼45%', dir: 'down' });
    expect(changeLabel(at('A', [0, 0, 0]), { volumeMm3: 1200 })).toEqual({ text: '▲20%', dir: 'up' });
  });
});
