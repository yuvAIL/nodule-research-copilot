import * as dicomParser from 'dicom-parser';
import { headerFromSource, TAGS, type HeaderSource } from './headerMapping';
import type { DicomHeader, SkippedFile } from './types';

/**
 * Reads DICOM headers from local files, entirely in the browser. Only the
 * header is parsed (parsing stops at PixelData); pixel decoding is left to
 * Cornerstone's DICOM image loader.
 */

/** Most CT headers fit in a few KB; read this much first and fall back to the whole file. */
const HEADER_PROBE_BYTES = 512 * 1024;
const PARALLEL_READS = 8;

function sourceFromDataSet(ds: dicomParser.DataSet): HeaderSource {
  return {
    has: (tag) => ds.elements[tag] !== undefined,
    string: (tag) => ds.string(tag),
    number: (tag, index) => ds.floatString(tag, index),
    uint16: (tag) => ds.uint16(tag),
  };
}

function parse(bytes: Uint8Array): dicomParser.DataSet {
  return dicomParser.parseDicom(bytes, { untilTag: TAGS.pixelData });
}

async function readSlice(file: File, end?: number): Promise<Uint8Array> {
  const blob = end === undefined ? file : file.slice(0, end);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function parseDicomHeader(file: File, relativePath: string): Promise<DicomHeader> {
  let dataSet: dicomParser.DataSet;
  try {
    dataSet = parse(await readSlice(file, HEADER_PROBE_BYTES));
  } catch (probeError) {
    if (file.size <= HEADER_PROBE_BYTES) throw probeError;
    // Header larger than the probe (e.g. big private tags): parse the whole file.
    dataSet = parse(await readSlice(file));
  }
  return headerFromSource(sourceFromDataSet(dataSet), file, relativePath);
}

export interface LocalFile {
  file: File;
  relativePath: string;
}

export interface ParseProgress {
  done: number;
  total: number;
}

export async function parseDicomHeaders(
  files: LocalFile[],
  onProgress?: (p: ParseProgress) => void,
  signal?: AbortSignal,
): Promise<{ headers: DicomHeader[]; skipped: SkippedFile[] }> {
  const headers: DicomHeader[] = [];
  const skipped: SkippedFile[] = [];
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (next < files.length) {
      if (signal?.aborted) return;
      const item = files[next++] as LocalFile;
      try {
        headers.push(await parseDicomHeader(item.file, item.relativePath));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        skipped.push({
          relativePath: item.relativePath,
          reason: /DICM prefix/i.test(message) ? 'Not a DICOM Part 10 file (no "DICM" preamble).' : `Could not parse: ${message}`,
        });
      }
      done++;
      onProgress?.({ done, total: files.length });
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALLEL_READS, files.length) }, worker));
  return { headers, skipped };
}
