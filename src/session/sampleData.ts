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

const PARALLEL_DOWNLOADS = 6;
const ATTEMPTS = 4;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One file, retried on network errors and on 408/429/5xx (a slow or busy connection drops a few of ~500 requests;
 * one dropped request must not fail the whole sample).
 */
async function fetchWithRetry(url: string, label: string, signal?: AbortSignal): Promise<Blob> {
  let lastError = '';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { signal });
      if (response.ok) return await response.blob();
      lastError = `HTTP ${response.status}`;
      if (!(response.status === 408 || response.status === 429 || response.status >= 500)) break;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < ATTEMPTS) await wait(400 * 2 ** (attempt - 1));
  }
  throw new Error(
    `${label} could not be downloaded after ${ATTEMPTS} tries (${lastError}). Check the internet connection, or a browser extension that blocks downloads, and click Load sample CT again.`,
  );
}

export const SAMPLE_BASE_URL: string = (import.meta.env.VITE_SAMPLE_BASE_URL as string | undefined) ?? `${import.meta.env.BASE_URL}sample`;

function join(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function sampleUrl(path: string): string {
  return join(SAMPLE_BASE_URL, path);
}

/** Downloads one extra sample file (AI result, expert outline) as a File. */
export async function fetchSampleFile(path: string, signal?: AbortSignal): Promise<File> {
  const blob = await fetchWithRetry(sampleUrl(path), path, signal);
  return new File([blob], path.split('/').pop() ?? path, { type: 'application/dicom' });
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
      const blob = await fetchWithRetry(join(SAMPLE_BASE_URL, path), `Sample file ${path}`, signal);
      const name = path.split('/').pop() ?? path;
      out[index] = { file: new File([blob], name, { type: 'application/dicom' }), relativePath: `sample/${path}` };
      onProgress(++done, manifest.files.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALLEL_DOWNLOADS, manifest.files.length) }, worker));
  return out;
}
