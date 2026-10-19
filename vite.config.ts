import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';

// Configuration follows the Cornerstone3D "React, Vue, Angular, etc." guide:
//  - dicom-parser is CommonJS, so it needs the CommonJS plugin and pre-bundling.
//  - @cornerstonejs/dicom-image-loader ships web workers and WASM codecs and
//    must NOT be pre-bundled by Vite.
//  - Workers are ES modules.
//
// Single metadata registry (fixes the black viewport in `npm run dev`):
//  @cornerstonejs/metadata keeps the metadata provider registry and caches in
//  module-level state. @cornerstonejs/core re-exports `metaData` from it, and
//  the DICOM image loader imports it directly. Because the loader is excluded
//  from pre-bundling, Vite used to serve it the raw node_modules copy of
//  @cornerstonejs/metadata, while core got a second copy inlined into its
//  pre-bundled chunk. The loader registered its providers and stored each
//  file's pixel data in one copy, then read them back through core's copy,
//  found nothing, and failed with
//    "loadImageFromNaturalizedMetadata: no pixel data in NATURALIZED".
//  Listing the shared Cornerstone packages here makes them pre-bundled entry
//  points, so core and the loader resolve to the same module instance.
//  (Production builds bundle everything once and were never affected.)
//
// Node built-in "events":
//  A dependency imports Node's `events` module (`class X extends EventEmitter`).
//  Vite does not polyfill Node built-ins, so the browser-compatible `events`
//  npm package (a direct dependency) is used instead; `node:events` is aliased
//  to it explicitly. `npm run diagnose:builtins` lists packages that need it.
export default defineConfig({
  plugins: [react(), viteCommonjs()],
  resolve: {
    alias: [{ find: /^node:events$/, replacement: 'events' }],
  },
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: ['dicom-parser', 'events', '@cornerstonejs/metadata', '@cornerstonejs/utils'],
  },
  worker: {
    format: 'es',
  },
  server: {
    // Bind to localhost only: the app processes medical images and should not
    // be exposed on the network by default.
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    // Never let the dev server or its file watcher touch local imaging data
    // that is kept inside the project folder (see .gitignore).
    watch: {
      ignored: ['**/data/**', '**/datasets/**', '**/public/sample/**', '**/*.dcm'],
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
  },
});
