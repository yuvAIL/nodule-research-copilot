#!/usr/bin/env node
/**
 * Writes the LIDC-IDRI radiologist outlines of each selected scan as a DICOM RTSTRUCT, so the app can show them as
 * the "expert outline" overlay (Load expert outline…). One ROI per reader per nodule, named
 * "N<id> · reader <r>/<n> · texture <t>", ROI generation algorithm MANUAL. Coordinates are mapped exactly as in
 * evaluate-lidc.cjs (pixel x = column, y = row, z = slice position).
 *
 *   node scripts/lidc/make-rtstruct.cjs [data/lidc]     → data/lidc/expert/<SeriesInstanceUID>.dcm
 */
const fs = require('node:fs');
const path = require('node:path');
const dcmjs = require('dcmjs');
const { header, loadCt } = require('../lib/dicom-node.cjs');

const DATA = path.resolve(process.argv[2] || 'data/lidc');
const gt = JSON.parse(fs.readFileSync(path.join(DATA, 'ground-truth.json'), 'utf8'));
const folders = JSON.parse(fs.readFileSync(path.join(DATA, 'ct-folders.json'), 'utf8'));
const OUT = path.join(DATA, 'expert');
fs.mkdirSync(OUT, { recursive: true });

const uid = () => `2.25.${BigInt('0x' + require('node:crypto').randomBytes(15).toString('hex')).toString()}`;
const RTSTRUCT = '1.2.840.10008.5.1.4.1.1.481.3';

for (const scan of gt.scans) {
  const stored = folders[scan.series];
  // re-base absolute paths from the downloading machine onto DATA (same folder, other mount point)
  const dir = stored && !fs.existsSync(stored) && stored.includes(`${path.sep}ct${path.sep}`)
    ? path.join(DATA, 'ct', stored.split(`${path.sep}ct${path.sep}`).pop())
    : stored;
  if (!dir) continue;
  const v = loadCt(dir);
  const files = fs.readdirSync(dir).filter((f) => /\.dcm$/i.test(f));
  const h = header(path.join(dir, files[0]));
  const s = (t) => (h.string(t) || '').trim();
  const toWorld = (x, y, z) => {
    let k = 0;
    let best = Infinity;
    for (let n = 0; n < v.slices; n++) {
      const d = Math.abs(v.origins[n][2] - z);
      if (d < best) [best, k] = [d, n];
    }
    const o = v.origins[k];
    return [0, 1, 2].map((a) => o[a] + x * v.colSpacing * v.rowCosines[a] + y * v.rowSpacing * v.colCosines[a]);
  };
  const rois = [];
  for (const n of scan.nodules) {
    n.annotations.forEach((a, r) => {
      const contours = a.contours
        .filter((c) => c.coords.length >= 3)
        .map((c) => {
          const pts = c.coords.flatMap(([x, y]) => toWorld(x, y, c.z).map((q) => Math.round(q * 1000) / 1000));
          return { ContourGeometricType: 'CLOSED_PLANAR', NumberOfContourPoints: c.coords.length, ContourData: pts };
        });
      if (contours.length)
        rois.push({ name: `N${n.id} - reader ${r + 1}/${n.annotations.length} - texture ${a.texture ?? '?'}${n.reference ? '' : ' (not a reference nodule)'}`, contours });
    });
  }
  const sop = uid();
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const ds = {
    SOPClassUID: RTSTRUCT,
    SOPInstanceUID: sop,
    StudyInstanceUID: s('x0020000d'),
    SeriesInstanceUID: uid(),
    Modality: 'RTSTRUCT',
    PatientID: s('x00100020') || scan.patient,
    PatientName: s('x00100010') || scan.patient,
    StudyDate: s('x00080020'),
    StructureSetDate: date,
    StructureSetTime: '000000',
    ContentDate: date,
    SeriesDescription: `LIDC-IDRI reader outlines - ${scan.patient}`,
    Manufacturer: 'LIDC-IDRI radiologists (XML via pylidc)',
    StructureSetLabel: 'LIDC readers',
    FrameOfReferenceUID: s('x00200052'),
    ReferencedFrameOfReferenceSequence: [
      {
        FrameOfReferenceUID: s('x00200052'),
        RTReferencedStudySequence: [
          {
            ReferencedSOPClassUID: '1.2.840.10008.3.1.2.3.1',
            ReferencedSOPInstanceUID: s('x0020000d'),
            RTReferencedSeriesSequence: [{ SeriesInstanceUID: scan.series }],
          },
        ],
      },
    ],
    StructureSetROISequence: rois.map((r, i) => ({
      ROINumber: i + 1,
      ReferencedFrameOfReferenceUID: s('x00200052'),
      ROIName: r.name,
      ROIGenerationAlgorithm: 'MANUAL',
    })),
    ROIContourSequence: rois.map((r, i) => ({ ReferencedROINumber: i + 1, ROIDisplayColor: [255, 0, 255], ContourSequence: r.contours })),
    RTROIObservationsSequence: rois.map((r, i) => ({ ObservationNumber: i + 1, ReferencedROINumber: i + 1, RTROIInterpretedType: 'ORGAN', ROIInterpreter: '' })),
  };
  ds._meta = {};
  const dict = dcmjs.data.datasetToDict(ds);
  const out = path.join(OUT, `${scan.series}.dcm`);
  fs.writeFileSync(out, Buffer.from(dict.write()));
  console.log(`${scan.patient}: ${rois.length} reader outlines → ${path.relative(process.cwd(), out)}`);
}
