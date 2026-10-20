import * as dicomParser from 'dicom-parser';
import type { Vec3 } from '../measure/volume';
import type { Contour, ReferenceObject, ReferenceSegment, SegFrame } from './types';

/**
 * Reads an expert outline (DICOM SEG or RTSTRUCT) from a local file, in the
 * browser. Only uncompressed binary/fractional SEG and CLOSED_PLANAR contours
 * are supported; anything else is rejected with a readable reason.
 */

const SOP_SEG = '1.2.840.10008.5.1.4.1.1.66.4';
const SOP_RTSTRUCT = '1.2.840.10008.5.1.4.1.1.481.3';
const ENCAPSULATED_SYNTAXES_PREFIX = ['1.2.840.10008.1.2.4.', '1.2.840.10008.1.2.5'];

export class ReferenceParseError extends Error {}

type DS = dicomParser.DataSet;

function str(ds: DS | undefined, tag: string): string | undefined {
  const v = ds?.string(tag)?.trim();
  return v ? v : undefined;
}

function items(ds: DS | undefined, tag: string): DS[] {
  const el = ds?.elements[tag];
  return (el?.items ?? []).map((it) => it.dataSet).filter((d): d is DS => d !== undefined);
}

function first(ds: DS | undefined, ...path: string[]): DS | undefined {
  let cur = ds;
  for (const tag of path) cur = items(cur, tag)[0];
  return cur;
}

function numbers(ds: DS | undefined, tag: string): number[] {
  const raw = ds?.string(tag);
  if (!raw) return [];
  return raw.split('\\').map((s) => Number.parseFloat(s));
}

function vec3(values: number[], what: string): Vec3 {
  if (values.length < 3 || values.slice(0, 3).some((v) => !Number.isFinite(v))) {
    throw new ReferenceParseError(`Missing or invalid ${what}.`);
  }
  return [values[0] as number, values[1] as number, values[2] as number];
}

function creatorOf(ds: DS): string | undefined {
  const parts = [str(ds, 'x00080070'), str(ds, 'x00081090'), str(ds, 'x00181020'), str(ds, 'x30060004')].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

export function parseReference(bytes: Uint8Array): ReferenceObject {
  let ds: DS;
  try {
    ds = dicomParser.parseDicom(bytes);
  } catch (e) {
    throw new ReferenceParseError(`Not a readable DICOM file (${e instanceof Error ? e.message : String(e)}).`);
  }
  const sopClass = str(ds, 'x00080016');
  const modality = str(ds, 'x00080060');
  if (sopClass === SOP_SEG || modality === 'SEG') return parseSeg(ds, bytes);
  if (sopClass === SOP_RTSTRUCT || modality === 'RTSTRUCT') return parseRtStruct(ds);
  throw new ReferenceParseError(`This file is ${modality ?? 'not a segmentation'} — expected a DICOM SEG or RTSTRUCT.`);
}

function parseSeg(ds: DS, bytes: Uint8Array): ReferenceObject {
  const syntax = str(ds, 'x00020010') ?? '';
  if (ENCAPSULATED_SYNTAXES_PREFIX.some((p) => syntax.startsWith(p))) {
    throw new ReferenceParseError(`Compressed SEG (transfer syntax ${syntax}) is not supported.`);
  }
  const rows = ds.uint16('x00280010') ?? 0;
  const cols = ds.uint16('x00280011') ?? 0;
  const bits = ds.uint16('x00280100') ?? 1;
  const nFrames = Number.parseInt(str(ds, 'x00280008') ?? '1', 10);
  const type = str(ds, 'x00620001') ?? 'BINARY';
  const maxFractional = ds.uint16('x00620014') ?? 255;
  if (!rows || !cols || !nFrames) throw new ReferenceParseError('SEG has no image size or frames.');
  if (!(bits === 1 || bits === 8)) throw new ReferenceParseError(`SEG with ${bits}-bit pixels is not supported.`);

  const segments: ReferenceSegment[] = items(ds, 'x00620002').map((it) => ({
    number: it.uint16('x00620004') ?? 0,
    name: str(it, 'x00620005') ?? `Segment ${it.uint16('x00620004') ?? '?'}`,
  }));

  const shared = first(ds, 'x52009229');
  const perFrame = items(ds, 'x52009230');
  if (perFrame.length !== nFrames) throw new ReferenceParseError('SEG per-frame information does not match the frame count.');

  const orientationDs = first(shared, 'x00209116') ?? first(perFrame[0], 'x00209116');
  const iop = numbers(orientationDs, 'x00200037');
  if (iop.length < 6) throw new ReferenceParseError('SEG has no image orientation.');
  const spacingDs = first(shared, 'x00289110') ?? first(perFrame[0], 'x00289110');
  const ps = numbers(spacingDs, 'x00280030');
  if (ps.length < 2) throw new ReferenceParseError('SEG has no pixel spacing.');

  const pixel = ds.elements.x7fe00010;
  if (!pixel) throw new ReferenceParseError('SEG has no pixel data.');
  if (pixel.encapsulatedPixelData) throw new ReferenceParseError('Compressed SEG pixel data is not supported.');
  const data = bytes.subarray(pixel.dataOffset, pixel.dataOffset + pixel.length);
  const frameSize = rows * cols;
  const needed = bits === 1 ? Math.ceil((frameSize * nFrames) / 8) : frameSize * nFrames;
  if (data.length < needed) throw new ReferenceParseError('SEG pixel data is shorter than expected.');

  const frames: SegFrame[] = perFrame.map((fg, f) => {
    const segmentNumber = first(fg, 'x0062000a')?.uint16('x0062000b') ?? segments[0]?.number ?? 1;
    const position = vec3(numbers(first(fg, 'x00209113'), 'x00200032'), `position of frame ${f + 1}`);
    const mask = new Uint8Array(frameSize);
    if (bits === 1) {
      // Binary frames are bit-packed back to back (no padding between frames), LSB first.
      const base = f * frameSize;
      for (let p = 0; p < frameSize; p++) {
        const b = base + p;
        mask[p] = ((data[b >> 3] as number) >> (b & 7)) & 1;
      }
    } else {
      const off = f * frameSize;
      const cut = type === 'FRACTIONAL' ? maxFractional / 2 : 0;
      for (let p = 0; p < frameSize; p++) mask[p] = (data[off + p] as number) > cut ? 1 : 0;
    }
    return { segmentNumber, position, mask };
  });

  return {
    kind: 'SEG',
    sopInstanceUid: str(ds, 'x00080018') ?? '',
    referencedSeriesUid: str(first(ds, 'x00081115'), 'x0020000e'),
    frameOfReferenceUid: str(ds, 'x00200052'),
    seriesDescription: str(ds, 'x0008103e'),
    creator: creatorOf(ds),
    segments,
    rows,
    cols,
    rowCosines: vec3(iop.slice(0, 3), 'image orientation'),
    colCosines: vec3(iop.slice(3, 6), 'image orientation'),
    pixelSpacing: [ps[0] as number, ps[1] as number],
    frames,
  };
}

function parseRtStruct(ds: DS): ReferenceObject {
  const segments: ReferenceSegment[] = items(ds, 'x30060020').map((it) => ({
    number: Number.parseInt(str(it, 'x30060022') ?? '0', 10),
    name: str(it, 'x30060026') ?? `ROI ${str(it, 'x30060022') ?? '?'}`,
  }));
  const contours: Contour[] = [];
  let skipped = 0;
  for (const roi of items(ds, 'x30060039')) {
    const roiNumber = Number.parseInt(str(roi, 'x30060084') ?? '0', 10);
    for (const c of items(roi, 'x30060040')) {
      const type = str(c, 'x30060042');
      const xyz = numbers(c, 'x30060050');
      if ((type && type !== 'CLOSED_PLANAR') || xyz.length < 9) {
        skipped++;
        continue;
      }
      const points: Vec3[] = [];
      for (let n = 0; n + 2 < xyz.length; n += 3) points.push([xyz[n] as number, xyz[n + 1] as number, xyz[n + 2] as number]);
      contours.push({ roiNumber, points });
    }
  }
  if (contours.length === 0) {
    throw new ReferenceParseError(`RTSTRUCT has no closed planar contours${skipped ? ` (${skipped} other contours skipped)` : ''}.`);
  }
  const series = first(ds, 'x30060010', 'x30060012', 'x30060014');
  return {
    kind: 'RTSTRUCT',
    sopInstanceUid: str(ds, 'x00080018') ?? '',
    referencedSeriesUid: str(series, 'x0020000e'),
    frameOfReferenceUid: str(first(ds, 'x30060010'), 'x00200052'),
    seriesDescription: str(ds, 'x0008103e') ?? str(ds, 'x30060002'),
    creator: creatorOf(ds),
    segments,
    contours,
  };
}
