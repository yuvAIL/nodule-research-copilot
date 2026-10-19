import type { DirHandle } from './folderAccess';
import { idbDelete, idbGet, idbSet } from './idb';

/**
 * Where the researcher was, so a reload (Cmd+R) or a closed tab does not lose
 * the scan: the source to re-open, the selected series and the slice.
 * Pixel data is never stored; it is re-read from the original files.
 */
export type SessionSource =
  | { kind: 'folder'; handle: DirHandle; name: string }
  | { kind: 'sample' }
  // Opened through a plain file input or drag-and-drop without folder handles:
  // can't be re-opened automatically; remembered only to explain that.
  | { kind: 'files'; name: string };

export interface LastSession {
  source: SessionSource;
  seriesInstanceUid?: string;
  seriesLabel?: string;
  sliceIndex?: number;
  savedAt: number;
}

const KEY = 'last-session';

export function loadLastSession(): Promise<LastSession | undefined> {
  return idbGet<LastSession>(KEY);
}

export function saveLastSession(session: LastSession): Promise<void> {
  return idbSet(KEY, session);
}

export function clearLastSession(): Promise<void> {
  return idbDelete(KEY);
}
