import type { DicomHeader } from './types';

/**
 * Minimal read-only view of a parsed DICOM data set. Implemented on top of
 * dicom-parser in parseHeader.ts and by plain objects in unit tests.
 */
export interface HeaderSource {
  has(tag: string): boolean;
  string(tag: string): string | undefined;
  /** Numeric value of a DS/IS element, optionally at a multi-value index. */
  number(tag: string, index?: number): number | undefined;
  uint16(tag: string): number | undefined;
}

// DICOM tags in dicom-parser notation (xGGGGEEEE).
export const TAGS = {
  transferSyntaxUid: 'x00020010',
  imageType: 'x00080008',
  sopInstanceUid: 'x00080018',
  patientId: 'x00100020',
  studyDate: 'x00080020',
  modality: 'x00080060',
  manufacturer: 'x00080070',
  studyDescription: 'x00081030',
  seriesDescription: 'x0008103e',
  manufacturerModelName: 'x00081090',
  contrastBolusAgent: 'x00180010',
  sliceThickness: 'x00180050',
  kvp: 'x00180060',
  convolutionKernel: 'x00181210',
  studyInstanceUid: 'x0020000d',
  seriesInstanceUid: 'x0020000e',
  seriesNumber: 'x00200011',
  instanceNumber: 'x00200013',
  imagePositionPatient: 'x00200032',
  imageOrientationPatient: 'x00200037',
  sliceLocation: 'x00201041',
  numberOfFrames: 'x00280008',
  rows: 'x00280010',
  columns: 'x00280011',
  pixelSpacing: 'x00280030',
  rescaleIntercept: 'x00281052',
  rescaleSlope: 'x00281053',
  pixelData: 'x7fe00010',
} as const;

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\0/g, '').trim();
  return trimmed ? trimmed : undefined;
}

function finite(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function numbers(src: HeaderSource, tag: string, count: number): number[] | undefined {
  if (!src.has(tag)) return undefined;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = finite(src.number(tag, i));
    if (v === undefined) return undefined;
    out.push(v);
  }
  return out;
}

export function headerFromSource(src: HeaderSource, file: File, relativePath: string): DicomHeader {
  const ipp = numbers(src, TAGS.imagePositionPatient, 3);
  const iop = numbers(src, TAGS.imageOrientationPatient, 6);
  const ps = numbers(src, TAGS.pixelSpacing, 2);

  return {
    file,
    relativePath,
    sopInstanceUid: clean(src.string(TAGS.sopInstanceUid)) ?? '',
    seriesInstanceUid: clean(src.string(TAGS.seriesInstanceUid)) ?? '',
    studyInstanceUid: clean(src.string(TAGS.studyInstanceUid)) ?? '',
    modality: clean(src.string(TAGS.modality)) ?? '',
    patientId: clean(src.string(TAGS.patientId)),
    transferSyntaxUid: clean(src.string(TAGS.transferSyntaxUid)),
    instanceNumber: finite(src.number(TAGS.instanceNumber)),
    imagePositionPatient: ipp as DicomHeader['imagePositionPatient'],
    imageOrientationPatient: iop as DicomHeader['imageOrientationPatient'],
    sliceLocation: finite(src.number(TAGS.sliceLocation)),
    rows: src.uint16(TAGS.rows),
    columns: src.uint16(TAGS.columns),
    pixelSpacing: ps as DicomHeader['pixelSpacing'],
    sliceThickness: finite(src.number(TAGS.sliceThickness)),
    numberOfFrames: finite(src.number(TAGS.numberOfFrames)) ?? 1,
    hasPixelData: src.has(TAGS.pixelData),
    seriesNumber: finite(src.number(TAGS.seriesNumber)),
    seriesDescription: clean(src.string(TAGS.seriesDescription)),
    studyDescription: clean(src.string(TAGS.studyDescription)),
    studyDate: clean(src.string(TAGS.studyDate)),
    manufacturer: clean(src.string(TAGS.manufacturer)),
    manufacturerModelName: clean(src.string(TAGS.manufacturerModelName)),
    kvp: finite(src.number(TAGS.kvp)),
    convolutionKernel: clean(src.string(TAGS.convolutionKernel)),
    contrastBolusAgent: clean(src.string(TAGS.contrastBolusAgent)),
    imageType: clean(src.string(TAGS.imageType)),
    rescaleSlope: finite(src.number(TAGS.rescaleSlope)),
    rescaleIntercept: finite(src.number(TAGS.rescaleIntercept)),
  };
}

/** YYYYMMDD -> YYYY-MM-DD (unchanged if not in that form). */
export function formatDicomDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : value;
}

/** Human-readable name of common transfer syntaxes. */
export function describeTransferSyntax(uid: string | undefined): string | undefined {
  if (!uid) return undefined;
  const names: Record<string, string> = {
    '1.2.840.10008.1.2': 'Implicit VR Little Endian',
    '1.2.840.10008.1.2.1': 'Explicit VR Little Endian',
    '1.2.840.10008.1.2.2': 'Explicit VR Big Endian (retired)',
    '1.2.840.10008.1.2.1.99': 'Deflated Explicit VR Little Endian',
    '1.2.840.10008.1.2.4.50': 'JPEG Baseline',
    '1.2.840.10008.1.2.4.51': 'JPEG Extended',
    '1.2.840.10008.1.2.4.57': 'JPEG Lossless',
    '1.2.840.10008.1.2.4.70': 'JPEG Lossless SV1',
    '1.2.840.10008.1.2.4.80': 'JPEG-LS Lossless',
    '1.2.840.10008.1.2.4.81': 'JPEG-LS Near-lossless',
    '1.2.840.10008.1.2.4.90': 'JPEG 2000 Lossless',
    '1.2.840.10008.1.2.4.91': 'JPEG 2000',
    '1.2.840.10008.1.2.4.201': 'HTJ2K Lossless',
    '1.2.840.10008.1.2.4.202': 'HTJ2K Lossless RPCL',
    '1.2.840.10008.1.2.4.203': 'HTJ2K',
    '1.2.840.10008.1.2.5': 'RLE Lossless',
  };
  return names[uid] ? `${names[uid]} (${uid})` : uid;
}
