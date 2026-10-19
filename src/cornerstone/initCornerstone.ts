import { init as coreInit } from '@cornerstonejs/core';
import {
  addTool,
  init as toolsInit,
  PanTool,
  StackScrollTool,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';
import { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader';

/**
 * One-time initialisation of Cornerstone3D core, tools and the DICOM image
 * loader. Safe to call repeatedly (React StrictMode mounts effects twice):
 * the work runs once and every caller awaits the same promise.
 */
let initPromise: Promise<void> | undefined;

async function doInit(): Promise<void> {
  await coreInit();

  // Registers the wadouri/wadors image loaders (including the `dicomfile:`
  // scheme used for local files) and the DICOM metadata provider. Decoding
  // runs in web workers.
  const workers = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8) - 1);
  dicomImageLoaderInit({ maxWebWorkers: workers });

  toolsInit();
  // Tools are registered globally once; tool groups opt into them per viewport.
  for (const Tool of [StackScrollTool, PanTool, ZoomTool, WindowLevelTool]) {
    addTool(Tool);
  }
}

export function initCornerstone(): Promise<void> {
  initPromise ??= doInit().catch((error: unknown) => {
    initPromise = undefined; // allow a retry after a failure
    throw error;
  });
  return initPromise;
}
