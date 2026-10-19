import type { LocalFile } from '../dicom/parseHeader';

/**
 * File System Access API helpers (Chrome/Edge). A directory handle can be
 * stored in IndexedDB, so after a page reload the researcher re-opens the same
 * CT folder with one click instead of navigating the file dialog again.
 * Files are still only read locally by this page.
 *
 * The API is not in TypeScript's DOM typings yet, so the few members we use are
 * declared here and accessed through feature detection.
 */

type PermissionState = 'granted' | 'denied' | 'prompt';

interface HandleBase {
  kind: 'file' | 'directory';
  name: string;
}

export interface DirHandle extends HandleBase {
  kind: 'directory';
  values(): AsyncIterable<FileHandle | DirHandle>;
  queryPermission?(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' }): Promise<PermissionState>;
}

interface FileHandle extends HandleBase {
  kind: 'file';
  getFile(): Promise<File>;
}

interface PickerWindow {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' }) => Promise<DirHandle>;
}

interface HandleItem {
  getAsFileSystemHandle?: () => Promise<HandleBase | null>;
}

export function supportsDirectoryHandles(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

/** Opens the native folder picker. Resolves undefined if the user cancels. */
export async function pickDirectory(): Promise<DirHandle | undefined> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) return undefined;
  try {
    return await picker.call(window, { id: 'nrc-ct-folder', mode: 'read' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return undefined;
    throw error;
  }
}

/**
 * Starts resolving a dropped folder to a directory handle. Must be called
 * synchronously inside the drop event handler (the DataTransfer is cleared
 * afterwards). Resolves undefined when unsupported or not a single folder.
 */
export function directoryHandleFromDrop(dt: DataTransfer): Promise<DirHandle | undefined> {
  const items = Array.from(dt.items).filter((item) => item.kind === 'file');
  const first = items[0] as (DataTransferItem & HandleItem) | undefined;
  if (items.length !== 1 || !first?.getAsFileSystemHandle) return Promise.resolve(undefined);
  return first
    .getAsFileSystemHandle()
    .then((handle) => (handle?.kind === 'directory' ? (handle as DirHandle) : undefined))
    .catch(() => undefined);
}

/** Ensures read permission. Call from a click handler (user gesture). */
export async function ensureReadPermission(handle: DirHandle): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) return true;
  if ((await handle.queryPermission({ mode: 'read' })) === 'granted') return true;
  return (await handle.requestPermission({ mode: 'read' })) === 'granted';
}

/** Recursively lists all files under a directory handle. */
export async function filesFromDirectory(handle: DirHandle, prefix = handle.name): Promise<LocalFile[]> {
  const out: LocalFile[] = [];
  for await (const entry of handle.values()) {
    const path = `${prefix}/${entry.name}`;
    if (entry.kind === 'file') {
      out.push({ file: await entry.getFile(), relativePath: path });
    } else {
      out.push(...(await filesFromDirectory(entry, path)));
    }
  }
  return out;
}
