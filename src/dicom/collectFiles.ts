import type { LocalFile } from './parseHeader';
import type { SkippedFile } from './types';

/**
 * Collects files from a file input or a drag-and-drop, including whole folder
 * trees. Nothing is uploaded: File objects stay in the browser.
 */

const NON_DICOM_EXTENSIONS = new Set([
  'txt', 'xml', 'json', 'csv', 'pdf', 'html', 'htm', 'jpg', 'jpeg', 'png', 'gif', 'bmp',
  'ini', 'log', 'md', 'exe', 'dll', 'nii', 'gz', 'zip', 'rar', '7z', 'mhd', 'raw', 'nrrd',
]);

export function preFilter(files: LocalFile[]): { candidates: LocalFile[]; skipped: SkippedFile[] } {
  const candidates: LocalFile[] = [];
  const skipped: SkippedFile[] = [];
  for (const item of files) {
    const name = item.file.name;
    if (name.startsWith('.') || name.toUpperCase() === 'DICOMDIR') continue; // hidden files, DICOMDIR index
    const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined;
    if (ext && NON_DICOM_EXTENSIONS.has(ext)) {
      const hint = ext === 'zip' || ext === '7z' || ext === 'rar' ? ' Extract the archive first.' : '';
      const nifti = ext === 'nii' || ext === 'gz' ? ' NIfTI is not supported in milestone 1.' : '';
      skipped.push({ relativePath: item.relativePath, reason: `Ignored by extension (.${ext}).${hint}${nifti}` });
      continue;
    }
    candidates.push(item);
  }
  return { candidates, skipped };
}

export function fromFileList(list: FileList | null): LocalFile[] {
  if (!list) return [];
  return Array.from(list, (file) => ({ file, relativePath: file.webkitRelativePath || file.name }));
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  // readEntries returns results in batches (100 in Chrome); call until empty.
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          readBatch();
        }
      }, reject);
    readBatch();
  });
}

async function walkEntry(entry: FileSystemEntry, out: LocalFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, relativePath: entry.fullPath.replace(/^\//, '') });
  } else if (entry.isDirectory) {
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const child of children) await walkEntry(child, out);
  }
}

export async function fromDataTransfer(dt: DataTransfer): Promise<LocalFile[]> {
  const entries = Array.from(dt.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);

  if (entries.length === 0) return fromFileList(dt.files);

  const out: LocalFile[] = [];
  for (const entry of entries) await walkEntry(entry, out);
  return out;
}
