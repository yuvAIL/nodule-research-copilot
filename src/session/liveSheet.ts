import { idbGet, idbSet } from './idb';

/**
 * "The spreadsheet fills itself in the background": the researcher links one CSV file on
 * their computer once; every approval rewrites it with all approved rows of all scans measured
 * in this browser. File System Access API (Chrome/Edge); the file never leaves the computer.
 * The API is not in TypeScript's DOM typings yet, so the members we use are declared here.
 */
type PermissionState = 'granted' | 'denied' | 'prompt';

export interface SheetHandle {
  kind: 'file';
  name: string;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

interface SaveWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    id?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<SheetHandle>;
}

const KEY = 'live-sheet';

export function supportsLiveSheet(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as SaveWindow).showSaveFilePicker === 'function';
}

/** Asks for the sheet file (user gesture). */
export async function pickSheet(): Promise<SheetHandle | undefined> {
  const picker = (window as unknown as SaveWindow).showSaveFilePicker;
  if (!picker) return undefined;
  try {
    const handle = await picker({
      suggestedName: 'nodule-measurements.csv',
      id: 'nodule-sheet',
      types: [{ description: 'CSV (opens in Excel)', accept: { 'text/csv': ['.csv'] } }],
    });
    await idbSet(KEY, handle);
    return handle;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return undefined;
    throw e;
  }
}

export async function loadSheet(): Promise<SheetHandle | undefined> {
  return idbGet<SheetHandle>(KEY);
}

export async function sheetPermission(handle: SheetHandle): Promise<PermissionState> {
  return (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
}

/** Needs a user gesture (click). */
export async function requestSheetPermission(handle: SheetHandle): Promise<boolean> {
  return ((await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'granted') === 'granted';
}

/** Rewrites the whole sheet. Returns false when write permission is missing (e.g. after a reload). */
export async function writeSheet(handle: SheetHandle, text: string): Promise<boolean> {
  if ((await sheetPermission(handle)) !== 'granted') return false;
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
  return true;
}
