#!/usr/bin/env node
/**
 * Diagnostic: lists installed packages whose browser-facing code imports
 * Node.js built-in modules (events, fs, path, buffer, ...). Vite replaces
 * those built-ins with an empty stub in the browser, which causes errors like
 *   Module "events" has been externalized for browser compatibility.
 *
 * Usage:  npm run diagnose:builtins            (all built-ins)
 *         npm run diagnose:builtins -- events  (only "events")
 *
 * Read-only: it never modifies node_modules.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const BUILTINS = [
  'events', 'buffer', 'util', 'stream', 'path', 'fs', 'os', 'crypto',
  'zlib', 'url', 'assert', 'http', 'https', 'net', 'child_process', 'worker_threads',
];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : BUILTINS;
const root = join(process.cwd(), 'node_modules');
if (!existsSync(root)) {
  console.error('node_modules not found. Run this from the project folder after `npm install`.');
  process.exit(1);
}

const names = wanted.join('|');
// import ... from 'events' | import('events') | require('events') | export ... from 'events', with optional node: prefix
const pattern = new RegExp(
  String.raw`(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"](?:node:)?(${names})(?:/[^'"]*)?['"]`,
  'g',
);

/** Package name for a file path inside node_modules (handles @scope/name and nested node_modules). */
function packageOf(file) {
  const parts = relative(root, file).split(sep);
  const idx = parts.lastIndexOf('node_modules');
  const rest = idx >= 0 ? parts.slice(idx + 1) : parts;
  return rest[0]?.startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
}

const hits = new Map(); // package -> Map(builtin -> Set(file))
function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === '.bin' || name === '.vite' || name === 'test' || name === 'tests' || name === '__tests__') continue;
    const path = join(dir, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(path);
    else if (/\.(c|m)?js$/.test(name) && stat.size < 20_000_000) {
      const text = readFileSync(path, 'utf8');
      for (const m of text.matchAll(pattern)) {
        const pkg = packageOf(path);
        if (!hits.has(pkg)) hits.set(pkg, new Map());
        const byBuiltin = hits.get(pkg);
        if (!byBuiltin.has(m[1])) byBuiltin.set(m[1], new Set());
        byBuiltin.get(m[1]).add(relative(process.cwd(), path));
      }
    }
  }
}
walk(root);

// Build tooling legitimately uses Node built-ins and never runs in the browser.
const TOOLING = /^(vite|vitest|@vitest\/|esbuild|rollup|@rollup\/|typescript|eslint|@eslint|@typescript-eslint|typescript-eslint|@vitejs\/|@originjs\/|@babel\/|postcss|tsx|globals|picomatch|fdir|tinyglobby|chokidar|debug|semver|@types\/)/;

const relevant = [...hits].filter(([pkg]) => !TOOLING.test(pkg));
if (relevant.length === 0) {
  console.log(`No runtime package imports: ${wanted.join(', ')}`);
} else {
  console.log(`Runtime packages importing Node built-ins (${wanted.join(', ')}):\n`);
  for (const [pkg, byBuiltin] of relevant.sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`● ${pkg}`);
    for (const [builtin, files] of byBuiltin) {
      const list = [...files];
      console.log(`    "${builtin}"  in ${list.length} file(s), e.g. ${list[0]}`);
    }
  }
  console.log('\nTo see why a package is installed:  npm ls <package-name>');
  console.log('Note: a match can be inside a Node-only code path that is never loaded in the browser.');
}
