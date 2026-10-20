#!/usr/bin/env node
/**
 * Prepares the "Load sample CT" data from a local TCIA download.
 *
 *   npm run prepare:sample -- <series-folder> [<second-series-folder>] [--out public/sample] [--title "..."]
 *                             [--ai <AI result SEG for the first series>] [--reference <expert SEG/RTSTRUCT>]
 *
 * Each folder is one CT series (e.g. the test and retest scans of one RIDER
 * patient). DICOM Part 10 files are copied to <out>/t1/, <out>/t2/, ... and a
 * manifest.json is written. Only use public, de-identified data (RIDER Lung CT,
 * CC BY 4.0). The output folder is gitignored and must never be committed.
 */
import { copyFileSync, existsSync, mkdirSync, openSync, readSync, closeSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const out = resolve(flag('--out', 'public/sample'));
const title = flag('--title', 'RIDER Lung CT sample (public, de-identified)');
// Every preparation gets its own folder name: browsers cache /sample/* for a week, so a new
// sample must never reuse the URLs of an old one.
const tag = flag('--tag', `v${Date.now().toString(36)}`);
const aiFile = flag('--ai', undefined);
const referenceFile = flag('--reference', undefined);
const folders = args;

if (folders.length === 0) {
  console.error('Usage: npm run prepare:sample -- <series-folder> [<second-series-folder>] [--out public/sample]');
  process.exit(1);
}

function isDicomPart10(path) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(132);
    return readSync(fd, buf, 0, 132, 0) === 132 && buf.toString('latin1', 128, 132) === 'DICM';
  } finally {
    closeSync(fd);
  }
}

function listFiles(dir) {
  const result = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) result.push(...listFiles(path));
    else if (st.isFile()) result.push(path);
  }
  return result;
}

const manifestFiles = [];
folders.forEach((folder, i) => {
  const src = resolve(folder);
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    console.error(`Not a folder: ${src}`);
    process.exit(1);
  }
  const dicom = listFiles(src).filter(isDicomPart10);
  if (dicom.length === 0) {
    console.error(`No DICOM Part 10 files found in ${src}`);
    process.exit(1);
  }
  const sub = `${tag}/t${i + 1}`;
  mkdirSync(join(out, sub), { recursive: true });
  dicom.forEach((path, n) => {
    const name = `${String(n + 1).padStart(4, '0')}.dcm`;
    copyFileSync(path, join(out, sub, name));
    manifestFiles.push(`${sub}/${name}`);
  });
  console.log(`${sub}: ${dicom.length} DICOM files from ${src}`);
});

const extras = {};
for (const [key, file] of [['ai', aiFile], ['reference', referenceFile]]) {
  if (!file) continue;
  const src = resolve(file);
  if (!existsSync(src) || !isDicomPart10(src)) {
    console.error(`--${key}: not a DICOM file: ${src}`);
    process.exit(1);
  }
  mkdirSync(join(out, tag), { recursive: true });
  copyFileSync(src, join(out, tag, `${key}.dcm`));
  extras[key] = `${tag}/${key}.dcm`;
  console.log(`${key}: ${src}`);
}

writeFileSync(
  join(out, 'manifest.json'),
  JSON.stringify(
    {
      title,
      ...extras,
      attribution:
        'RIDER Lung CT, The Cancer Imaging Archive (TCIA), CC BY 4.0. https://www.cancerimagingarchive.net/collection/rider-lung-ct/',
      files: manifestFiles,
    },
    null,
    2,
  ),
);
console.log(`Wrote ${manifestFiles.length} files and manifest.json to ${out}`);
