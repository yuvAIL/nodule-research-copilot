/**
 * Framework-independent description of one DICOM instance, extracted from its
 * header. Scan-related attributes only; patient name, birth date etc. are
 * deliberately never read. PatientID is read because it is the key of the
 * lab's research spreadsheet (public data here is already de-identified).
 */
export interface DicomHeader {
  /** The local File the header came from. Kept so it can be handed to the image loader. */
  file: File;
  /** Path inside the selected folder (or just the file name). For error messages only. */
  relativePath: string;

  sopInstanceUid: string;
  seriesInstanceUid: string;
  studyInstanceUid: string;
  modality: string;
  /** (0010,0020) — research spreadsheet key. */
  patientId?: string;
  transferSyntaxUid?: string;

  instanceNumber?: number;
  /** ImagePositionPatient (0020,0032), mm, patient LPS coordinates. */
  imagePositionPatient?: [number, number, number];
  /** ImageOrientationPatient (0020,0037): row direction cosines then column direction cosines. */
  imageOrientationPatient?: [number, number, number, number, number, number];
  sliceLocation?: number;

  rows?: number;
  columns?: number;
  /** PixelSpacing (0028,0030): [row spacing, column spacing] in mm. */
  pixelSpacing?: [number, number];
  sliceThickness?: number;
  numberOfFrames: number;
  hasPixelData: boolean;

  seriesNumber?: number;
  seriesDescription?: string;
  studyDescription?: string;
  studyDate?: string;
  manufacturer?: string;
  manufacturerModelName?: string;
  kvp?: number;
  convolutionKernel?: string;
  contrastBolusAgent?: string;
  imageType?: string;
  rescaleSlope?: number;
  rescaleIntercept?: number;
}

/** A sorted, validated series ready to be displayed. */
export interface CtSeries {
  seriesInstanceUid: string;
  /** Instances sorted from the first displayed slice to the last. */
  instances: DicomHeader[];
  /** Short human label for pickers ("#3 Lung 1.0 B70f — 312 slices"). */
  label: string;
  /** How the slices were ordered. */
  sortMethod: 'image-position' | 'instance-number' | 'file-order';
  /** Median distance between adjacent slice centres along the slice normal (mm), if computable. */
  sliceSpacingMm?: number;
  /** Non-fatal issues a researcher should know about (gaps, mixed sizes, non-CT, ...). */
  warnings: string[];
}

export interface SkippedFile {
  relativePath: string;
  reason: string;
}
