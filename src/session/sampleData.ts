import type { LocalFile } from '../dicom/parseHeader';

/**
 * "Load sample CT": downloads a public, de-identified research CT series
 * (TCIA RIDER Lung CT) from a static host and feeds it into the same local
 * pipeline as a researcher's own folder. Only public data is fetched; nothing
 * is uploaded.
 *
 * Expected layout at SAMPLE_BASE_URL (created by `npm run prepare:sample`):
 *   manifest.json   { title, attribution, files: ["t1/0001.dcm", ...] }
 *   t1/…, t2/…      DICOM files
 *
 * The sample files are never committed to git (see .gitignore). In development
 * they live in public/sample/; in a deployment set VITE_SAMPLE_BASE_URL.
 */

export interface SampleManifest {
  title: string;
  attribution: string;
  files: string[];
  /** Optional AI results (DICOM SEG, computed offline), each imported on the scan it was computed on. */
  ai?: string | string[];
  /** Optional expert outlines (DICOM SEG/RTSTRUCT), shown on the scan they were drawn on. */
  reference?: string | string[];
}

const PARALLEL_DOWNLOADS = 8;

export const SAMPLE_BASE_URL: string = (import.meta.env.VITE_SAMPLE_BASE_URL as string | undefined) ?? `${import.meta.env.BASE_URL}sample`;

function join(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function sampleUrl(path: string): string {
  return join(SAMPLE_BASE_URL, path);
}

/** Downloads one extra sample file (AI result, expert outline) as a File. */
export async function fetchSampleFile(path: string, signal?: AbortSignal): Promise<File> {
  const response = await fetch(sampleUrl(path), { signal });
  if (!response.ok) throw new Error(`${path} could not be downloaded (HTTP ${response.status}).`);
  return new File([await response.blob()], path.split('/').pop() ?? path, { type: 'application/dicom' });
}

export async function fetchSampleManifest(signal?: AbortSignal): Promise<SampleManifest | undefined> {
  try {
    const response = await fetch(join(SAMPLE_BASE_URL, 'manifest.json'), { signal, cache: 'no-cache' });
    if (!response.ok) return undefined;
    const manifest = (await response.json()) as SampleManifest;
    return Array.isArray(manifest.files) && manifest.files.length > 0 ? manifest : undefined;
  } catch {
    return undefined;
  }
}

export async function downloadSample(
  manifest: SampleManifest,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<LocalFile[]> {
  const out: LocalFile[] = new Array(manifest.files.length);
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (next < manifest.files.length) {
      const index = next++;
      const path = manifest.files[index] as string;
      const response = await fetch(join(SAMPLE_BASE_URL, path), { signal });
      if (!response.ok) throw new Error(`Sample file ${path} could not be downloaded (HTTP ${response.status}).`);
      const blob = await response.blob();
      const name = path.split('/').pop() ?? path;
      out[index] = { file: new File([blob], name, { type: 'application/dicom' }), relativePath: `sample/${path}` };
      onProgress(++done, manifest.files.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALLEL_DOWNLOADS, manifest.files.length) }, worker));
  return out;
}
