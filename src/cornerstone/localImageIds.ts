import { cache } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { utilities as metadataUtilities } from '@cornerstonejs/metadata';
import type { CtSeries } from '../dicom/types';

/**
 * Registers the series' local File objects with the DICOM image loader's file
 * manager and returns Cornerstone imageIds (`dicomfile:<n>`) in display order.
 * The loader reads the files directly from the browser; nothing is uploaded.
 *
 * Since Cornerstone3D 5.x the loader parses each file into the metadata
 * package's NATURALIZED cache (header and pixel data). When switching series,
 * decoded images and that cache are released so memory does not accumulate.
 * The file manager itself is intentionally NOT purged: its indices restart at
 * 0 after a purge, and reusing an imageId such as `dicomfile:0` for a
 * different file could serve stale cached metadata. It only holds lightweight
 * File handles.
 */
export function registerSeriesFiles(series: CtSeries): string[] {
  cache.purgeCache();
  metadataUtilities.clearCacheData();
  return series.instances.map((instance) => wadouri.fileManager.add(instance.file));
}
