import { imageLoader } from '@cornerstonejs/core';
import type { CtSeries } from '../dicom/types';
import type { Vec3, Volume } from '../measure/volume';

/**
 * Builds a 3D Hounsfield-unit volume from the series' decoded slices, using
 * Cornerstone's DICOM image loader (so every supported transfer syntax works).
 * Needed for click segmentation and measurements; the 2D viewer doesn't need it.
 */

const PARALLEL = 6;

export class VolumeBuildError extends Error {}

export async function buildVolume(
  series: CtSeries,
  imageIds: string[],
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Volume> {
  const first = series.instances[0];
  if (!first?.rows || !first.columns || !first.pixelSpacing || !first.imageOrientationPatient) {
    throw new VolumeBuildError('This series lacks the geometry (pixel spacing / orientation) needed for measurements.');
  }
  if (series.instances.some((h) => !h.imagePositionPatient)) {
    throw new VolumeBuildError('Some slices have no ImagePositionPatient, so 3D measurements are not possible.');
  }
  const sliceSpacing = series.sliceSpacingMm ?? first.sliceThickness;
  if (!sliceSpacing || !(sliceSpacing > 0)) {
    throw new VolumeBuildError('Slice spacing could not be determined, so volumes cannot be computed.');
  }
  const cols = first.columns;
  const rows = first.rows;
  const slices = imageIds.length;
  const sliceSize = cols * rows;
  const hu = new Int16Array(sliceSize * slices);

  let next = 0;
  let done = 0;
  async function worker(): Promise<void> {
    while (next < slices) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const k = next++;
      const image = await imageLoader.loadAndCacheImage(imageIds[k] as string);
      if (image.columns !== cols || image.rows !== rows) {
        throw new VolumeBuildError(`Slice ${k + 1} has a different matrix size.`);
      }
      const pixels = image.getPixelData();
      // The loader usually applies Rescale Slope/Intercept already ("pre-scaling").
      const scaled = image.preScale?.scaled === true;
      const slope = scaled ? 1 : (image.slope ?? 1);
      const intercept = scaled ? 0 : (image.intercept ?? 0);
      const offset = k * sliceSize;
      for (let p = 0; p < sliceSize; p++) {
        const v = Math.round((pixels[p] as number) * slope + intercept);
        hu[offset + p] = v < -32768 ? -32768 : v > 32767 ? 32767 : v;
      }
      onProgress(++done, slices);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, slices) }, worker));

  const iop = first.imageOrientationPatient;
  return {
    cols,
    rows,
    slices,
    colSpacing: first.pixelSpacing[1],
    rowSpacing: first.pixelSpacing[0],
    sliceSpacing,
    origins: series.instances.map((h) => h.imagePositionPatient as Vec3),
    rowCosines: [iop[0], iop[1], iop[2]],
    colCosines: [iop[3], iop[4], iop[5]],
    hu,
  };
}
