/**
 * Node-side DICOM helpers for the offline evaluation scripts (not used by the app).
 * Uncompressed CT only; the CT is ordered the same way as in the app (head end first).
 */
const fs = require('node:fs');
const path = require('node:path');
const dicomParser = require('dicom-parser');

const UNCOMPRESSED = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1']);

function seriesDirs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...seriesDirs(p));
  }
  if (fs.readdirSync(dir).some((f) => f.toLowerCase().endsWith('.dcm'))) out.push(dir);
  return out;
}
const dcmFiles = (d) => fs.readdirSync(d).filter((f) => f.toLowerCase().endsWith('.dcm')).map((f) => path.join(d, f));
const header = (file) => dicomParser.parseDicom(new Uint8Array(fs.readFileSync(file)), { untilTag: 'x7fe00010' });

function loadCt(dir) {
  const slices = dcmFiles(dir).map((f) => {
    const b = new Uint8Array(fs.readFileSync(f));
    const ds = dicomParser.parseDicom(b);
    return { b, ds, ipp: ds.string('x00200032').split('\\').map(Number) };
  });
  const ds0 = slices[0].ds;
  const ts = ds0.string('x00020010');
  if (!UNCOMPRESSED.has(ts)) throw new Error(`compressed CT (${ts}) not supported by this script`);
  const iop = ds0.string('x00200037').split('\\').map(Number);
  const r = iop.slice(0, 3);
  const c = iop.slice(3, 6);
  const n = [r[1] * c[2] - r[2] * c[1], r[2] * c[0] - r[0] * c[2], r[0] * c[1] - r[1] * c[0]];
  const along = (s) => s.ipp[0] * n[0] + s.ipp[1] * n[1] + s.ipp[2] * n[2];
  slices.sort((a, b) => along(b) - along(a)); // same order as the app: head end first
  const rows = ds0.uint16('x00280010');
  const cols = ds0.uint16('x00280011');
  const ps = ds0.string('x00280030').split('\\').map(Number);
  const gaps = slices.slice(1).map((s, k) => Math.abs(along(s) - along(slices[k]))).sort((a, b) => a - b);
  const hu = new Int16Array(rows * cols * slices.length);
  slices.forEach((s, k) => {
    const el = s.ds.elements.x7fe00010;
    const signed = s.ds.uint16('x00280103') === 1;
    const slope = s.ds.floatString('x00281053') ?? 1;
    const icpt = s.ds.floatString('x00281052') ?? 0;
    const dv = new DataView(s.b.buffer, s.b.byteOffset + el.dataOffset, el.length);
    for (let p = 0; p < rows * cols; p++) {
      const v = signed ? dv.getInt16(p * 2, true) : dv.getUint16(p * 2, true);
      hu[k * rows * cols + p] = Math.max(-32768, Math.min(32767, Math.round(v * slope + icpt)));
    }
  });
  return {
    cols, rows, slices: slices.length, colSpacing: ps[1], rowSpacing: ps[0],
    sliceSpacing: gaps[Math.floor(gaps.length / 2)], origins: slices.map((s) => s.ipp), rowCosines: r, colCosines: c, hu,
  };
}


module.exports = { seriesDirs, dcmFiles, header, loadCt };
