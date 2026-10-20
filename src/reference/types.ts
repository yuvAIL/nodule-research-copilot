import type { Vec3 } from '../measure/volume';

/**
 * An expert outline read from a DICOM file (read-only). Coordinates are DICOM
 * patient coordinates (LPS, mm), so the outline can be placed on the CT series
 * it was drawn on, independent of how that series is ordered on screen.
 */
export interface ReferenceSegment {
  /** SegmentNumber (SEG) or ROINumber (RTSTRUCT). */
  number: number;
  name: string;
  /** SegmentAlgorithmType (SEG) or ROI generation algorithm (RTSTRUCT): MANUAL / SEMIAUTOMATIC / AUTOMATIC. */
  algorithmType?: string;
}

/** Binary frames of a DICOM SEG (one frame = one segment on one image plane). */
export interface SegFrame {
  segmentNumber: number;
  /** ImagePositionPatient of the frame's top-left pixel. */
  position: Vec3;
  /** rows * cols, 1 = inside. */
  mask: Uint8Array;
}

/** One closed planar contour of an RTSTRUCT ROI. */
export interface Contour {
  roiNumber: number;
  points: Vec3[];
}

interface ReferenceBase {
  sopInstanceUid: string;
  /** Series the outline was drawn on (from the referenced-series sequence). */
  referencedSeriesUid?: string;
  frameOfReferenceUid?: string;
  seriesDescription?: string;
  /** Who/what made it, as written in the file (manufacturer, software, creator). */
  creator?: string;
  manufacturer?: string;
  modelName?: string;
  softwareVersion?: string;
  /** ContentDate (or SeriesDate) of the file, YYYY-MM-DD. */
  contentDate?: string;
  segments: ReferenceSegment[];
}

export interface SegReference extends ReferenceBase {
  kind: 'SEG';
  rows: number;
  cols: number;
  rowCosines: Vec3;
  colCosines: Vec3;
  /** [row spacing, column spacing] in mm (DICOM PixelSpacing order). */
  pixelSpacing: [number, number];
  frames: SegFrame[];
}

export interface RtStructReference extends ReferenceBase {
  kind: 'RTSTRUCT';
  contours: Contour[];
}

export type ReferenceObject = SegReference | RtStructReference;
